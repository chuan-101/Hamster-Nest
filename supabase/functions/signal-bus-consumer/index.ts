import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

type SignalStatus = 'pending' | 'processing' | 'processed' | 'failed' | 'expired'
type SignalType = 'sleep_alert' | 'hydration_boost' | 'calendar_aware' | 'mood_check' | 'custom'

type SignalPayload = {
  message?: unknown
  suggestion?: unknown
  action?: unknown
  priority?: unknown
  action_mode?: unknown
  target_consumers?: unknown
  [key: string]: unknown
}

type SyzygySignalRow = {
  id: string
  user_id: string
  type: string
  status: SignalStatus
  payload: SignalPayload | null
  dedupe_key: string | null
  expires_at: string | null
  processed_at: string | null
  created_at: string
}

type ConsumePayload = {
  user_id?: unknown
  limit?: unknown
}

const allowedOrigins = ['https://chuan-101.github.io', /^http:\/\/localhost:\d+$/]

const isAllowedOrigin = (origin: string | null) => {
  if (!origin) return true
  return allowedOrigins.some((pattern) =>
    typeof pattern === 'string' ? pattern === origin : pattern.test(origin),
  )
}

const buildCorsHeaders = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
})

const jsonResponse = (payload: Record<string, unknown>, status: number, origin: string | null) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...buildCorsHeaders(origin),
      'Content-Type': 'application/json',
    },
  })

const isSignalExpired = (signal: Pick<SyzygySignalRow, 'expires_at'>, now = new Date()) => {
  if (!signal.expires_at) return false
  const expiry = new Date(signal.expires_at)
  if (Number.isNaN(expiry.getTime())) return false
  return expiry.getTime() <= now.getTime()
}

const extractMessage = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const toSignalType = (value: string): SignalType | null => {
  if (
    value === 'sleep_alert' ||
    value === 'hydration_boost' ||
    value === 'calendar_aware' ||
    value === 'mood_check' ||
    value === 'custom'
  ) {
    return value
  }
  return null
}

const getBaseMessage = (signal: SyzygySignalRow) => {
  const payload = signal.payload ?? {}
  return (
    extractMessage(payload.message) ??
    extractMessage(payload.suggestion) ??
    '嗨～来自 Syzygy 的提醒到了，记得照顾好自己 💛'
  )
}

const sendWechatMessage = async ({
  webhookUrl,
  text,
  signalId,
  signalType,
}: {
  webhookUrl: string
  text: string
  signalId: string
  signalType: string
}) => {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      source: 'syzygy_signal_bus',
      signal_id: signalId,
      signal_type: signalType,
    }),
  })

  if (!response.ok) {
    const responseText = await response.text()
    throw new Error(`wechat webhook failed (${response.status}): ${responseText || 'unknown error'}`)
  }
}

const handleSleepAlert = async (signal: SyzygySignalRow, webhookUrl: string) => {
  const message = getBaseMessage(signal)
  await sendWechatMessage({
    webhookUrl,
    text: `🌙 睡眠提醒\n${message}`,
    signalId: signal.id,
    signalType: signal.type,
  })
}

const handleHydrationBoost = async (signal: SyzygySignalRow, webhookUrl: string) => {
  const message = getBaseMessage(signal)
  await sendWechatMessage({
    webhookUrl,
    text: `💧 补水提醒\n${message}`,
    signalId: signal.id,
    signalType: signal.type,
  })
}

const handleCalendarAware = async (signal: SyzygySignalRow, webhookUrl: string) => {
  const message = getBaseMessage(signal)
  await sendWechatMessage({
    webhookUrl,
    text: `📅 日程关怀提醒\n${message}`,
    signalId: signal.id,
    signalType: signal.type,
  })
}

const handleMoodCheck = async (signal: SyzygySignalRow, webhookUrl: string) => {
  const message = getBaseMessage(signal)
  await sendWechatMessage({
    webhookUrl,
    text: `🫶 情绪关怀\n${message}`,
    signalId: signal.id,
    signalType: signal.type,
  })
}

const handleCustomSignal = async (signal: SyzygySignalRow, webhookUrl: string) => {
  const payload = signal.payload ?? {}
  const action = extractMessage(payload.action)
  const actionMode = extractMessage(payload.action_mode)
  const message = getBaseMessage(signal)

  if (action === 'send_wechat' || actionMode === 'send_wechat' || !action) {
    await sendWechatMessage({
      webhookUrl,
      text: `✨ 自定义提醒\n${message}`,
      signalId: signal.id,
      signalType: signal.type,
    })
    return
  }

  throw new Error(`unsupported custom action: ${action}`)
}

const routeSignal = async (signal: SyzygySignalRow, webhookUrl: string) => {
  const signalType = toSignalType(signal.type)

  if (!signalType) {
    throw new Error(`unsupported signal type: ${signal.type}`)
  }

  switch (signalType) {
    case 'sleep_alert':
      return handleSleepAlert(signal, webhookUrl)
    case 'hydration_boost':
      return handleHydrationBoost(signal, webhookUrl)
    case 'calendar_aware':
      return handleCalendarAware(signal, webhookUrl)
    case 'mood_check':
      return handleMoodCheck(signal, webhookUrl)
    case 'custom':
      return handleCustomSignal(signal, webhookUrl)
  }
}

