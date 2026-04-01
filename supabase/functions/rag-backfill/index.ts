import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const FIXED_USER_ID = '94dd24be-e136-45bb-836b-6820c09c4292'

type BatchType =
  | 'memory_entries'
  | 'messages'
  | 'bubble_messages'
  | 'letters'
  | 'rp_messages'
  | 'forum'
  | 'snack'
  | 'syzygy_posts'

type BackfillPayload = {
  batch: BatchType
  limit?: number
  offset?: number
}

type RagEmbedItem = {
  text: string
  source: string
  zone: string
  source_table: string
  source_id: string
  metadata?: Record<string, unknown>
}

type BackfillResult = {
  processed: number
  skipped: number
  failed: number
  errors: string[]
}

type RagEmbedResponse = {
  success?: boolean
  processed?: number
  inserted?: number
  skipped?: number
  failed?: number
  results?: Array<{ source_id: string; status: string; error?: string }>
  error?: string
}

const VALID_BATCHES: BatchType[] = [
  'memory_entries',
  'messages',
  'bubble_messages',
  'letters',
  'rp_messages',
  'forum',
  'snack',
  'syzygy_posts',
]

const callRagEmbed = async (
  supabaseUrl: string,
  serviceRoleKey: string,
  items: RagEmbedItem[],
): Promise<RagEmbedResponse> => {
  if (items.length === 0) {
    return { success: true, processed: 0, inserted: 0, skipped: 0, failed: 0, results: [] }
  }

  const resp = await fetch(`${supabaseUrl}/functions/v1/rag-embed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    },
    body: JSON.stringify({ items }),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`rag-embed returned ${resp.status}: ${text}`)
  }

  return (await resp.json()) as RagEmbedResponse
}

// Group messages by session_id and pair user+assistant turns into chunks
const buildChatChunks = (
  rows: Array<{ id: string; session_id: string; role: string; content: string; created_at: string }>,
  zone: string,
  sourceTable: string,
  includeSessionInMeta: boolean,
): RagEmbedItem[] => {
  // Group by session_id
  const bySession = new Map<string, typeof rows>()
  for (const row of rows) {
    const group = bySession.get(row.session_id) ?? []
    group.push(row)
    bySession.set(row.session_id, group)
  }

  const items: RagEmbedItem[] = []

  for (const [sessionId, msgs] of bySession) {
    // Sort by created_at within each session
    msgs.sort((a, b) => a.created_at.localeCompare(b.created_at))

    let i = 0
    while (i < msgs.length) {
      const parts: string[] = []
      const ids: string[] = []

      // Collect one user message (if present)
      if (msgs[i].role === 'user') {
        parts.push(`user: ${msgs[i].content}`)
        ids.push(msgs[i].id)
        i++
      }

      // Collect following assistant message(s) before next user message
      while (i < msgs.length && msgs[i].role === 'assistant') {
        parts.push(`assistant: ${msgs[i].content}`)
        ids.push(msgs[i].id)
        i++
      }

      // If we collected nothing (unexpected role), skip to avoid infinite loop
      if (parts.length === 0) {
        i++
        continue
      }

      const text = parts.join('\n')
      const metadata: Record<string, unknown> = {}
      if (includeSessionInMeta) {
        metadata.session_id = sessionId
      }

      items.push({
        text,
        source: 'hamster-nest',
        zone,
        source_table: sourceTable,
        source_id: ids[0],
        metadata,
      })
    }
  }

  return items
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
      return Response.json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
    }

    let payload: BackfillPayload
    try {
      payload = (await req.json()) as BackfillPayload
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { batch, limit = 50, offset = 0 } = payload

    if (!batch || !VALID_BATCHES.includes(batch)) {
      return Response.json(
        { error: `Invalid batch. Must be one of: ${VALID_BATCHES.join(', ')}` },
        { status: 400 },
      )
    }

    // Use service role key to bypass RLS
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const result: BackfillResult = { processed: 0, skipped: 0, failed: 0, errors: [] }

    const collectEmbedResult = (resp: RagEmbedResponse) => {
      result.processed += resp.processed ?? 0
      result.skipped += resp.skipped ?? 0
      result.failed += resp.failed ?? 0
      if (resp.results) {
        for (const r of resp.results) {
          if (r.status === 'failed' && r.error) {
            result.errors.push(`${r.source_id}: ${r.error}`)
          }
        }
      }
    }

    // ── memory_entries ──
    if (batch === 'memory_entries') {
      const { data, error } = await supabase
        .from('memory_entries')
        .select('id, content')
        .eq('user_id', FIXED_USER_ID)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1)

      if (error) throw new Error(`Failed to read memory_entries: ${error.message}`)

      const items: RagEmbedItem[] = (data ?? [])
        .filter((row: { content: string }) => row.content?.trim())
        .map((row: { id: string; content: string }) => ({
          text: row.content,
          source: 'hamster-nest',
          zone: 'daily_chat',
          source_table: 'memory_entries',
          source_id: row.id,
        }))

      const resp = await callRagEmbed(supabaseUrl, serviceRoleKey, items)
      collectEmbedResult(resp)
    }

    // ── letters ──
    if (batch === 'letters') {
      const { data, error } = await supabase
        .from('letters')
        .select('id, content')
        .eq('user_id', FIXED_USER_ID)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1)

      if (error) throw new Error(`Failed to read letters: ${error.message}`)

      const items: RagEmbedItem[] = (data ?? [])
        .filter((row: { content: string }) => row.content?.trim())
        .map((row: { id: string; content: string }) => ({
          text: row.content,
          source: 'hamster-nest',
          zone: 'letter',
          source_table: 'letters',
          source_id: row.id,
        }))

      const resp = await callRagEmbed(supabaseUrl, serviceRoleKey, items)
      collectEmbedResult(resp)
    }

    // ── messages (daily_chat) ──
    if (batch === 'messages') {
      const { data, error } = await supabase
        .from('messages')
        .select('id, session_id, role, content, created_at')
        .eq('user_id', FIXED_USER_ID)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1)

      if (error) throw new Error(`Failed to read messages: ${error.message}`)

      const items = buildChatChunks(data ?? [], 'daily_chat', 'messages', false)
      const resp = await callRagEmbed(supabaseUrl, serviceRoleKey, items)
      collectEmbedResult(resp)
    }

    // ── bubble_messages ──
    if (batch === 'bubble_messages') {
      const { data, error } = await supabase
        .from('bubble_messages')
        .select('id, session_id, role, content, created_at')
        .eq('user_id', FIXED_USER_ID)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1)

      if (error) throw new Error(`Failed to read bubble_messages: ${error.message}`)

      const items = buildChatChunks(data ?? [], 'bubble', 'bubble_messages', false)
      const resp = await callRagEmbed(supabaseUrl, serviceRoleKey, items)
      collectEmbedResult(resp)
    }

    // ── rp_messages ──
    if (batch === 'rp_messages') {
      const { data, error } = await supabase
        .from('rp_messages')
        .select('id, session_id, role, content, created_at')
        .eq('user_id', FIXED_USER_ID)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1)

      if (error) throw new Error(`Failed to read rp_messages: ${error.message}`)

      const items = buildChatChunks(data ?? [], 'rp', 'rp_messages', true)
      const resp = await callRagEmbed(supabaseUrl, serviceRoleKey, items)
      collectEmbedResult(resp)
    }

    // ── forum ──
    if (batch === 'forum') {
      const items: RagEmbedItem[] = []

      // forum_threads
      const { data: threads, error: threadErr } = await supabase
        .from('forum_threads')
        .select('id, title, body')
        .eq('user_id', FIXED_USER_ID)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1)

      if (threadErr) throw new Error(`Failed to read forum_threads: ${threadErr.message}`)

      for (const t of threads ?? []) {
        const text = [t.title, t.body].filter(Boolean).join('\n')
        if (!text.trim()) continue
        items.push({
          text,
          source: 'hamster-nest',
          zone: 'forum',
          source_table: 'forum_threads',
          source_id: t.id,
        })
      }

      // forum_replies
      const { data: replies, error: replyErr } = await supabase
        .from('forum_replies')
        .select('id, body')
        .eq('user_id', FIXED_USER_ID)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1)

      if (replyErr) throw new Error(`Failed to read forum_replies: ${replyErr.message}`)

      for (const r of replies ?? []) {
        if (!r.body?.trim()) continue
        items.push({
          text: r.body,
          source: 'hamster-nest',
          zone: 'forum',
          source_table: 'forum_replies',
          source_id: r.id,
        })
      }

      const resp = await callRagEmbed(supabaseUrl, serviceRoleKey, items)
      collectEmbedResult(resp)
    }

    // ── snack ──
    if (batch === 'snack') {
      const items: RagEmbedItem[] = []

      const { data: posts, error: postErr } = await supabase
        .from('snack_posts')
        .select('id, content')
        .eq('user_id', FIXED_USER_ID)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1)

      if (postErr) throw new Error(`Failed to read snack_posts: ${postErr.message}`)

      for (const p of posts ?? []) {
        if (!p.content?.trim()) continue
        items.push({
          text: p.content,
          source: 'hamster-nest',
          zone: 'snack',
          source_table: 'snack_posts',
          source_id: p.id,
        })
      }

      const { data: replies, error: replyErr } = await supabase
        .from('snack_replies')
        .select('id, content')
        .eq('user_id', FIXED_USER_ID)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1)

      if (replyErr) throw new Error(`Failed to read snack_replies: ${replyErr.message}`)

      for (const r of replies ?? []) {
        if (!r.content?.trim()) continue
        items.push({
          text: r.content,
          source: 'hamster-nest',
          zone: 'snack',
          source_table: 'snack_replies',
          source_id: r.id,
        })
      }

      const resp = await callRagEmbed(supabaseUrl, serviceRoleKey, items)
      collectEmbedResult(resp)
    }

    // ── syzygy_posts ──
    if (batch === 'syzygy_posts') {
      const items: RagEmbedItem[] = []

      const { data: posts, error: postErr } = await supabase
        .from('syzygy_posts')
        .select('id, content')
        .eq('user_id', FIXED_USER_ID)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1)

      if (postErr) throw new Error(`Failed to read syzygy_posts: ${postErr.message}`)

      for (const p of posts ?? []) {
        if (!p.content?.trim()) continue
        items.push({
          text: p.content,
          source: 'hamster-nest',
          zone: 'syzygy_post',
          source_table: 'syzygy_posts',
          source_id: p.id,
        })
      }

      const { data: replies, error: replyErr } = await supabase
        .from('syzygy_replies')
        .select('id, content')
        .eq('user_id', FIXED_USER_ID)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1)

      if (replyErr) throw new Error(`Failed to read syzygy_replies: ${replyErr.message}`)

      for (const r of replies ?? []) {
        if (!r.content?.trim()) continue
        items.push({
          text: r.content,
          source: 'hamster-nest',
          zone: 'syzygy_post',
          source_table: 'syzygy_replies',
          source_id: r.id,
        })
      }

      const resp = await callRagEmbed(supabaseUrl, serviceRoleKey, items)
      collectEmbedResult(resp)
    }

    return Response.json(result, { status: 200 })
  } catch (error) {
    console.error('[rag-backfill] fatal error', error)
    return Response.json(
      {
        processed: 0,
        skipped: 0,
        failed: 1,
        errors: [error instanceof Error ? error.message : 'Unexpected error'],
      },
      { status: 500 },
    )
  }
})
