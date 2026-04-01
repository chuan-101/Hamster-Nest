import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type OpenAiMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

type OpenRouterPayload = {
  messages: OpenAiMessage[]
  model?: string
  modelId?: string
  conversationId?: string
  temperature?: number
  top_p?: number
  max_tokens?: number
  reasoning?: boolean | Record<string, unknown>
  stream?: boolean
  module?: 'snack-feed' | 'syzygy-feed' | 'bubble-chat' | 'rp-room' | string
  rpKeepRecentMessages?: number
  debug?: boolean
  extra?: Record<string, unknown>
}

type StoredMessageRow = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

type CompressionCacheRow = {
  module: 'chat' | 'rp'
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

type RpSessionCompressionSettingsRow = {
  rp_context_token_limit: number | null
  rp_keep_recent_messages: number | null
  settings: Record<string, unknown> | null
}

type AuthUserResponse = {
  id: string
}

type RagConfigRow = {
  config_key: string | null
  config_value: unknown
}

type RagRuntimeConfig = {
  ragEnabled: boolean
  searchTopK: number
  searchThreshold: number
  defaultSearchZones: string[]
  rpSearchMode: 'story_group' | 'session' | 'all_rp'
  embeddingModel: string
  embeddingDimensions: number
}

type RagChunkRow = {
  chunk_text?: unknown
  similarity?: unknown
}

type RuntimeCompressionResult = {
  messages: OpenAiMessage[]
  cacheWriteFailed: boolean
  cacheWriteSucceeded: boolean
  cacheWriteErrorMessage: string | null
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
  'Access-Control-Expose-Headers': 'x-rp-compression-cache-write,x-rp-compression-cache-error',
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

const RAG_DEFAULTS = {
  ragEnabled: true,
  searchTopK: 5,
  searchThreshold: 0.7,
  defaultSearchZones: ['daily_chat', 'bubble', 'letter'],
  rpSearchMode: 'story_group' as const,
  embeddingModel: 'text-embedding-3-small',
  embeddingDimensions: 1536,
}

const RAG_EMBEDDING_VERSION = 'v1'

const shouldInjectSnackFeedMemory = (payload: OpenRouterPayload) => payload.module === 'snack-feed'

const resolveReasoningPayload = (reasoning: OpenRouterPayload['reasoning']) => {
  if (reasoning === true) {
    return { effort: 'medium' }
  }
  if (reasoning && typeof reasoning === 'object' && !Array.isArray(reasoning)) {
    return reasoning
  }
  return null
}

const flattenOpenRouterTextParts = (value: unknown): string => {
  if (typeof value === 'string') {
    return value
  }
  if (!Array.isArray(value)) {
    return ''
  }
  return value
    .map((part) => {
      if (typeof part === 'string') {
        return part
      }
      if (!part || typeof part !== 'object') {
        return ''
      }
      const candidate = part as Record<string, unknown>
      if (typeof candidate.text === 'string') {
        return candidate.text
      }
      if (typeof candidate.content === 'string') {
        return candidate.content
      }
      return ''
    })
    .filter(Boolean)
    .join('')
}

const extractOpenRouterContent = (payload: Record<string, unknown>): string => {
  const choice = (payload?.choices as unknown[] | undefined)?.[0] as Record<string, unknown> | undefined
  const message = ((choice?.message as Record<string, unknown>) ?? choice ?? {}) as Record<string, unknown>
  const messageContent = flattenOpenRouterTextParts(message.content)
  const choiceText = typeof choice?.text === 'string' ? choice.text : ''
  const outputText = flattenOpenRouterTextParts(payload.output_text)
  const outputParts = flattenOpenRouterTextParts(payload.output)
  const candidate = [messageContent, choiceText, outputText, outputParts].find((item) => item.trim())
  return (candidate ?? '').trim()
}

const shouldInjectSyzygyFeedMemory = (payload: OpenRouterPayload) => payload.module === 'syzygy-feed'

const shouldInjectChitchatMemory = (payload: OpenRouterPayload) =>
  !payload.module || payload.module === 'chitchat'

const shouldInjectBubbleChatMemory = (payload: OpenRouterPayload) => payload.module === 'bubble-chat'
const resolveCompressionModule = (payload: OpenRouterPayload): 'chat' | 'rp' | null => {
  if (!payload.module || payload.module === 'chitchat') {
    return 'chat'
  }
  if (payload.module === 'rp-room') {
    return 'rp'
  }
  return null
}

const DEFAULT_RECENT_UNCOMPRESSED_MESSAGES_CHAT = 20
const DEFAULT_RECENT_UNCOMPRESSED_MESSAGES_RP = 10
const MIN_RECENT_UNCOMPRESSED_MESSAGES_RP = 5
const MIN_DYNAMIC_KEEP_RECENT_MESSAGES_RP = 3
const MAX_RECENT_UNCOMPRESSED_MESSAGES_RP = 20
const MIN_EXTRA_MESSAGES_FOR_COMPRESSION = 25
const MIN_NEW_MESSAGES_BEFORE_RESUMMARIZE = 5
const DEFAULT_CONTEXT_TRIGGER_RATIO = 0.65
const DEFAULT_RP_CONTEXT_TOKEN_LIMIT = 32000
const MIN_RP_CONTEXT_TOKEN_LIMIT = 8000
const MAX_RP_CONTEXT_TOKEN_LIMIT = 128000
const TOKEN_OVERHEAD_PER_MESSAGE = 8
const CHAT_SUMMARY_MARKER = 'CHAT SUMMARY:'
const RP_SUMMARY_MARKER = '以下为截至目前的剧情摘要：'
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


const normalizeModelId = (modelId: string | null | undefined) => {
  const normalized = modelId?.trim()
  return normalized && normalized.length > 0 ? normalized : null
}

const resolveRequestModelId = async (
  payload: OpenRouterPayload,
  reqUrl: string,
  authHeader: string,
  apiKeyHeader: string,
  userId: string,
) => {
  const explicitModelId = normalizeModelId(payload.modelId) ?? normalizeModelId(payload.model)
  if (explicitModelId) {
    return explicitModelId
  }

  const origin = new URL(reqUrl).origin
  const userSettings = await fetchUserCompressionSettings(origin, authHeader, apiKeyHeader, userId)
  return normalizeModelId(userSettings?.default_model) ?? 'openrouter/auto'
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

const buildSupabaseServiceRoleClient = () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase env missing for service-role compression cache')
  }

  return createClient(supabaseUrl, serviceRoleKey)
}

const fetchCompressionCache = async (
  module: 'chat' | 'rp',
  conversationId: string,
): Promise<CompressionCacheRow | null> => {
  const supabase = buildSupabaseServiceRoleClient()
  const { data, error } = await supabase
    .from('compression_cache')
    .select('module,conversation_id,compressed_up_to_message_id,summary_text,updated_at')
    .eq('module', module)
    .eq('conversation_id', conversationId)
    .order('updated_at', { ascending: false })
    .limit(1)
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
  module: 'chat' | 'rp',
  conversationId: string,
  compressedUpToMessageId: string,
  summaryText: string,
) => {
  const supabase = buildSupabaseServiceRoleClient()
  const result = await supabase
    .from('compression_cache')
    .upsert(
      {
        module,
        conversation_id: conversationId,
        compressed_up_to_message_id: compressedUpToMessageId,
        summary_text: summaryText,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'module,conversation_id' },
    )

  if (result.error) {
    console.error('compression_cache upsert failed', JSON.stringify({
      module,
      conversationId,
      compressedUpToMessageId,
      message: result.error.message,
      code: result.error.code,
      details: result.error.details,
      hint: result.error.hint,
    }))
  }

  return result
}

const formatHistoryMessagesForCompression = (
  compressionModule: 'chat' | 'rp',
  fullHistory: StoredMessageRow[],
): OpenAiMessage[] => (compressionModule === 'rp'
  ? fullHistory.map((message) => ({ role: 'assistant', content: `【${message.role}】${message.content}` }))
  : fullHistory.map((message) => ({ role: message.role, content: message.content })))

const buildSummarizedMessages = (
  compressionModule: 'chat' | 'rp',
  systemMessages: OpenAiMessage[],
  summaryText: string,
  fullHistory: StoredMessageRow[],
  compressedUpToIndex: number,
  keepRecentMessages: number,
  rpContextTokenLimit: number,
  conversationId: string,
): { summarizedMessages: OpenAiMessage[]; effectiveKeepRecentMessages: number } => {
  const summaryMessage: OpenAiMessage = {
    role: 'system',
    content:
      compressionModule === 'rp'
        ? `${RP_SUMMARY_MARKER}${summaryText}`
        : `${CHAT_SUMMARY_MARKER}\n${summaryText}`,
  }
  const fullRecentHistory = fullHistory.slice(compressedUpToIndex + 1)
  let effectiveKeepRecentMessages = keepRecentMessages
  let recentHistorySlice =
    compressionModule === 'rp' ? fullRecentHistory.slice(-effectiveKeepRecentMessages) : fullRecentHistory
  let summarizedMessages: OpenAiMessage[] = [
    ...systemMessages,
    summaryMessage,
    ...formatHistoryMessagesForCompression(compressionModule, recentHistorySlice),
  ]

  if (compressionModule === 'rp' && rpContextTokenLimit > 0) {
    while (
      estimateTotalTokens(summarizedMessages) > rpContextTokenLimit
      && effectiveKeepRecentMessages > MIN_DYNAMIC_KEEP_RECENT_MESSAGES_RP
    ) {
      effectiveKeepRecentMessages -= 1
      recentHistorySlice = fullRecentHistory.slice(-effectiveKeepRecentMessages)
      summarizedMessages = [
        ...systemMessages,
        summaryMessage,
        ...formatHistoryMessagesForCompression(compressionModule, recentHistorySlice),
      ]
    }

    if (estimateTotalTokens(summarizedMessages) > rpContextTokenLimit) {
      console.warn('rp compression output still exceeds context token limit', {
        conversationId,
        rpContextTokenLimit,
        finalTokens: estimateTotalTokens(summarizedMessages),
        effectiveKeepRecentMessages,
      })
    }
  }

  return { summarizedMessages, effectiveKeepRecentMessages }
}

const fetchRpConversationMessages = async (
  origin: string,
  authHeader: string,
  apikey: string,
  conversationId: string,
): Promise<StoredMessageRow[]> => {
  const query = new URLSearchParams({
    select: 'id,role,content',
    session_id: `eq.${conversationId}`,
    order: 'created_at.asc',
  })
  const response = await fetch(`${origin}/rest/v1/rp_messages?${query.toString()}`, {
    headers: {
      apikey,
      Authorization: authHeader,
    },
  })
  if (!response.ok) {
    throw new Error('load rp_messages failed')
  }
  const rows = (await response.json()) as Array<Record<string, unknown>>
  return rows
    .map((row) => ({
      id: typeof row.id === 'string' ? row.id : '',
      role: typeof row.role === 'string' && row.role.trim() ? row.role.trim() : '未知角色',
      content: typeof row.content === 'string' ? row.content : '',
    }))
    .filter((row) => row.id && row.content)
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

const fetchRpSessionCompressionSettings = async (
  origin: string,
  authHeader: string,
  apikey: string,
  conversationId: string,
): Promise<RpSessionCompressionSettingsRow | null> => {
  const query = new URLSearchParams({
    select: 'rp_context_token_limit,rp_keep_recent_messages,settings',
    id: `eq.${conversationId}`,
    limit: '1',
  })
  const response = await fetch(`${origin}/rest/v1/rp_sessions?${query.toString()}`, {
    headers: {
      apikey,
      Authorization: authHeader,
    },
  })
  if (!response.ok) {
    throw new Error('load rp session settings failed')
  }
  const rows = (await response.json()) as Array<Record<string, unknown>>
  const row = rows[0]
  if (!row) {
    return null
  }
  return {
    rp_context_token_limit: typeof row.rp_context_token_limit === 'number' ? row.rp_context_token_limit : null,
    rp_keep_recent_messages: typeof row.rp_keep_recent_messages === 'number' ? row.rp_keep_recent_messages : null,
    settings: typeof row.settings === 'object' && row.settings
      ? row.settings as Record<string, unknown>
      : null,
  }
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
): Promise<RuntimeCompressionResult> => {
  const compressionModule = resolveCompressionModule(payload)
  const conversationId = payload.conversationId?.trim()
  if (!compressionModule || !conversationId) {
    return { messages, cacheWriteFailed: false, cacheWriteSucceeded: false, cacheWriteErrorMessage: null }
  }

  const systemMessages = messages.filter((message) => message.role === 'system')
  const origin = new URL(reqUrl).origin

  let cacheWriteFailed = false
  let cacheWriteSucceeded = false
  let cacheWriteErrorMessage: string | null = null
  try {
    const userSettings = await fetchUserCompressionSettings(
      origin,
      authHeader,
      apiKeyHeader,
      userId,
    )
    const compressionEnabled = userSettings?.compression_enabled ?? true
    if (!compressionEnabled) {
      return { messages, cacheWriteFailed, cacheWriteSucceeded, cacheWriteErrorMessage }
    }
    const compressionTriggerRatio = userSettings?.compression_trigger_ratio ?? DEFAULT_CONTEXT_TRIGGER_RATIO
    const rawKeepRecentMessages = userSettings?.compression_keep_recent_messages
    const rpSessionCompressionSettings =
      compressionModule === 'rp'
        ? await fetchRpSessionCompressionSettings(origin, authHeader, apiKeyHeader, conversationId)
        : null
    const fallbackRpKeepRecentMessagesFromSettings =
      rpSessionCompressionSettings?.settings && typeof rpSessionCompressionSettings.settings.compression_keep_recent_messages === 'number'
        ? rpSessionCompressionSettings.settings.compression_keep_recent_messages
        : null
    const rpKeepRecentMessages =
      rpSessionCompressionSettings?.rp_keep_recent_messages
      ?? fallbackRpKeepRecentMessagesFromSettings
      ?? rawKeepRecentMessages
      ?? DEFAULT_RECENT_UNCOMPRESSED_MESSAGES_RP
    const keepRecentMessages =
      compressionModule === 'rp'
        ? Math.min(
            Math.max(rpKeepRecentMessages, MIN_RECENT_UNCOMPRESSED_MESSAGES_RP),
            MAX_RECENT_UNCOMPRESSED_MESSAGES_RP,
          )
        : (rawKeepRecentMessages ?? DEFAULT_RECENT_UNCOMPRESSED_MESSAGES_CHAT)
    const summarizerModel = userSettings?.summarizer_model?.trim()
      || userSettings?.default_model?.trim()
      || DEFAULT_SUMMARIZER_MODEL

    const fullHistory =
      compressionModule === 'rp'
        ? await fetchRpConversationMessages(origin, authHeader, apiKeyHeader, conversationId)
        : await fetchConversationMessages(origin, authHeader, apiKeyHeader, conversationId)
    const totalHistoryMessages = fullHistory.length
    if (totalHistoryMessages <= keepRecentMessages + MIN_EXTRA_MESSAGES_FOR_COMPRESSION) {
      if (compressionModule === 'rp') {
        const historyAsMessages = formatHistoryMessagesForCompression(compressionModule, fullHistory)
        return {
          messages: [...systemMessages, ...historyAsMessages],
          cacheWriteFailed,
          cacheWriteSucceeded,
          cacheWriteErrorMessage,
        }
      }

      return { messages, cacheWriteFailed, cacheWriteSucceeded, cacheWriteErrorMessage }
    }

    const preCompressionTokens = estimateTotalTokens(messages)

    const fullAsMessages: OpenAiMessage[] = formatHistoryMessagesForCompression(compressionModule, fullHistory)
    const contextEstimate = estimateTotalTokens([...systemMessages, ...fullAsMessages])
    const fallbackRpContextLimitFromSettings =
      rpSessionCompressionSettings?.settings && typeof rpSessionCompressionSettings.settings.rp_context_token_limit === 'number'
        ? rpSessionCompressionSettings.settings.rp_context_token_limit
        : null
    const rpContextTokenLimit = Math.min(
      Math.max(
        rpSessionCompressionSettings?.rp_context_token_limit
          ?? fallbackRpContextLimitFromSettings
          ?? DEFAULT_RP_CONTEXT_TOKEN_LIMIT,
        MIN_RP_CONTEXT_TOKEN_LIMIT,
      ),
      MAX_RP_CONTEXT_TOKEN_LIMIT,
    )
    const baseContextLimit =
      compressionModule === 'rp'
        ? rpContextTokenLimit
        : estimateModelContextLimit(payload.model ?? 'openrouter/auto')
    const triggerLimit = Math.floor(baseContextLimit * compressionTriggerRatio)
    if (contextEstimate < triggerLimit) {
      return { messages, cacheWriteFailed, cacheWriteSucceeded, cacheWriteErrorMessage }
    }

    const compressUntilIndex = fullHistory.length - keepRecentMessages - 1
    if (compressUntilIndex < 0) {
      return { messages, cacheWriteFailed, cacheWriteSucceeded, cacheWriteErrorMessage }
    }
    const targetBoundaryId = fullHistory[compressUntilIndex].id

    const cache = await fetchCompressionCache(compressionModule, conversationId)
    const targetBoundaryIndex = fullHistory.findIndex((message) => message.id === targetBoundaryId)
    let cacheBoundaryIndex = cache?.compressed_up_to_message_id
      ? fullHistory.findIndex((message) => message.id === cache.compressed_up_to_message_id)
      : -1
    let summaryText = cache?.summary_text ?? ''
    if (cache && cacheBoundaryIndex < 0) {
      summaryText = ''
    }

    const hasValidCachedSummary = Boolean(cache?.summary_text?.trim())
    const newMessagesCount = targetBoundaryIndex - cacheBoundaryIndex
    if (hasValidCachedSummary && newMessagesCount < MIN_NEW_MESSAGES_BEFORE_RESUMMARIZE) {
      const compressedUpToIndex = summaryText ? cacheBoundaryIndex : -1
      const { summarizedMessages } = buildSummarizedMessages(
        compressionModule,
        systemMessages,
        summaryText,
        fullHistory,
        compressedUpToIndex,
        keepRecentMessages,
        rpContextTokenLimit,
        conversationId,
      )

      return {
        messages: summarizedMessages,
        cacheWriteFailed,
        cacheWriteSucceeded,
        cacheWriteErrorMessage,
      }
    }

    const uncachedCompressibleMessages = targetBoundaryIndex - cacheBoundaryIndex
    const shouldRefreshSummary =
      !summaryText
      || uncachedCompressibleMessages >= MIN_NEW_MESSAGES_BEFORE_RESUMMARIZE

    if (shouldRefreshSummary && cacheBoundaryIndex < targetBoundaryIndex) {
      const newChunkStart = Math.max(cacheBoundaryIndex + 1, 0)
      const refreshBoundaryIndex =
        !summaryText
          ? targetBoundaryIndex
          : (cacheBoundaryIndex + uncachedCompressibleMessages)
      const refreshBoundaryId = fullHistory[refreshBoundaryIndex]?.id
      if (!refreshBoundaryId) {
        return { messages, cacheWriteFailed, cacheWriteSucceeded, cacheWriteErrorMessage }
      }
      const newCompressibleMessages = fullHistory.slice(newChunkStart, refreshBoundaryIndex + 1)
      if (newCompressibleMessages.length > 0) {
        const refreshedSummary = await summarizeCompressedWindow(
          openRouterApiKey,
          summarizerModel,
          summaryText,
          newCompressibleMessages,
        )
        summaryText = refreshedSummary || summaryText
        if (summaryText) {
          const { data, error } = await upsertCompressionCache(
            compressionModule,
            conversationId,
            refreshBoundaryId,
            summaryText,
          )
          if (error) {
            cacheWriteFailed = true
            cacheWriteErrorMessage = JSON.stringify({
              message: error.message,
              code: error.code,
              details: error.details,
              hint: error.hint,
            })
            console.error('compression_cache upsert failed', cacheWriteErrorMessage)
          } else {
            cacheWriteSucceeded = true
            console.log('compression_cache upsert succeeded', {
              module: compressionModule,
              conversationId,
              compressedUpToMessageId: refreshBoundaryId,
              rows: Array.isArray(data) ? data.length : 0,
            })
            cacheBoundaryIndex = refreshBoundaryIndex
          }
        }
      }
    }

    if (!summaryText) {
      return { messages, cacheWriteFailed, cacheWriteSucceeded, cacheWriteErrorMessage }
    }
    const compressedUpToIndex = summaryText ? cacheBoundaryIndex : -1
    const { summarizedMessages, effectiveKeepRecentMessages } = buildSummarizedMessages(
      compressionModule,
      systemMessages,
      summaryText,
      fullHistory,
      compressedUpToIndex,
      keepRecentMessages,
      rpContextTokenLimit,
      conversationId,
    )

    const finalTokens = estimateTotalTokens(summarizedMessages)
    const reductionRatio = preCompressionTokens > 0
      ? (preCompressionTokens - finalTokens) / preCompressionTokens
      : 0
    if (finalTokens >= preCompressionTokens || reductionRatio < 0.3) {
      console.warn('compression token reduction below expectation', {
        module: compressionModule,
        conversationId,
        preCompressionTokens,
        finalTokens,
        reductionRatio,
        keepRecentMessages: effectiveKeepRecentMessages,
      })
    }

    return { messages: summarizedMessages, cacheWriteFailed, cacheWriteSucceeded, cacheWriteErrorMessage }
  } catch (error) {
    console.error('runtime compression failed', error)
    return { messages, cacheWriteFailed, cacheWriteSucceeded, cacheWriteErrorMessage }
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

const loadRagConfig = async (
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<RagRuntimeConfig> => {
  const keys = [
    'rag_enabled',
    'search_top_k',
    'search_threshold',
    'default_search_zones',
    'rp_search_mode',
    'embedding_model',
    'embedding_dimensions',
  ]

  const { data, error } = await serviceClient
    .from('rag_config')
    .select('config_key, config_value')
    .eq('user_id', userId)
    .in('config_key', keys)

  if (error || !data) {
    console.warn('[rag] failed to load rag_config; using defaults', { userId, error })
    return { ...RAG_DEFAULTS }
  }

  const map = new Map<string, unknown>()
  for (const row of data as RagConfigRow[]) {
    if (!row.config_key || row.config_value === null || row.config_value === undefined) continue
    map.set(row.config_key, row.config_value)
  }

  const parseInteger = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isInteger(v)) return v
    if (typeof v === 'string') { const n = Number.parseInt(v, 10); return Number.isNaN(n) ? null : n }
    return null
  }
  const parseFloat_ = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string') { const n = Number.parseFloat(v); return Number.isNaN(n) ? null : n }
    return null
  }

  const rawZones = map.get('default_search_zones')
  let parsedZones: string[] | null = null
  if (Array.isArray(rawZones)) {
    parsedZones = rawZones.map((e) => String(e).trim()).filter(Boolean)
  } else if (typeof rawZones === 'string') {
    parsedZones = rawZones.split(',').map((e) => e.trim()).filter(Boolean)
  }

  const rpRaw = map.get('rp_search_mode')
  const rpCandidate = typeof rpRaw === 'string' ? rpRaw.trim().toLowerCase() : ''
  const rpSearchMode: RagRuntimeConfig['rpSearchMode'] =
    rpCandidate === 'session' || rpCandidate === 'all_rp' ? rpCandidate : RAG_DEFAULTS.rpSearchMode

  const rawEnabled = map.get('rag_enabled')
  const ragEnabled =
    rawEnabled === false || rawEnabled === 'false' || rawEnabled === '0' || rawEnabled === 0
      ? false
      : RAG_DEFAULTS.ragEnabled

  return {
    ragEnabled,
    searchTopK: parseInteger(map.get('search_top_k')) ?? RAG_DEFAULTS.searchTopK,
    searchThreshold: parseFloat_(map.get('search_threshold')) ?? RAG_DEFAULTS.searchThreshold,
    defaultSearchZones: parsedZones && parsedZones.length > 0 ? parsedZones : RAG_DEFAULTS.defaultSearchZones,
    rpSearchMode,
    embeddingModel:
      typeof map.get('embedding_model') === 'string' && (map.get('embedding_model') as string).trim()
        ? (map.get('embedding_model') as string).trim()
        : RAG_DEFAULTS.embeddingModel,
    embeddingDimensions: parseInteger(map.get('embedding_dimensions')) ?? RAG_DEFAULTS.embeddingDimensions,
  }
}

const fetchRagEmbedding = async (
  apiKey: string,
  model: string,
  dimensions: number,
  query: string,
): Promise<number[] | null> => {
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input: query, dimensions }),
    })
    if (!resp.ok) return null
    const body = (await resp.json()) as { data?: Array<{ embedding?: number[] }> }
    const embedding = body.data?.[0]?.embedding
    return Array.isArray(embedding) && embedding.length > 0 ? embedding : null
  } catch {
    return null
  }
}

