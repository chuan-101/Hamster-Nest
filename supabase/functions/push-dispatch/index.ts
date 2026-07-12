// push-dispatch: agent_events → Expo Push relay (V4.0 Phase 1 · 开发清单 5.3).
//
// Callers are machine-side only and authenticate with the shared secret
// header x-push-dispatch-secret (mode C in docs/security-boundary.md):
//   1. the agent_events AFTER INSERT trigger (pg_net http_post, secret from Vault);
//   2. the Mac mini reconciliation sweep re-dispatching missed events
//      ({ "agent_event_id": N }, idempotent);
//   3. receipts polling ({ "action": "check_receipts" }).
// The expected secret lives ONLY in Vault (push_dispatch_secret): this
// function reads it through the service_role-only RPC
// public.get_push_dispatch_secret and compares timing-safe. Rotation is a
// single Vault update — no Edge secret to keep in sync. Fails closed (401)
// when the header is absent or the Vault secret is unreadable.
//
// Importance routing (V4.0): low → never push; normal/high/urgent → push
// immediately; Beijing quiet hours [23:00, 08:00) suppress everything except
// urgent. Digest/merge pushes for normal importance are V4.1 scope.
// Every attempt lands in notification_events (queued/sent/failed/skipped).
// Push content carries title + entity id + routing data only — never
// sensitive bodies, tokens, or raw payloads (红线清单 11).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { timingSafeEqual } from '../_shared/auth.ts'
import { consumeQuota } from '../_shared/quota.ts'
import { getBeijingDate } from '../_shared/time.ts'

const PUSH_DAILY_LIMIT = 200
const QUIET_HOUR_START = 23 // 北京时区静默时段 [23:00, 08:00)，urgent 豁免
const QUIET_HOUR_END = 8
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts'
const RECEIPT_WINDOW_HOURS = 24
const RECEIPT_BATCH_LIMIT = 300

type AgentEvent = {
  id: number
  user_id: string
  actor: string
  event_type: string
  entity_type: string | null
  entity_id: string | null
  title: string
  payload: Record<string, unknown> | null
  importance: string
  created_at: string
}

type ExpoTicket = {
  status: string
  id?: string
  message?: string
  details?: { error?: string }
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const serviceClient = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

// 期望密钥只存 Vault；经 service_role 专属 RPC 读取，进程内缓存。
let cachedSecret: string | null = null
const verifyDispatchSecret = async (
  req: Request,
  supabase: ReturnType<typeof serviceClient>,
): Promise<boolean> => {
  const provided = req.headers.get('x-push-dispatch-secret')?.trim()
  if (!provided) return false
  if (!cachedSecret) {
    const { data, error } = await supabase.rpc('get_push_dispatch_secret')
    if (error || typeof data !== 'string' || data.length === 0) {
      console.error('push_dispatch secret unavailable', error?.message ?? 'empty')
      return false
    }
    cachedSecret = data
  }
  return timingSafeEqual(provided, cachedSecret)
}

const isQuietHour = (hour: number) => hour >= QUIET_HOUR_START || hour < QUIET_HOUR_END

// Navigation data mirrors the {screen, params, url} contract shared with
// sw.js and the Expo app; url is the web-only fallback.
const buildNavigationData = (event: AgentEvent) => {
  const payload = (event.payload ?? {}) as Record<string, unknown>
  let screen = typeof payload.screen === 'string' ? payload.screen : null
  if (!screen) {
    screen = event.entity_type === 'approval_request' ? 'approval_detail' : 'home'
  }
  let params: Record<string, string> = {}
  const rawParams = payload.params
  if (rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams)) {
    for (const [key, value] of Object.entries(rawParams as Record<string, unknown>)) {
      if (typeof value === 'string') params[key] = value
    }
  } else if (event.entity_id) {
    params = { id: event.entity_id }
  }
  const url = typeof payload.url === 'string' ? payload.url : '/#/'
  return { screen, params, url }
}

