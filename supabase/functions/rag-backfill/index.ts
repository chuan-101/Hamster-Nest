import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const FIXED_USER_ID = '94dd24be-e136-45bb-836b-6820c09c4292'
const EMBEDDING_VERSION = 'v1'
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'
const DEFAULT_EMBEDDING_DIMENSIONS = 1536

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

type EmbedItem = {
  text: string
  source: string
  zone: string
  source_table: string
  source_id: string
  metadata?: Record<string, unknown>
}

type BackfillResult = {
  processed: number
  inserted: number
  skipped: number
  failed: number
  errors: string[]
}

type RagConfigRow = {
  config_key: string | null
  config_value: string | number | null
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

const sha256Hex = async (input: string) => {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const loadEmbeddingRuntimeConfig = async (
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ embeddingModel: string; embeddingDimensions: number }> => {
  const { data, error } = await supabase
    .from('rag_config')
    .select('config_key, config_value')
    .eq('user_id', userId)
    .in('config_key', ['embedding_model', 'embedding_dimensions'])

  if (error) {
    console.error('[rag-backfill] failed to load rag_config, using defaults', error)
    return { embeddingModel: DEFAULT_EMBEDDING_MODEL, embeddingDimensions: DEFAULT_EMBEDDING_DIMENSIONS }
  }

  const rows = (data ?? []) as RagConfigRow[]
  const map = new Map<string, string | number>()
  for (const row of rows) {
    if (!row.config_key || row.config_value === null || row.config_value === undefined) continue
    map.set(row.config_key, row.config_value)
  }

  const modelValue = map.get('embedding_model')
  const dimensionsValue = map.get('embedding_dimensions')
  const parsedDimensions =
    typeof dimensionsValue === 'number'
      ? dimensionsValue
      : typeof dimensionsValue === 'string'
        ? Number.parseInt(dimensionsValue, 10)
        : Number.NaN

  return {
    embeddingModel:
      typeof modelValue === 'string' && modelValue.trim() ? modelValue.trim() : DEFAULT_EMBEDDING_MODEL,
    embeddingDimensions: Number.isFinite(parsedDimensions) ? parsedDimensions : DEFAULT_EMBEDDING_DIMENSIONS,
  }
}

const generateEmbedding = async (
  apiKey: string,
  model: string,
  dimensions: number,
  text: string,
): Promise<{ ok: true; embedding: number[] } | { ok: false; error: string }> => {
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input: text, dimensions }),
    })

    if (!resp.ok) {
      const errorText = await resp.text()
      return { ok: false, error: `OpenRouter ${resp.status}: ${errorText || 'unknown error'}` }
    }

    const body = (await resp.json()) as { data?: Array<{ embedding?: number[] }> }
    const embedding = body.data?.[0]?.embedding
    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      return { ok: false, error: 'OpenRouter returned an empty embedding vector' }
    }

    return { ok: true, embedding }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'embedding request crashed' }
  }
}

const processItems = async (
  supabase: ReturnType<typeof createClient>,
  openRouterApiKey: string,
  embeddingModel: string,
  embeddingDimensions: number,
  items: EmbedItem[],
  result: BackfillResult,
) => {
  for (const item of items) {
    const contentHash = await sha256Hex(
      [FIXED_USER_ID, item.source, item.zone, item.source_table, item.source_id, item.text, embeddingModel, EMBEDDING_VERSION].join('|'),
    )

    const embeddingResult = await generateEmbedding(openRouterApiKey, embeddingModel, embeddingDimensions, item.text)

    if (!embeddingResult.ok) {
      result.failed += 1
      result.errors.push(`${item.source_id}: ${embeddingResult.error}`)
      console.error('[rag-backfill] embedding failed', { source_id: item.source_id, error: embeddingResult.error })
      continue
    }

    const { error: insertError } = await supabase.from('rag_embeddings').insert({
      source: item.source,
      zone: item.zone,
      source_table: item.source_table,
      source_id: item.source_id,
      chunk_text: item.text,
      embedding: embeddingResult.embedding,
      metadata: item.metadata ?? {},
      content_hash: contentHash,
      embedding_model: embeddingModel,
      embedding_version: EMBEDDING_VERSION,
      chunk_index: null,
      token_count: null,
      user_id: FIXED_USER_ID,
    })

    if (insertError) {
      if ((insertError as { code?: string }).code === '23505') {
        result.skipped += 1
        continue
      }
      result.failed += 1
      result.errors.push(`${item.source_id}: ${insertError.message}`)
      console.error('[rag-backfill] insert failed', { source_id: item.source_id, error: insertError })
      continue
    }

    result.inserted += 1
  }

  result.processed += items.length
}