const resolveRpStoryGroupId = async (
  serviceClient: ReturnType<typeof createClient>,
  sessionId: string,
): Promise<string | null> => {
  const { data, error } = await serviceClient
    .from('rp_session_groups')
    .select('story_group_id')
    .eq('session_id', sessionId)
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  const groupId = (data as Record<string, unknown>).story_group_id
  return typeof groupId === 'string' && groupId.trim() ? groupId.trim() : null
}

const maybeInjectRagContext = async (
  payload: OpenRouterPayload,
  messages: OpenAiMessage[],
  userId: string,
  openRouterApiKey: string,
): Promise<OpenAiMessage[]> => {
  const isChitchat = !payload.module || payload.module === 'chitchat'
  const isRp = payload.module === 'rp-room'
  if (!isChitchat && !isRp) return messages

  try {
    const serviceClient = buildSupabaseServiceRoleClient()
    const ragConfig = await loadRagConfig(serviceClient, userId)

    if (!ragConfig.ragEnabled) return messages

    // Determine zones and metadata filter
    let zones: string[]
    let metadataFilter: Record<string, unknown> | null = null

    if (isRp) {
      zones = ['rp']
      const sessionId = payload.conversationId?.trim()
      if (ragConfig.rpSearchMode === 'all_rp') {
        // No metadata filter — search all RP data
      } else if (ragConfig.rpSearchMode === 'session') {
        if (sessionId) {
          metadataFilter = { session_id: sessionId }
        }
      } else {
        // story_group mode (default)
        if (sessionId) {
          const storyGroupId = await resolveRpStoryGroupId(serviceClient, sessionId)
          if (storyGroupId) {
            metadataFilter = { story_group_id: storyGroupId }
          } else {
            // Fallback: session not in any group, filter by session_id
            metadataFilter = { session_id: sessionId }
          }
        }
      }
    } else {
      zones = ragConfig.defaultSearchZones
    }

    // Extract latest user message as query
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
    const query = lastUserMessage?.content?.trim()
    if (!query) return messages

    // Get embedding
    const embedding = await fetchRagEmbedding(
      openRouterApiKey,
      ragConfig.embeddingModel,
      ragConfig.embeddingDimensions,
      query,
    )
    if (!embedding) return messages

    // Call match_rag_chunks RPC with multiple signature attempts
    const rpcArgs = [
      {
        p_user_id: userId,
        p_query_embedding: embedding,
        p_zones: zones,
        p_threshold: ragConfig.searchThreshold,
        p_top_k: ragConfig.searchTopK,
        p_metadata_filter: metadataFilter,
        p_embedding_model: ragConfig.embeddingModel,
        p_embedding_version: RAG_EMBEDDING_VERSION,
      },
      {
        query_embedding: embedding,
        filter_user_id: userId,
        zones,
        match_threshold: ragConfig.searchThreshold,
        match_count: ragConfig.searchTopK,
        metadata_filter: metadataFilter,
        embedding_model: ragConfig.embeddingModel,
        embedding_version: RAG_EMBEDDING_VERSION,
      },
      {
        embedding,
        user_id: userId,
        zones,
        threshold: ragConfig.searchThreshold,
        top_k: ragConfig.searchTopK,
        metadata_filter: metadataFilter,
        embedding_model: ragConfig.embeddingModel,
        embedding_version: RAG_EMBEDDING_VERSION,
      },
    ]

    let chunks: RagChunkRow[] | null = null
    for (const args of rpcArgs) {
      const { data, error } = await serviceClient.rpc('match_rag_chunks', args)
      if (!error) {
        chunks = (data ?? []) as RagChunkRow[]
        break
      }
      const msg = String((error as { message?: string }).message ?? '')
      if (!msg.includes('Could not find the function') && !msg.includes('function match_rag_chunks')) {
        console.warn('[rag] match_rag_chunks RPC failed', { userId, error })
        return messages
      }
    }

    if (!chunks || chunks.length === 0) return messages

    const chunkTexts = chunks
      .map((c) => (typeof c.chunk_text === 'string' ? c.chunk_text.trim() : ''))
      .filter(Boolean)

    if (chunkTexts.length === 0) return messages

    const ragSystemMessage: OpenAiMessage = {
      role: 'system',
      content: ['[相关记忆 - 以下内容来自历史对话，供参考]', ...chunkTexts.map((t) => `- ${t}`)].join('\n'),
    }

    return injectMemoryBlock(messages, ragSystemMessage)
  } catch (error) {
    console.warn('[rag] RAG retrieval failed, skipping injection', error)
    return messages
  }
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
    && !shouldInjectBubbleChatMemory(payload)
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

const computeSha256Hex = async (text: string): Promise<string> => {
  const data = new TextEncoder().encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const maybeWriteDailyChatRagChunk = async (
  userMessage: string,
  assistantReply: string,
  userId: string,
  sessionId: string,
  openRouterApiKey: string,
): Promise<void> => {
  try {
    const chunkText = `[user]: ${userMessage}\n[assistant]: ${assistantReply}`
    const serviceClient = buildSupabaseServiceRoleClient()

    const ragConfig = await loadRagConfig(serviceClient, userId)
    if (!ragConfig.ragEnabled) return

    const embedding = await fetchRagEmbedding(
      openRouterApiKey,
      ragConfig.embeddingModel,
      ragConfig.embeddingDimensions,
      chunkText,
    )
    if (!embedding) {
      console.log('[rag-write] embedding generation failed, skipping chunk write')
      return
    }

    const contentHash = await computeSha256Hex(chunkText)
    const sourceId = crypto.randomUUID()

    const { error } = await serviceClient.from('rag_embeddings').insert({
      user_id: userId,
      source: 'hamster-nest',
      zone: 'daily_chat',
      source_table: 'messages',
      source_id: sourceId,
      chunk_text: chunkText,
      embedding,
      content_hash: contentHash,
      embedding_model: ragConfig.embeddingModel,
      embedding_version: RAG_EMBEDDING_VERSION,
      metadata: { session_id: sessionId },
    })

    if (error) {
      const code = (error as { code?: string }).code
      if (code === '23505') {
        console.log('[rag-write] duplicate content_hash, skipping')
      } else {
        console.log('[rag-write] insert failed', { message: error.message, code })
      }
    }
  } catch (err) {
    console.log('[rag-write] unexpected error, skipping', err)
  }
}

const collectSseStream = async (
  stream: ReadableStream<Uint8Array>,
): Promise<string> => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let fullText = ''
  let assistantContent = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      fullText += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }

  // Parse SSE lines to extract assistant content
  for (const line of fullText.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const jsonStr = line.slice(6).trim()
    if (jsonStr === '[DONE]') break
    try {
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>
      const delta = ((parsed.choices as unknown[] | undefined)?.[0] as Record<string, unknown> | undefined)
        ?.delta as Record<string, unknown> | undefined
      if (typeof delta?.content === 'string') {
        assistantContent += delta.content
      }
    } catch {
      // skip unparseable SSE chunks
    }
  }

  return assistantContent.trim()
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

  const { temperature, top_p, max_tokens, reasoning } = payload
  const stream = payload.stream ?? true
  const isForumModule = payload.module === 'forum'
  const isDailyChat = !payload.module || payload.module === 'chitchat'
  if (isForumModule) {
    console.info('[openrouter-chat][forum] incoming payload', {
      module: payload.module,
      model: payload.model,
      modelId: payload.modelId,
      stream,
      messageCount: Array.isArray(payload.messages) ? payload.messages.length : 0,
      hasExtra: Boolean(payload.extra),
      extraScope: typeof payload.extra?.scope === 'string' ? payload.extra.scope : null,
      identitySlot: typeof payload.extra?.identitySlot === 'number' ? payload.extra.identitySlot : null,
    })
  }
  const resolvedModelId = await resolveRequestModelId(payload, req.url, authHeader, apiKeyHeader, userId)
  let messages = payload.messages
  let compressionCacheWriteFailed = false
  let compressionCacheWriteSucceeded = false
  let compressionCacheWriteErrorMessage: string | null = null
  const debugEnabled = payload.debug === true
  const compressionModule = resolveCompressionModule(payload)
  const resolvedPayload: OpenRouterPayload = {
    ...payload,
    model: resolvedModelId,
    modelId: resolvedModelId,
  }

  if (userId) {
    messages = await maybeInjectMemory(resolvedPayload, messages, userId, req.url, authHeader, apiKeyHeader)
    const compressionResult = await maybeCompressRuntimeContext(
      resolvedPayload,
      messages,
      req.url,
      authHeader,
      apiKeyHeader,
      apiKey,
      userId,
    )
    messages = compressionResult.messages
    compressionCacheWriteFailed = compressionResult.cacheWriteFailed
    compressionCacheWriteSucceeded = compressionResult.cacheWriteSucceeded
    compressionCacheWriteErrorMessage = compressionResult.cacheWriteErrorMessage

    messages = await maybeInjectRagContext(resolvedPayload, messages, userId, apiKey)
  }

  const buildRpCompressionDebugHeaders = () => {
    if (!debugEnabled || compressionModule !== 'rp') {
      return {}
    }
    if (compressionCacheWriteFailed) {
      return {
        'x-rp-compression-cache-write': 'failed',
        'x-rp-compression-cache-error': encodeURIComponent(compressionCacheWriteErrorMessage ?? '未知错误'),
      }
    }
    if (compressionCacheWriteSucceeded) {
      return {
        'x-rp-compression-cache-write': 'success',
      }
    }
    return {}
  }

  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: resolvedModelId,
        messages,
        temperature,
        top_p,
        max_tokens,
        ...(resolveReasoningPayload(reasoning) ? { reasoning: resolveReasoningPayload(reasoning) } : {}),
        stream,
      }),
    })

    if (!upstream.ok) {
      const errorText = await upstream.text()
      if (isForumModule) {
        console.error('[openrouter-chat][forum] upstream error', {
          status: upstream.status,
          bodyPreview: errorText.slice(0, 1000),
        })
      }
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

      // For daily chat, tee the stream to collect assistant content for RAG write
      if (isDailyChat && userId && payload.conversationId) {
        const [clientStream, collectStream] = upstream.body.tee()
        const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content?.trim()
        if (lastUserMsg) {
          const sessId = payload.conversationId
          const uid = userId
          collectSseStream(collectStream).then((assistantContent) => {
            if (assistantContent) {
              maybeWriteDailyChatRagChunk(lastUserMsg, assistantContent, uid, sessId, apiKey)
            }
          }).catch((err) => console.log('[rag-write] stream collect error', err))
        }
        return new Response(clientStream, {
          status: 200,
          headers: {
            ...buildCorsHeaders(origin),
            ...buildRpCompressionDebugHeaders(),
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
          },
        })
      }

      return new Response(upstream.body, {
        status: 200,
        headers: {
          ...buildCorsHeaders(origin),
          ...buildRpCompressionDebugHeaders(),
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      })
    }

    const payloadText = await upstream.text()
    if (isForumModule) {
      console.info('[openrouter-chat][forum] upstream non-stream payload length', payloadText.length)
    }
    if (!payloadText.trim()) {
      if (isForumModule) {
        console.error('[openrouter-chat][forum] empty upstream body with HTTP 200')
      }
      return new Response(JSON.stringify({ error: '上游返回空响应', code: 'EMPTY_UPSTREAM_BODY' }), {
        status: 502,
        headers: {
          ...buildCorsHeaders(origin),
          ...buildRpCompressionDebugHeaders(),
          'Content-Type': 'application/json',
        },
      })
    }

    let parsedUpstreamPayload: Record<string, unknown> | null = null
    try {
      parsedUpstreamPayload = JSON.parse(payloadText) as Record<string, unknown>
    } catch {
      parsedUpstreamPayload = null
    }

    if (isForumModule) {
      const extractedContent = parsedUpstreamPayload ? extractOpenRouterContent(parsedUpstreamPayload) : ''
      console.info('[openrouter-chat][forum] non-stream parse summary', {
        hasJsonPayload: Boolean(parsedUpstreamPayload),
        extractedContentLength: extractedContent.length,
      })
      if (!extractedContent) {
        console.error('[openrouter-chat][forum] missing generated text content in provider payload', {
          payloadPreview: payloadText.slice(0, 1000),
        })
        return new Response(
          JSON.stringify({
            error: '模型未返回可用内容',
            code: 'EMPTY_MODEL_CONTENT',
            providerPayload: parsedUpstreamPayload ?? payloadText,
          }),
          {
            status: 502,
            headers: {
              ...buildCorsHeaders(origin),
              ...buildRpCompressionDebugHeaders(),
              'Content-Type': 'application/json',
            },
          },
        )
      }
    }

    const isDev = Deno.env.get('ENV') === 'development' || Deno.env.get('DENO_ENV') === 'development'
    if (isDev && compressionCacheWriteFailed) {
      try {
        const upstreamPayload = (parsedUpstreamPayload ?? JSON.parse(payloadText)) as Record<string, unknown>
        upstreamPayload.debug = {
          ...(typeof upstreamPayload.debug === 'object' && upstreamPayload.debug !== null
            ? (upstreamPayload.debug as Record<string, unknown>)
            : {}),
          cache_write_failed: true,
          cache_write_error_message: compressionCacheWriteErrorMessage,
        }
        return new Response(JSON.stringify(upstreamPayload), {
          status: 200,
          headers: {
            ...buildCorsHeaders(origin),
            ...buildRpCompressionDebugHeaders(),
            'Content-Type': 'application/json',
          },
        })
      } catch (error) {
        console.error('failed to append debug payload for compression cache write failure', error)
      }
    }

    if (isForumModule) {
      console.info('[openrouter-chat][forum] forwarding upstream payload to client')
    }

    // Fire-and-forget RAG chunk write for daily chat non-streaming responses
    if (isDailyChat && userId && payload.conversationId && parsedUpstreamPayload) {
      const assistantContent = extractOpenRouterContent(parsedUpstreamPayload)
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content?.trim()
      if (assistantContent && lastUserMsg) {
        maybeWriteDailyChatRagChunk(lastUserMsg, assistantContent, userId, payload.conversationId, apiKey)
          .catch((err) => console.log('[rag-write] non-stream write error', err))
      }
    }

    return new Response(payloadText, {
      status: 200,
      headers: {
        ...buildCorsHeaders(origin),
        ...buildRpCompressionDebugHeaders(),
        'Content-Type': 'application/json',
      },
    })
  } catch (error) {
    if (isForumModule) {
      console.error('[openrouter-chat][forum] request failed', error)
    }
    return new Response(JSON.stringify({ error: '请求失败' }), {
      status: 500,
      headers: {
        ...buildCorsHeaders(origin),
        'Content-Type': 'application/json',
      },
    })
  }
})
