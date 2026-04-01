import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

type RagEmbedItemInput = {
  text?: unknown
  source?: unknown
  zone?: unknown
  source_table?: unknown
  source_id?: unknown
  metadata?: unknown
  chunk_index?: unknown
  token_count?: unknown
}

type RagEmbedPayload = {
  items?: unknown
  user_id?: unknown
} & RagEmbedItemInput

type NormalizedRagEmbedItem = {
  text: string
  source: string
  zone: string
  source_table: string
  source_id: string
  metadata: Record<string, unknown>
  chunk_index: number | null
  token_count: number | null
}

type RagConfigRow = {
  config_key: string | null
  config_value: string | number | null
}

type EmbeddingRuntimeConfig = {
  embeddingModel: string
  embeddingDimensions: number
  embeddingProvider: string
}

type EmbeddingResult =
  | { ok: true; embedding: number[] }
  | { ok: false; error: string }

type ItemProcessResult = {
  source_id: string
  status: 'inserted' | 'skipped' | 'failed'
  error?: string
}

const EMBEDDING_VERSION = 'v1'
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'
const DEFAULT_EMBEDDING_DIMENSIONS = 1536
const DEFAULT_EMBEDDING_PROVIDER = 'openrouter'

const allowedOrigins = ['https://chuan-101.github.io', /^http:\/\/localhost:\d+$/]

const isAllowedOrigin = (origin: string | null) => {
  if (!origin) {
    return true
  }
  return allowedOrigins.some((pattern) =>
    typeof pattern === 'string' ? pattern === origin : pattern.test(origin),
  )
}

const buildCorsHeaders = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin ?? '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
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

const toNullableInteger = (value: unknown): number | null => {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }
  return null
}

const normalizeItem = (raw: RagEmbedItemInput): { item?: NormalizedRagEmbedItem; error?: string } => {
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  const source = typeof raw.source === 'string' ? raw.source.trim() : ''
  const zone = typeof raw.zone === 'string' ? raw.zone.trim() : ''
  const sourceTable = typeof raw.source_table === 'string' ? raw.source_table.trim() : ''
  const sourceId = typeof raw.source_id === 'string' ? raw.source_id.trim() : ''

  if (!text) {
    return { error: 'text is required and must be non-empty' }
  }
  if (!source) {
    return { error: 'source is required' }
  }
  if (!zone) {
    return { error: 'zone is required' }
  }
  if (!sourceTable) {
    return { error: 'source_table is required' }
  }
  if (!sourceId) {
    return { error: 'source_id is required' }
  }

  const metadata =
    raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
      ? (raw.metadata as Record<string, unknown>)
      : {}

  return {
    item: {
      text,
      source,
      zone,
      source_table: sourceTable,
      source_id: sourceId,
      metadata,
      chunk_index: toNullableInteger(raw.chunk_index),
      token_count: toNullableInteger(raw.token_count),
    },
  }
}

const normalizePayload = (payload: RagEmbedPayload): { items: NormalizedRagEmbedItem[]; earlyError?: string } => {
  const candidates = Array.isArray(payload.items) ? payload.items : [payload]
  const items: NormalizedRagEmbedItem[] = []

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      return { items: [], earlyError: 'each item must be an object' }
    }

    const normalized = normalizeItem(candidate as RagEmbedItemInput)
    if (normalized.error || !normalized.item) {
      return { items: [], earlyError: normalized.error ?? 'invalid input item' }
    }

    items.push(normalized.item)
  }

  if (items.length === 0) {
    return { items: [], earlyError: 'at least one item is required' }
  }

  return { items }
}

const sha256Hex = async (input: string) => {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

// Config loading: read per-user RAG runtime keys with sane defaults.
const loadEmbeddingRuntimeConfig = async (
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<EmbeddingRuntimeConfig> => {
  const { data, error } = await supabase
    .from('rag_config')
    .select('config_key, config_value')
    .eq('user_id', userId)
    .in('config_key', ['embedding_model', 'embedding_dimensions', 'embedding_provider'])

  if (error) {
    console.error('[rag-embed] failed to load rag_config, using defaults', error)
    return {
      embeddingModel: DEFAULT_EMBEDDING_MODEL,
      embeddingDimensions: DEFAULT_EMBEDDING_DIMENSIONS,
      embeddingProvider: DEFAULT_EMBEDDING_PROVIDER,
    }
  }

  const rows = (data ?? []) as RagConfigRow[]
  const map = new Map<string, string | number>()
  for (const row of rows) {
    if (!row.config_key || row.config_value === null || row.config_value === undefined) {
      continue
    }
    map.set(row.config_key, row.config_value)
  }

  const modelValue = map.get('embedding_model')
  const dimensionsValue = map.get('embedding_dimensions')
  const providerValue = map.get('embedding_provider')

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
    embeddingProvider:
      typeof providerValue === 'string' && providerValue.trim()
        ? providerValue.trim()
        : DEFAULT_EMBEDDING_PROVIDER,
  }
}

const requestOpenRouterEmbedding = async ({
  apiKey,
  model,
  dimensions,
  text,
}: {
  apiKey: string
  model: string
  dimensions: number
  text: string
}): Promise<EmbeddingResult> => {
  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: text,
        dimensions,
      }),
    })

    if (!upstream.ok) {
      const errorText = await upstream.text()
      return {
        ok: false,
        error: `OpenRouter embedding request failed (${upstream.status}): ${errorText || 'unknown error'}`,
      }
    }

    const body = (await upstream.json()) as {
      data?: Array<{ embedding?: number[] }>
    }

    const embedding = body.data?.[0]?.embedding
    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      return { ok: false, error: 'OpenRouter returned an empty embedding vector' }
    }

    return { ok: true, embedding }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'OpenRouter embedding request crashed',
    }
  }
}

