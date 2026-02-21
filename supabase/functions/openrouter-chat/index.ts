import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type OpenAiMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

type OpenRouterPayload = {
  messages: OpenAiMessage[]
  model: string
  conversationId?: string
  temperature?: number
  top_p?: number
  max_tokens?: number
  reasoning?: boolean
  stream?: boolean
  isFirstMessage?: boolean
  module?: 'snack-feed' | 'syzygy-feed' | string
}

type StoredMessageRow = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

type CompressionCacheRow = {
  conversation_id: string
  compressed_up_to_message_id: string | null
  summary_text: string
  updated_at?: string
}

type UserCompressionSettings = {
  default_model: string | null
  compression_enabled: boolean | null
  compression_trigger_ratio: number | null
  compression_keep_recent_messages: number | null
  summarizer_model: string | null
}

type AuthUserResponse = {
  id: string
}

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
})

const PENDING_MEMORY_NOTE =
  'Pending items are tentative. Use them as hints; do not treat them as guaranteed facts unless confirmed.'

const buildMemoryMessage = (confirmedMemories: string[], pendingMemories: string[]): OpenAiMessage => ({
  role: 'system',
  content: [
    PENDING_MEMORY_NOTE,
    'MEMORY (CONFIRMED):',
    ...(confirmedMemories.length > 0
      ? confirmedMemories.map((content) => `- ${content}`)
      : ['- (none)']),
    'MEMORY (PENDING / tentative):',
    ...(pendingMemories.length > 0
      ? pendingMemories.map((content) => `- ${content}`)
      : ['- (none)']),
  ].join('\n'),
})

const injectMemoryBlock = (messages: OpenAiMessage[], memoryMessage: OpenAiMessage) => {
  if (messages.length === 0) {
    return [memoryMessage]
  }
  const firstUserIndex = messages.findIndex((message) => message.role === 'user')
  if (firstUserIndex <= 0) {
    return [memoryMessage, ...messages]
  }
  const lastSystemIndexBeforeUser = messages
    .slice(0, firstUserIndex)
    .reduce((lastIndex, message, index) => (message.role === 'system' ? index : lastIndex), -1)

  if (lastSystemIndexBeforeUser >= 0) {
    const insertIndex = lastSystemIndexBeforeUser + 1
    return [...messages.slice(0, insertIndex), memoryMessage, ...messages.slice(insertIndex)]
  }
  return [...messages.slice(0, firstUserIndex), memoryMessage, ...messages.slice(firstUserIndex)]
}

const shouldInjectSnackFeedMemory = (payload: OpenRouterPayload) => payload.module === 'snack-feed'

const shouldInjectSyzygyFeedMemory = (payload: OpenRouterPayload) => payload.module === 'syzygy-feed'

const shouldInjectChitchatMemory = (payload: OpenRouterPayload) => Boolean(payload.isFirstMessage)
const shouldApplyRuntimeCompression = (payload: OpenRouterPayload) =>
  !payload.module || payload.module === 'chitchat'

const DEFAULT_RECENT_UNCOMPRESSED_MESSAGES = 20
const DEFAULT_CONTEXT_TRIGGER_RATIO = 0.65
const TOKEN_OVERHEAD_PER_MESSAGE = 8
const SUMMARY_MARKER = 'CHAT SUMMARY:'
const DEFAULT_SUMMARIZER_MODEL = 'openai/gpt-4o-mini'
const MODEL_MAX_CONTEXT_TOKENS: Record<string, number> = {
  'openrouter/auto': 128000,
  'openai/gpt-4.1': 128000,
  'openai/gpt-4.1-mini': 128000,
  'openai/gpt-4o': 128000,
  'openai/gpt-4o-mini': 128000,
  'anthropic/claude-3.5-sonnet': 200000,
  'anthropic/claude-3.7-sonnet': 200000,
  'anthropic/claude-sonnet-4': 200000,
  'google/gemini-1.5-pro': 1000000,
  'google/gemini-1.5-flash': 1000000,
  'google/gemini-2.0-flash': 1000000,
}