const disableToken = async (
  supabase: ReturnType<typeof serviceClient>,
  expoPushToken: string,
) => {
  const { error } = await supabase
    .from('device_tokens')
    .update({ enabled: false })
    .eq('expo_push_token', expoPushToken)
  if (error) console.error('device_tokens disable failed', error.message)
}

const skipEvent = async (
  supabase: ReturnType<typeof serviceClient>,
  event: AgentEvent,
  reason: string,
) => {
  const { error } = await supabase.from('notification_events').insert({
    user_id: event.user_id,
    agent_event_id: event.id,
    channel: 'expo_push',
    status: 'skipped',
    error_message: reason,
  })
  if (error) console.error('notification_events skip insert failed', error.message)
  return json(200, { ok: true, result: 'skipped', reason })
}

const dispatchEvent = async (
  supabase: ReturnType<typeof serviceClient>,
  event: AgentEvent,
) => {
  // 幂等护栏：同一事件已有任何 expo_push 尝试记录（含 skipped）即不再处理，
  // webhook 重放与 sweep 补调都安全。
  const { data: existing, error: existingError } = await supabase
    .from('notification_events')
    .select('id')
    .eq('agent_event_id', event.id)
    .eq('channel', 'expo_push')
    .limit(1)
  if (existingError) return json(500, { error: 'idempotency check failed' })
  if (existing && existing.length > 0) {
    return json(200, { ok: true, result: 'already_dispatched' })
  }

  if (event.importance === 'low') {
    return skipEvent(supabase, event, 'low importance')
  }
  if (event.importance !== 'urgent' && isQuietHour(getBeijingDate().hour)) {
    return skipEvent(supabase, event, 'quiet hours')
  }

  const quota = await consumeQuota('push', event.user_id, PUSH_DAILY_LIMIT)
  if (!quota.allowed) {
    return skipEvent(supabase, event, 'daily push quota exceeded')
  }

  const { data: tokens, error: tokenError } = await supabase
    .from('device_tokens')
    .select('expo_push_token')
    .eq('user_id', event.user_id)
    .eq('enabled', true)
    .in('platform', ['ios', 'android'])
  if (tokenError) return json(500, { error: 'device_tokens read failed' })
  if (!tokens || tokens.length === 0) {
    return skipEvent(supabase, event, 'no enabled device')
  }

  const data = buildNavigationData(event)
  const isApproval = event.entity_type === 'approval_request'
  const highPriority = event.importance === 'high' || event.importance === 'urgent'

  // 先落 queued 审计行再发送：函数中途失败也留有痕迹（清单 5.3 全记录）。
  const { data: queued, error: queueError } = await supabase
    .from('notification_events')
    .insert(
      tokens.map((token) => ({
        user_id: event.user_id,
        agent_event_id: event.id,
        channel: 'expo_push',
        status: 'queued',
        target: token.expo_push_token,
      })),
    )
    .select('id, target')
  if (queueError || !queued) return json(500, { error: 'queue insert failed' })
  const rowByToken = new Map(queued.map((row) => [row.target as string, row.id as string]))

  const messages = tokens.map((token) => ({
    to: token.expo_push_token,
    title: event.title,
    data,
    sound: 'default',
    priority: highPriority ? 'high' : 'default',
    ...(isApproval ? { categoryId: 'approval' } : {}),
  }))

  let tickets: ExpoTicket[]
  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    })
    if (!response.ok) throw new Error(`expo push http ${response.status}`)
    tickets = ((await response.json()).data ?? []) as ExpoTicket[]
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught)
    console.error('expo push send failed', message)
    for (const row of queued) {
      await supabase
        .from('notification_events')
        .update({ status: 'failed', error_message: `send failed: ${message}` })
        .eq('id', row.id)
    }
    return json(502, { error: 'expo push send failed' })
  }

  let sent = 0
  let failed = 0
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i].expo_push_token
    const rowId = rowByToken.get(token)
    if (!rowId) continue
    const ticket = tickets[i]
    if (ticket && ticket.status === 'ok') {
      sent += 1
      await supabase
        .from('notification_events')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          ticket_id: ticket.id ?? null,
        })
        .eq('id', rowId)
    } else {
      failed += 1
      const detail = ticket?.details?.error ?? ''
      await supabase
        .from('notification_events')
        .update({
          status: 'failed',
          error_message: `${ticket?.message ?? 'no ticket returned'}${detail ? ` (${detail})` : ''}`,
        })
        .eq('id', rowId)
      if (detail === 'DeviceNotRegistered') await disableToken(supabase, token)
    }
  }

  return json(200, { ok: true, result: 'dispatched', sent, failed })
}