const markSignalProcessed = async (
  supabase: ReturnType<typeof createClient>,
  signalId: string,
) => {
  const { error } = await supabase
    .from('syzygy_signals')
    .update({
      status: 'processed',
      processed_at: new Date().toISOString(),
    })
    .eq('id', signalId)
    .eq('status', 'processing')

  if (error) throw error
}

const markSignalFailed = async (
  supabase: ReturnType<typeof createClient>,
  signalId: string,
) => {
  const { error } = await supabase
    .from('syzygy_signals')
    .update({
      status: 'failed',
    })
    .eq('id', signalId)
    .eq('status', 'processing')

  if (error) throw error
}

const markSignalExpired = async (
  supabase: ReturnType<typeof createClient>,
  signalId: string,
) => {
  const { error } = await supabase
    .from('syzygy_signals')
    .update({
      status: 'expired',
      processed_at: new Date().toISOString(),
    })
    .eq('id', signalId)
    .in('status', ['pending', 'processing'])

  if (error) throw error
}

const pollPendingSignals = async (
  supabase: ReturnType<typeof createClient>,
  userId: string | null,
  limit: number,
) => {
  let query = supabase
    .from('syzygy_signals')
    .select('id,user_id,type,status,payload,dedupe_key,expires_at,processed_at,created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (userId) {
    query = query.eq('user_id', userId)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as SyzygySignalRow[]
}

const claimSignal = async (
  supabase: ReturnType<typeof createClient>,
  signalId: string,
) => {
  const { data, error } = await supabase
    .from('syzygy_signals')
    .update({
      status: 'processing',
    })
    .eq('id', signalId)
    .eq('status', 'pending')
    .select('id,user_id,type,status,payload,dedupe_key,expires_at,processed_at,created_at')
    .maybeSingle()

  if (error) throw error
  return (data as SyzygySignalRow | null) ?? null
}

serve(async (req) => {
  const origin = req.headers.get('origin')
  if (!isAllowedOrigin(origin)) {
    return jsonResponse({ error: 'Origin not allowed' }, 403, origin)
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(origin),
    })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const wechatWebhookUrl = Deno.env.get('CYBERBOSS_WECHAT_WEBHOOK_URL')

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Supabase service role env is missing' }, 500, origin)
  }

  if (!wechatWebhookUrl) {
    return jsonResponse({ error: 'CYBERBOSS_WECHAT_WEBHOOK_URL is missing' }, 500, origin)
  }

  const payload = ((await req.json().catch(() => ({}))) ?? {}) as ConsumePayload
  const userId = typeof payload.user_id === 'string' && payload.user_id.trim() ? payload.user_id.trim() : null
  const limit = typeof payload.limit === 'number' && payload.limit > 0 ? Math.min(Math.floor(payload.limit), 100) : 20

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  try {
    const pendingSignals = await pollPendingSignals(supabase, userId, limit)
    console.log('[signal-bus] poll complete', {
      userId,
      requestedLimit: limit,
      fetchedCount: pendingSignals.length,
    })

    let claimedCount = 0
    let processedCount = 0
    let expiredCount = 0
    let failedCount = 0

    for (const signal of pendingSignals) {
      const claimedSignal = await claimSignal(supabase, signal.id)
      if (!claimedSignal) continue

      claimedCount += 1
      console.log('[signal-bus] signal claimed', {
        signalId: claimedSignal.id,
        signalType: claimedSignal.type,
        dedupeKey: claimedSignal.dedupe_key,
      })

      if (isSignalExpired(claimedSignal)) {
        await markSignalExpired(supabase, claimedSignal.id)
        expiredCount += 1
        console.log('[signal-bus] signal expired before execution; skipped', {
          signalId: claimedSignal.id,
          signalType: claimedSignal.type,
        })
        continue
      }

      try {
        await routeSignal(claimedSignal, wechatWebhookUrl)
        await markSignalProcessed(supabase, claimedSignal.id)
        processedCount += 1
        console.log('[signal-bus] signal processed', {
          signalId: claimedSignal.id,
          signalType: claimedSignal.type,
        })
      } catch (error) {
        await markSignalFailed(supabase, claimedSignal.id)
        failedCount += 1
        console.error('[signal-bus] signal failed', {
          signalId: claimedSignal.id,
          signalType: claimedSignal.type,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return jsonResponse(
      {
        ok: true,
        user_id: userId,
        fetched: pendingSignals.length,
        claimed: claimedCount,
        processed: processedCount,
        expired: expiredCount,
        failed: failedCount,
      },
      200,
      origin,
    )
  } catch (error) {
    console.error('[signal-bus] poll crashed', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    })
    return jsonResponse(
      {
        error: 'Signal bus consume failed',
        details: error instanceof Error ? error.message : String(error),
      },
      500,
      origin,
    )
  }
})