const estimateMessageTokens = (content: string) => {
  const trimmed = content.trim()
  if (!trimmed) {
    return TOKEN_OVERHEAD_PER_MESSAGE
  }
  const chineseChars = (trimmed.match(/[\u4e00-\u9fff]/g) ?? []).length
  const englishWords = (trimmed.match(/[A-Za-z0-9_]+/g) ?? []).length
  const otherChars = Math.max(trimmed.length - chineseChars, 0)
  return Math.ceil(chineseChars * 1.7 + englishWords * 1.1 + otherChars * 0.3 + TOKEN_OVERHEAD_PER_MESSAGE)
}

const estimateTotalTokens = (messages: OpenAiMessage[]) =>
  messages.reduce((sum, message) => sum + estimateMessageTokens(message.content), 0)

const estimateModelContextLimit = (model: string) => {
  const normalized = model.toLowerCase().trim()
  const exactMatch = MODEL_MAX_CONTEXT_TOKENS[normalized]
  if (exactMatch) {
    return exactMatch
  }
  if (normalized.includes('gpt-4.1') || normalized.includes('gpt-4o')) {
    return 128000
  }
  if (normalized.includes('claude-3') || normalized.includes('claude-sonnet-4')) {
    return 200000
  }
  if (normalized.includes('gemini-1.5') || normalized.includes('gemini-2')) {
    return 1000000
  }
  return 32000
}

const fetchConversationMessages = async (
  origin: string,
  authHeader: string,
  apikey: string,
  conversationId: string,
): Promise<StoredMessageRow[]> => {
  const query = new URLSearchParams({
    select: 'id,role,content',
    session_id: `eq.${conversationId}`,
    order: 'client_created_at.asc.nullslast,created_at.asc',
  })
  const response = await fetch(`${origin}/rest/v1/messages?${query.toString()}`, {
    headers: {
      apikey,
      Authorization: authHeader,
    },
  })
  if (!response.ok) {
    throw new Error('load messages failed')
  }
  const rows = (await response.json()) as Array<Record<string, unknown>>
  return rows
    .map((row) => ({
      id: typeof row.id === 'string' ? row.id : '',
      role: row.role === 'assistant' || row.role === 'system' ? row.role : 'user',
      content: typeof row.content === 'string' ? row.content : '',
    }))
    .filter((row) => row.id && row.content)
}

const buildSupabaseClientForRequest = (authHeader: string, apikey: string) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase env missing for compression cache')
  }

  return createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: authHeader,
        apikey,
      },
    },
  })
}

const fetchCompressionCache = async (
  authHeader: string,
  apikey: string,
  conversationId: string,
): Promise<CompressionCacheRow | null> => {
  const supabase = buildSupabaseClientForRequest(authHeader, apikey)
  const { data, error } = await supabase
    .from('compression_cache')
    .select('conversation_id,compressed_up_to_message_id,summary_text,updated_at')
    .eq('conversation_id', conversationId)
    .maybeSingle<CompressionCacheRow>()

  if (error) {
    throw new Error(`compression_cache read failed: ${error.message}`)
  }

  if (data) {
    console.log('compression_cache hit', { conversationId })
  } else {
    console.log('compression_cache miss', { conversationId })
  }

  return data ?? null
}

const upsertCompressionCache = async (
  authHeader: string,
  apikey: string,
  conversationId: string,
  compressedUpToMessageId: string,
  summaryText: string,
) => {
  const supabase = buildSupabaseClientForRequest(authHeader, apikey)
  const { error } = await supabase
    .from('compression_cache')
    .upsert(
      {
      conversation_id: conversationId,
      compressed_up_to_message_id: compressedUpToMessageId,
      summary_text: summaryText,
      updated_at: new Date().toISOString(),
      },
      { onConflict: 'conversation_id' },
    )

  if (error) {
    console.error('compression_cache upsert failed', error)
    throw new Error(`compression_cache upsert failed: ${error.message}`)
  }
}