serve(async (req) => {
  const origin = req.headers.get('origin')

  if (!isAllowedOrigin(origin)) {
    return jsonResponse({ error: 'Origin not allowed' }, 403, origin)
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: buildCorsHeaders(origin) })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const openRouterApiKey = Deno.env.get('OPENROUTER_API_KEY')

    if (!supabaseUrl || !anonKey) {
      return jsonResponse({ error: 'Supabase environment variables are missing' }, 500, origin)
    }
    if (!openRouterApiKey) {
      return jsonResponse({ error: 'OPENROUTER_API_KEY is not configured' }, 500, origin)
    }

    const authHeader = req.headers.get('authorization')
    const apikey = req.headers.get('apikey')
    if (!authHeader || !apikey) {
      return jsonResponse({ error: 'Missing auth headers' }, 401, origin)
    }

    // Detect service-role calls (server-to-server, e.g. from rag-backfill)
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const isServiceRole = serviceRoleKey && apikey === serviceRoleKey

    let userId: string
    let supabase: ReturnType<typeof createClient>

    let payload: RagEmbedPayload
    try {
      payload = (await req.json()) as RagEmbedPayload
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400, origin)
    }

    if (isServiceRole) {
      // Service-role: create client with service role key (bypasses RLS)
      supabase = createClient(supabaseUrl, serviceRoleKey)

      if (typeof payload.user_id !== 'string' || !payload.user_id) {
        return jsonResponse({ error: 'Service-role calls must provide user_id' }, 400, origin)
      }
      userId = payload.user_id
    } else {
      supabase = createClient(supabaseUrl, anonKey, {
        global: {
          headers: {
            Authorization: authHeader,
            apikey,
          },
        },
      })

      // Auth handling: block anonymous writes and bind user_id from Supabase auth.
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        return jsonResponse({ error: 'Unauthorized' }, 401, origin)
      }
      userId = user.id
    }

    const normalized = normalizePayload(payload)
    if (normalized.earlyError) {
      return jsonResponse({ error: normalized.earlyError }, 400, origin)
    }

    const runtimeConfig = await loadEmbeddingRuntimeConfig(supabase, userId)

    if (runtimeConfig.embeddingProvider !== 'openrouter') {
      console.warn(
        `[rag-embed] user ${userId} embedding_provider=${runtimeConfig.embeddingProvider}, falling back to OpenRouter for this endpoint`,
      )
    }

    const results: ItemProcessResult[] = []
    let inserted = 0
    let skipped = 0
    let failed = 0

    for (const item of normalized.items) {
      try {
        // Hash generation + dedupe key: stable content hash includes model/version and source identity.
        const contentHash = await sha256Hex(
          [
            userId,
            item.source,
            item.zone,
            item.source_table,
            item.source_id,
            item.text,
            runtimeConfig.embeddingModel,
            EMBEDDING_VERSION,
          ].join('|'),
        )

        // Insert flow safety: only write after embedding succeeds (prevents dirty rows).
        const embeddingResult = await requestOpenRouterEmbedding({
          apiKey: openRouterApiKey,
          model: runtimeConfig.embeddingModel,
          dimensions: runtimeConfig.embeddingDimensions,
          text: item.text,
        })

        if (!embeddingResult.ok) {
          failed += 1
          results.push({
            source_id: item.source_id,
            status: 'failed',
            error: embeddingResult.error,
          })
          console.error('[rag-embed] embedding failed', {
            user_id: userId,
            source_id: item.source_id,
            error: embeddingResult.error,
          })
          continue
        }

        // Dedupe logic: unique(content_hash) conflicts are treated as non-fatal skips.
        const { error: insertError } = await supabase.from('rag_embeddings').insert({
          source: item.source,
          zone: item.zone,
          source_table: item.source_table,
          source_id: item.source_id,
          chunk_text: item.text,
          embedding: embeddingResult.embedding,
          metadata: item.metadata,
          content_hash: contentHash,
          embedding_model: runtimeConfig.embeddingModel,
          embedding_version: EMBEDDING_VERSION,
          chunk_index: item.chunk_index,
          token_count: item.token_count,
          user_id: userId,
        })

        if (insertError) {
          if ((insertError as { code?: string }).code === '23505') {
            skipped += 1
            results.push({ source_id: item.source_id, status: 'skipped' })
            continue
          }

          failed += 1
          results.push({
            source_id: item.source_id,
            status: 'failed',
            error: insertError.message,
          })
          console.error('[rag-embed] insert failed', {
            user_id: userId,
            source_id: item.source_id,
            error: insertError,
          })
          continue
        }

        inserted += 1
        results.push({ source_id: item.source_id, status: 'inserted' })
      } catch (error) {
        failed += 1
        const message = error instanceof Error ? error.message : 'unknown processing error'
        results.push({
          source_id: item.source_id,
          status: 'failed',
          error: message,
        })
        // Error handling: keep item-scoped failures isolated in batch mode.
        console.error('[rag-embed] unexpected item failure', {
          user_id: userId,
          source_id: item.source_id,
          error,
        })
      }
    }

    const processed = normalized.items.length

    return jsonResponse(
      {
        success: failed === 0,
        processed,
        inserted,
        skipped,
        failed,
        results,
      },
      200,
      origin,
    )
  } catch (error) {
    console.error('[rag-embed] fatal request failure', error)
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : 'Unexpected error',
      },
      500,
      origin,
    )
  }
})
