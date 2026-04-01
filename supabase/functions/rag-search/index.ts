import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

type RagConfigRow = {
  config_key: string | null
  config_value: unknown
}

type RagSearchPayload = {
  query?: unknown
  zones?: unknown
  top_k?: unknown
  threshold?: unknown
  metadata_filter?: unknown
}

type RagSearchConfig = {
  embeddingModel: string
  embeddingDimensions: number
  embeddingProvider: string
  searchTopK: number
  searchThreshold: number
  rpSearchMode: 'story_group' | 'session' | 'all_rp'
  defaultSearchZones: string[]
}

type EmbeddingResult =
  | { ok: true; embedding: number[] }
  | { ok: false; error: string }

type ParsedRequest = {
  query: string
  zones: string[]
  topK: number
  threshold: number
  metadataFilter: Record<string, unknown> | null
}

type RpcResultRow = {
  chunk_text?: unknown
  source?: unknown
  zone?: unknown
  source_table?: unknown
  source_id?: unknown
  similarity?: unknown
  metadata?: unknown
}

const EMBEDDING_VERSION = 'v1'
const DEFAULTS = {
  embeddingModel: 'text-embedding-3-small',
  embeddingDimensions: 1536,
  embeddingProvider: 'openrouter',
  searchTopK: 5,
  searchThreshold: 0.7,
  rpSearchMode: 'story_group' as const,
  defaultSearchZones: ['daily_chat', 'bubble', 'letter'],
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

const parseInteger = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

const parseNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

const parseStringArray = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null
  const zones = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)
  return zones.length > 0 ? zones : []
}