const fetchUserCompressionSettings = async (
  origin: string,
  authHeader: string,
  apikey: string,
  userId: string,
): Promise<UserCompressionSettings | null> => {
  const query = new URLSearchParams({
    select:
      'default_model,compression_enabled,compression_trigger_ratio,compression_keep_recent_messages,summarizer_model',
    user_id: `eq.${userId}`,
    limit: '1',
  })
  const response = await fetch(`${origin}/rest/v1/user_settings?${query.toString()}`, {
    headers: {
      apikey,
      Authorization: authHeader,
    },
  })
  if (!response.ok) {
    return null
  }
  const rows = (await response.json()) as UserCompressionSettings[]
  return rows[0] ?? null
}

const summarizeCompressedWindow = async (
  apiKey: string,
  summarizerModel: string,
  existingSummary: string,
  newMessages: StoredMessageRow[],
) => {
  const chunkText = newMessages
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join('\n')
  const prompt = [
    '你是对话压缩器。请生成简洁中文摘要，保留：用户偏好、已做决定、承诺事项、未决问题。',
    '不要改写或补充系统设定/人格。输出纯文本，不要 markdown。',
    '摘要长度控制在 800 字以内。',
    existingSummary ? `已有摘要：\n${existingSummary}` : '',
    `新增对话片段：\n${chunkText}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: summarizerModel,
      stream: false,
      max_tokens: 550,
      temperature: 0.2,
      messages: [
        { role: 'system', content: '你负责维护对话运行时摘要。只输出最终摘要文本。' },
        { role: 'user', content: prompt },
      ],
    }),
  })
  if (!response.ok) {
    throw new Error('summarizer failed')
  }
  const payload = (await response.json()) as Record<string, unknown>
  const choice = (payload.choices as Array<Record<string, unknown>> | undefined)?.[0]
  const message = (choice?.message as Record<string, unknown> | undefined) ?? {}
  return typeof message.content === 'string' ? message.content.trim() : ''
}

const maybeCompressRuntimeContext = async (
  payload: OpenRouterPayload,
  messages: OpenAiMessage[],
  reqUrl: string,
  authHeader: string,
  apiKeyHeader: string,
  openRouterApiKey: string,
  userId: string,
): Promise<OpenAiMessage[]> => {
  const conversationId = payload.conversationId?.trim()
  if (!shouldApplyRuntimeCompression(payload) || !conversationId) {
    return messages
  }

  const systemMessages = messages.filter((message) => message.role === 'system')
  const origin = new URL(reqUrl).origin

  try {
    const userSettings = await fetchUserCompressionSettings(
      origin,
      authHeader,
      apiKeyHeader,
      userId,
    )
    const compressionEnabled = userSettings?.compression_enabled ?? true
    if (!compressionEnabled) {
      return messages
    }
    const compressionTriggerRatio = userSettings?.compression_trigger_ratio ?? DEFAULT_CONTEXT_TRIGGER_RATIO
    const keepRecentMessages = userSettings?.compression_keep_recent_messages ?? DEFAULT_RECENT_UNCOMPRESSED_MESSAGES
    const summarizerModel = userSettings?.summarizer_model?.trim()
      || userSettings?.default_model?.trim()
      || DEFAULT_SUMMARIZER_MODEL

    const fullHistory = await fetchConversationMessages(
      origin,
      authHeader,
      apiKeyHeader,
      conversationId,
    )
    if (fullHistory.length <= keepRecentMessages) {
      return messages
    }

    const fullAsMessages: OpenAiMessage[] = fullHistory.map((message) => ({
      role: message.role,
      content: message.content,
    }))
    const contextEstimate = estimateTotalTokens([...systemMessages, ...fullAsMessages])
    const triggerLimit = Math.floor(estimateModelContextLimit(payload.model) * compressionTriggerRatio)
    if (contextEstimate < triggerLimit) {
      return messages
    }

    const compressUntilIndex = fullHistory.length - keepRecentMessages - 1
    if (compressUntilIndex < 0) {
      return messages
    }
    const targetBoundaryId = fullHistory[compressUntilIndex].id

    const cache = await fetchCompressionCache(authHeader, apiKeyHeader, conversationId)
    const targetBoundaryIndex = fullHistory.findIndex((message) => message.id === targetBoundaryId)
    const cacheBoundaryIndex = cache?.compressed_up_to_message_id
      ? fullHistory.findIndex((message) => message.id === cache.compressed_up_to_message_id)
      : -1
    let summaryText = cache?.summary_text ?? ''
    if (!cache || cacheBoundaryIndex < targetBoundaryIndex) {
      const newChunkStart = Math.max(cacheBoundaryIndex + 1, 0)
      const newCompressibleMessages = fullHistory.slice(newChunkStart, targetBoundaryIndex + 1)
      if (newCompressibleMessages.length > 0) {
        const refreshedSummary = await summarizeCompressedWindow(
          openRouterApiKey,
          summarizerModel,
          summaryText,
          newCompressibleMessages,
        )
        if (refreshedSummary) {
          summaryText = refreshedSummary
          await upsertCompressionCache(
            authHeader,
            apiKeyHeader,
            conversationId,
            targetBoundaryId,
            summaryText,
          )
        }
      }
    }

    const recentMessages = fullHistory.slice(targetBoundaryIndex + 1).map((message) => ({
      role: message.role,
      content: message.content,
    }))

    if (!summaryText) {
      return [...systemMessages, ...recentMessages]
    }
    return [
      ...systemMessages,
      { role: 'system', content: `${SUMMARY_MARKER}\n${summaryText}` },
      ...recentMessages,
    ]
  } catch (error) {
    console.error('runtime compression failed', error)
    return messages
  }
}

const fetchMemoriesByStatus = async (
  origin: string,
  authHeader: string,
  apikey: string,
  userId: string,
  status: 'confirmed' | 'pending',
): Promise<string[]> => {
  const query = new URLSearchParams({
    select: 'content',
    user_id: `eq.${userId}`,
    status: `eq.${status}`,
    is_deleted: 'eq.false',
    order: 'updated_at.desc.nullslast,created_at.desc',
    limit: '50',
  })
  const memoriesUrl = `${origin}/rest/v1/memory_entries?${query.toString()}`
  const response = await fetch(memoriesUrl, {
    headers: {
      apikey,
      Authorization: authHeader,
    },
  })
  if (!response.ok) {
    return []
  }
  const data = (await response.json()) as Array<{ content?: unknown }>
  return data
    .map((entry) => (typeof entry.content === 'string' ? entry.content.trim() : ''))
    .filter((content) => content.length > 0)
}

const maybeInjectMemory = async (
  payload: OpenRouterPayload,
  messages: OpenAiMessage[],
  userId: string,
  reqUrl: string,
  authHeader: string,
  apiKeyHeader: string,
): Promise<OpenAiMessage[]> => {
  if (
    !shouldInjectSnackFeedMemory(payload)
    && !shouldInjectSyzygyFeedMemory(payload)
    && !shouldInjectChitchatMemory(payload)
  ) {
    return messages
  }

  try {
    const [confirmedMemories, pendingMemories] = await Promise.all([
      fetchMemoriesByStatus(new URL(reqUrl).origin, authHeader, apiKeyHeader, userId, 'confirmed'),
      fetchMemoriesByStatus(new URL(reqUrl).origin, authHeader, apiKeyHeader, userId, 'pending'),
    ])
    if (confirmedMemories.length === 0 && pendingMemories.length === 0) {
      return messages
    }
    return injectMemoryBlock(messages, buildMemoryMessage(confirmedMemories, pendingMemories))
  } catch {
    // 如果记忆加载失败，则不注入，避免阻塞主流程。
    return messages
  }
}

serve(async (req) => {
  const origin = req.headers.get('origin')
  if (!isAllowedOrigin(origin)) {
    return new Response(JSON.stringify({ error: '不允许的来源' }), {
      status: 403,
      headers: {
        ...buildCorsHeaders(origin),
        'Content-Type': 'application/json',
      },
    })
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(origin),
    })
  }

  const authHeader = req.headers.get('authorization')
  const apiKeyHeader = req.headers.get('apikey')
  if (!authHeader || !apiKeyHeader) {
    return new Response(JSON.stringify({ error: '缺少身份令牌' }), {
      status: 401,
      headers: {
        ...buildCorsHeaders(origin),
        'Content-Type': 'application/json',
      },
    })
  }

  let userId: string | null = null
  try {
    const authUrl = new URL('/auth/v1/user', new URL(req.url).origin)
    const authResponse = await fetch(authUrl, {
      headers: {
        apikey: apiKeyHeader,
        Authorization: authHeader,
      },
    })
    if (!authResponse.ok) {
      return new Response(JSON.stringify({ error: '身份令牌无效' }), {
        status: 401,
        headers: {
          ...buildCorsHeaders(origin),
          'Content-Type': 'application/json',
        },
      })
    }
    const authData = (await authResponse.json()) as AuthUserResponse
    userId = authData.id
  } catch {
    return new Response(JSON.stringify({ error: '身份令牌无效' }), {
      status: 401,
      headers: {
        ...buildCorsHeaders(origin),
        'Content-Type': 'application/json',
      },
    })
  }

  let payload: OpenRouterPayload
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: '请求体格式错误' }), {
      status: 400,
      headers: {
        ...buildCorsHeaders(origin),
        'Content-Type': 'application/json',
      },
    })
  }

  const apiKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!apiKey) {
    return new Response(JSON.stringify({ error: '服务未配置' }), {
      status: 500,
      headers: {
        ...buildCorsHeaders(origin),
        'Content-Type': 'application/json',
      },
    })
  }

  const { model, temperature, top_p, max_tokens, reasoning } = payload
  const stream = payload.stream ?? true
  let messages = payload.messages

  if (userId) {
    messages = await maybeInjectMemory(payload, messages, userId, req.url, authHeader, apiKeyHeader)
    messages = await maybeCompressRuntimeContext(
      payload,
      messages,
      req.url,
      authHeader,
      apiKeyHeader,
      apiKey,
      userId,
    )
  }

  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        top_p,
        max_tokens,
        ...(reasoning ? { reasoning: { effort: 'medium' } } : {}),
        stream,
      }),
    })

    if (!upstream.ok) {
      const errorText = await upstream.text()
      return new Response(JSON.stringify({ error: errorText || '上游服务错误' }), {
        status: upstream.status,
        headers: {
          ...buildCorsHeaders(origin),
          'Content-Type': 'application/json',
        },
      })
    }

    if (stream) {
      if (!upstream.body) {
        return new Response(JSON.stringify({ error: '无响应内容' }), {
          status: 502,
          headers: {
            ...buildCorsHeaders(origin),
            'Content-Type': 'application/json',
          },
        })
      }

      return new Response(upstream.body, {
        status: 200,
        headers: {
          ...buildCorsHeaders(origin),
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      })
    }

    const payloadText = await upstream.text()
    return new Response(payloadText, {
      status: 200,
      headers: {
        ...buildCorsHeaders(origin),
        'Content-Type': 'application/json',
      },
    })
  } catch {
    return new Response(JSON.stringify({ error: '请求失败' }), {
      status: 500,
      headers: {
        ...buildCorsHeaders(origin),
        'Content-Type': 'application/json',
      },
    })
  }
})