// Group messages by session_id and pair user+assistant turns into chunks
const buildChatChunks = (
  rows: Array<{ id: string; session_id: string; role: string; content: string; created_at: string }>,
  zone: string,
  sourceTable: string,
  includeSessionInMeta: boolean,
): EmbedItem[] => {
  const bySession = new Map<string, typeof rows>()
  for (const row of rows) {
    const group = bySession.get(row.session_id) ?? []
    group.push(row)
    bySession.set(row.session_id, group)
  }

  const items: EmbedItem[] = []

  for (const [sessionId, msgs] of bySession) {
    msgs.sort((a, b) => a.created_at.localeCompare(b.created_at))

    let i = 0
    while (i < msgs.length) {
      const parts: string[] = []
      const ids: string[] = []

      if (msgs[i].role === 'user') {
        parts.push(`user: ${msgs[i].content}`)
        ids.push(msgs[i].id)
        i++
      }

      while (i < msgs.length && msgs[i].role === 'assistant') {
        parts.push(`assistant: ${msgs[i].content}`)
        ids.push(msgs[i].id)
        i++
      }

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
    const openRouterApiKey = Deno.env.get('OPENROUTER_API_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
      return Response.json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
    }
    if (!openRouterApiKey) {
      return Response.json({ error: 'Missing OPENROUTER_API_KEY' }, { status: 500 })
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

    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const { embeddingModel, embeddingDimensions } = await loadEmbeddingRuntimeConfig(supabase, FIXED_USER_ID)
    const result: BackfillResult = { processed: 0, inserted: 0, skipped: 0, failed: 0, errors: [] }

    // ── memory_entries ──
    if (batch === 'memory_entries') {
      const { data, error } = await supabase
        .from('memory_entries')
        .select('id, content')
        .eq('user_id', FIXED_USER_ID)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1)

      if (error) throw new Error(`Failed to read memory_entries: ${error.message}`)

      const items: EmbedItem[] = (data ?? [])
        .filter((row: { content: string }) => row.content?.trim())
        .map((row: { id: string; content: string }) => ({
          text: row.content,
          source: 'hamster-nest',
          zone: 'daily_chat',
          source_table: 'memory_entries',
          source_id: row.id,
        }))

      await processItems(supabase, openRouterApiKey, embeddingModel, embeddingDimensions, items, result)
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

      const items: EmbedItem[] = (data ?? [])
        .filter((row: { content: string }) => row.content?.trim())
        .map((row: { id: string; content: string }) => ({
          text: row.content,
          source: 'hamster-nest',
          zone: 'letter',
          source_table: 'letters',
          source_id: row.id,
        }))

      await processItems(supabase, openRouterApiKey, embeddingModel, embeddingDimensions, items, result)
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
      await processItems(supabase, openRouterApiKey, embeddingModel, embeddingDimensions, items, result)
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
      await processItems(supabase, openRouterApiKey, embeddingModel, embeddingDimensions, items, result)
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
      await processItems(supabase, openRouterApiKey, embeddingModel, embeddingDimensions, items, result)
    }

    // ── forum ──
    if (batch === 'forum') {
      const items: EmbedItem[] = []

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

      await processItems(supabase, openRouterApiKey, embeddingModel, embeddingDimensions, items, result)
    }

    // ── snack ──
    if (batch === 'snack') {
      const items: EmbedItem[] = []

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

      await processItems(supabase, openRouterApiKey, embeddingModel, embeddingDimensions, items, result)
    }

    // ── syzygy_posts ──
    if (batch === 'syzygy_posts') {
      const items: EmbedItem[] = []

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

      await processItems(supabase, openRouterApiKey, embeddingModel, embeddingDimensions, items, result)
    }

    return Response.json(result, { status: 200 })
  } catch (error) {
    console.error('[rag-backfill] fatal error', error)
    return Response.json(
      {
        processed: 0,
        inserted: 0,
        skipped: 0,
        failed: 1,
        errors: [error instanceof Error ? error.message : 'Unexpected error'],
      },
      { status: 500 },
    )
  }
})