// Config loading: read user-scoped rag_config values and apply required defaults.
const loadSearchRuntimeConfig = async (
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<RagSearchConfig> => {
  const keys = [
    'embedding_model',
    'embedding_dimensions',
    'embedding_provider',
    'search_top_k',
    'search_threshold',
    'rp_search_mode',
    'default_search_zones',
  ]

  const { data, error } = await supabase
    .from('rag_config')
    .select('config_key, config_value')
    .eq('user_id', userId)
    .in('config_key', keys)

  if (error) {
    console.error('[rag-search] failed to load rag_config; using defaults', { userId, error })
    return { ...DEFAULTS }
  }

  const map = new Map<string, unknown>()
  for (const row of (data ?? []) as RagConfigRow[]) {
    if (!row.config_key || row.config_value === null || row.config_value === undefined) continue
    map.set(row.config_key, row.config_value)
  }

  const embeddingModelRaw = map.get('embedding_model')
  const embeddingDimensionsRaw = map.get('embedding_dimensions')
  const embeddingProviderRaw = map.get('embedding_provider')
  const searchTopKRaw = map.get('search_top_k')
  const searchThresholdRaw = map.get('search_threshold')
  const rpSearchModeRaw = map.get('rp_search_mode')
  const defaultSearchZonesRaw = map.get('default_search_zones')

  const parsedDefaultZones =
    parseStringArray(defaultSearchZonesRaw) ??
    (typeof defaultSearchZonesRaw === 'string'
      ? parseStringArray(defaultSearchZonesRaw.split(',').map((v) => v.trim()))
      : null)

  const rpSearchModeCandidate =
    typeof rpSearchModeRaw === 'string' ? rpSearchModeRaw.trim().toLowerCase() : DEFAULTS.rpSearchMode

  const rpSearchMode: RagSearchConfig['rpSearchMode'] =
    rpSearchModeCandidate === 'session' || rpSearchModeCandidate === 'all_rp'
      ? rpSearchModeCandidate
      : DEFAULTS.rpSearchMode

  return {
    embeddingModel:
      typeof embeddingModelRaw === 'string' && embeddingModelRaw.trim()
        ? embeddingModelRaw.trim()
        : DEFAULTS.embeddingModel,
    embeddingDimensions: parseInteger(embeddingDimensionsRaw) ?? DEFAULTS.embeddingDimensions,
    embeddingProvider:
      typeof embeddingProviderRaw === 'string' && embeddingProviderRaw.trim()
        ? embeddingProviderRaw.trim()
        : DEFAULTS.embeddingProvider,
    searchTopK: parseInteger(searchTopKRaw) ?? DEFAULTS.searchTopK,
    searchThreshold: parseNumber(searchThresholdRaw) ?? DEFAULTS.searchThreshold,
    rpSearchMode,
    defaultSearchZones: parsedDefaultZones && parsedDefaultZones.length > 0 ? parsedDefaultZones : DEFAULTS.defaultSearchZones,
  }
}

// Embedding generation: use OpenRouter and fail fast before any retrieval RPC call.
const requestOpenRouterEmbedding = async ({
  apiKey,
  model,
  dimensions,
  query,
}: {
  apiKey: string
  model: string
  dimensions: number
  query: string
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
        input: query,
        dimensions,
      }),
    })

    if (!upstream.ok) {
      const text = await upstream.text()
      return {
        ok: false,
        error: `OpenRouter embedding request failed (${upstream.status}): ${text || 'unknown error'}`,
      }
    }

    const body = (await upstream.json()) as { data?: Array<{ embedding?: number[] }> }
    const embedding = body.data?.[0]?.embedding

    if (!Array.isArray(embedding) || embedding.length === 0) {
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

const parsePayload = (
  payload: RagSearchPayload,
  config: RagSearchConfig,
): { ok: true; value: ParsedRequest } | { ok: false; error: string } => {
  const query = typeof payload.query === 'string' ? payload.query.trim() : ''
  if (!query) return { ok: false, error: 'query is required and must be non-empty' }

  const zones = payload.zones === undefined ? config.defaultSearchZones : parseStringArray(payload.zones)
  if (zones === null) return { ok: false, error: 'zones must be an array of strings when provided' }

  const topK = payload.top_k === undefined ? config.searchTopK : parseInteger(payload.top_k)
  if (topK === null || topK <= 0) return { ok: false, error: 'top_k must be a positive integer when provided' }

  const threshold = payload.threshold === undefined ? config.searchThreshold : parseNumber(payload.threshold)
  if (threshold === null) return { ok: false, error: 'threshold must be numeric when provided' }

  if (
    payload.metadata_filter !== undefined &&
    (payload.metadata_filter === null || typeof payload.metadata_filter !== 'object' || Array.isArray(payload.metadata_filter))
  ) {
    return { ok: false, error: 'metadata_filter must be an object when provided' }
  }

  return {
    ok: true,
    value: {
      query,
      zones,
      topK,
      threshold,
      metadataFilter: (payload.metadata_filter as Record<string, unknown> | undefined) ?? null,
    },
  }
}

// Metadata filter handling: preserve caller-provided filters and keep RP mode/zones plumbing explicit for future extension.
const buildMetadataFilter = ({
  metadataFilter,
  zones,
  rpSearchMode,
}: {
  metadataFilter: Record<string, unknown> | null
  zones: string[]
  rpSearchMode: RagSearchConfig['rpSearchMode']
}) => {
  const filter = metadataFilter ? { ...metadataFilter } : null
  const usesRpZones = zones.some((zone) => zone.startsWith('rp_'))

  if (!usesRpZones) {
    return filter
  }

  console.log('[rag-search] RP zone retrieval path', {
    rp_search_mode: rpSearchMode,
    has_explicit_filter: Boolean(filter),
    zones,
  })

  return filter
}

const normalizeResultRow = (row: RpcResultRow) => {
  const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? (row.metadata as Record<string, unknown>)
    : {}

  const similarity = parseNumber(row.similarity)

  return {
    chunk_text: typeof row.chunk_text === 'string' ? row.chunk_text : '',
    source: typeof row.source === 'string' && row.source.trim() ? row.source : 'hamster-nest',
    zone: typeof row.zone === 'string' ? row.zone : '',
    source_table: typeof row.source_table === 'string' ? row.source_table : '',
    source_id: typeof row.source_id === 'string' ? row.source_id : '',
    similarity: similarity ?? 0,
    metadata,
  }
}

// RPC invocation: attempt compatible signatures and return clear errors if the function call fails.
const invokeMatchRpc = async ({
  supabase,
  userId,
  embedding,
  zones,
  threshold,
  topK,
  metadataFilter,
  embeddingModel,
}: {
  supabase: ReturnType<typeof createClient>
  userId: string
  embedding: number[]
  zones: string[]
  threshold: number
  topK: number
  metadataFilter: Record<string, unknown> | null
  embeddingModel: string
}) => {
  const attempts: Array<Record<string, unknown>> = [
    {
      p_user_id: userId,
      p_query_embedding: embedding,
      p_zones: zones,
      p_threshold: threshold,
      p_top_k: topK,
      p_metadata_filter: metadataFilter,
      p_embedding_model: embeddingModel,
      p_embedding_version: EMBEDDING_VERSION,
    },
    {
      query_embedding: embedding,
      filter_user_id: userId,
      zones,
      match_threshold: threshold,
      match_count: topK,
      metadata_filter: metadataFilter,
      embedding_model: embeddingModel,
      embedding_version: EMBEDDING_VERSION,
    },
    {
      embedding,
      user_id: userId,
      zones,
      threshold,
      top_k: topK,
      metadata_filter: metadataFilter,
      embedding_model: embeddingModel,
      embedding_version: EMBEDDING_VERSION,
    },
  ]

  let finalError: unknown = null

  for (const args of attempts) {
    const { data, error } = await supabase.rpc('match_rag_chunks', args)
    if (!error) return { data: (data ?? []) as RpcResultRow[] }

    finalError = error
    const message = String((error as { message?: string }).message ?? '')
    if (!message.includes('Could not find the function') && !message.includes('function match_rag_chunks')) {
      return { error }
    }
  }

  return { error: finalError }
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

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader, apikey } },
    })

    // Auth handling: require a real authenticated Supabase user before search.
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401, origin)
    }

    let payload: RagSearchPayload
    try {
      payload = (await req.json()) as RagSearchPayload
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400, origin)
    }

    const runtimeConfig = await loadSearchRuntimeConfig(supabase, user.id)
    const parsed = parsePayload(payload, runtimeConfig)
    if (!parsed.ok) {
      return jsonResponse({ error: parsed.error }, 400, origin)
    }

    if (runtimeConfig.embeddingProvider !== 'openrouter') {
      console.warn(
        `[rag-search] user ${user.id} embedding_provider=${runtimeConfig.embeddingProvider}; endpoint currently uses OpenRouter embeddings`,
      )
    }

    const metadataFilter = buildMetadataFilter({
      metadataFilter: parsed.value.metadataFilter,
      zones: parsed.value.zones,
      rpSearchMode: runtimeConfig.rpSearchMode,
    })

    const embeddingResult = await requestOpenRouterEmbedding({
      apiKey: openRouterApiKey,
      model: runtimeConfig.embeddingModel,
      dimensions: runtimeConfig.embeddingDimensions,
      query: parsed.value.query,
    })

    if (!embeddingResult.ok) {
      console.error('[rag-search] embedding generation failed', {
        user_id: user.id,
        error: embeddingResult.error,
      })
      return jsonResponse({ error: embeddingResult.error }, 502, origin)
    }

    const rpcResult = await invokeMatchRpc({
      supabase,
      userId: user.id,
      embedding: embeddingResult.embedding,
      zones: parsed.value.zones,
      threshold: parsed.value.threshold,
      topK: parsed.value.topK,
      metadataFilter,
      embeddingModel: runtimeConfig.embeddingModel,
    })

    if ('error' in rpcResult && rpcResult.error) {
      console.error('[rag-search] match_rag_chunks RPC failed', {
        user_id: user.id,
        error: rpcResult.error,
      })
      const message =
        (rpcResult.error as { message?: string }).message ??
        'match_rag_chunks RPC invocation failed'
      return jsonResponse({ error: message }, 500, origin)
    }

    const normalizedResults = (rpcResult.data ?? []).map(normalizeResultRow)

    return jsonResponse(
      {
        success: true,
        query: parsed.value.query,
        zones: parsed.value.zones,
        top_k: parsed.value.topK,
        threshold: parsed.value.threshold,
        results: normalizedResults,
      },
      200,
      origin,
    )
  } catch (error) {
    console.error('[rag-search] fatal request failure', error)
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : 'Unexpected error',
      },
      500,
      origin,
    )
  }
})