const checkReceipts = async (supabase: ReturnType<typeof serviceClient>) => {
  const sinceIso = new Date(Date.now() - RECEIPT_WINDOW_HOURS * 3600 * 1000).toISOString()
  const { data: rows, error } = await supabase
    .from('notification_events')
    .select('id, ticket_id, target')
    .eq('channel', 'expo_push')
    .eq('status', 'sent')
    .not('ticket_id', 'is', null)
    .is('receipt_checked_at', null)
    .gte('sent_at', sinceIso)
    .limit(RECEIPT_BATCH_LIMIT)
  if (error) return json(500, { error: 'receipt query failed' })
  if (!rows || rows.length === 0) return json(200, { ok: true, checked: 0 })

  let receipts: Record<string, { status: string; message?: string; details?: { error?: string } }>
  try {
    const response = await fetch(EXPO_RECEIPTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: rows.map((row) => row.ticket_id) }),
    })
    if (!response.ok) throw new Error(`expo receipts http ${response.status}`)
    receipts = (await response.json()).data ?? {}
  } catch (caught) {
    console.error('expo receipts fetch failed', String(caught))
    return json(502, { error: 'expo receipts fetch failed' })
  }

  const now = new Date().toISOString()
  let confirmed = 0
  let failedCount = 0
  for (const row of rows) {
    const receipt = receipts[row.ticket_id as string]
    if (!receipt) continue // 回执尚未生成，下一轮再查
    if (receipt.status === 'ok') {
      confirmed += 1
      await supabase
        .from('notification_events')
        .update({ receipt_checked_at: now })
        .eq('id', row.id)
    } else {
      failedCount += 1
      const detail = receipt.details?.error ?? ''
      await supabase
        .from('notification_events')
        .update({
          status: 'failed',
          receipt_checked_at: now,
          error_message: `receipt: ${receipt.message ?? 'error'}${detail ? ` (${detail})` : ''}`,
        })
        .eq('id', row.id)
      if (detail === 'DeviceNotRegistered' && row.target) {
        await disableToken(supabase, row.target as string)
      }
    }
  }
  return json(200, { ok: true, checked: rows.length, confirmed, failed: failedCount })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  const supabase = serviceClient()
  if (!(await verifyDispatchSecret(req, supabase))) {
    return json(401, { error: 'unauthorized' })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'bad request' })
  }

  if (body.action === 'check_receipts') return checkReceipts(supabase)

  let event: AgentEvent | null = null
  if (body.record && typeof body.record === 'object' && !Array.isArray(body.record)) {
    event = body.record as AgentEvent
  } else if (typeof body.agent_event_id === 'number') {
    // Mac mini sweep 补调路径：按 id 回读事件（幂等由 dispatchEvent 护栏保证）。
    const { data, error } = await supabase
      .from('agent_events')
      .select('*')
      .eq('id', body.agent_event_id)
      .maybeSingle()
    if (error) return json(500, { error: 'event read failed' })
    if (data) event = data as AgentEvent
  }

  if (!event || typeof event.id !== 'number' || typeof event.user_id !== 'string') {
    return json(400, { error: 'missing agent event' })
  }
  return dispatchEvent(supabase, event)
})
