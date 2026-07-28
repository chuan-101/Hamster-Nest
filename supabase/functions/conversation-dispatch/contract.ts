export {
  buildConversationCorsHeaders,
  isAllowedConversationOrigin,
} from '../_shared/conversation_http.ts'

export const MAX_CONVERSATION_CONTENT_LENGTH = 20_000

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export type ConversationDispatchRequest = {
  session_id: string
  client_id: string
  content: string
  client_created_at?: string
  target_sender_keys?: string[]
  retry_failed: boolean
}

export type ConversationDispatchPrepareResult = {
  schema_version: 1
  handler: 'api' | 'cli'
  responder_sender_key: string
  target_sender_keys: string[]
  user_message: {
    id: string
    created_at: string
  }
  reply: {
    id: string
    delivery_state: 'generating' | 'completed' | 'failed'
    delivery_attempt: number
  }
  command: null | {
    id: string
    status: 'pending' | 'running' | 'done' | 'failed'
    idempotency_key: string
  }
  task: null | {
    id: string
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    correlation_id: string
  }
  should_execute: boolean
  was_duplicate: boolean
}

export class ConversationDispatchRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConversationDispatchRequestError'
  }
}

const requireUuid = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new ConversationDispatchRequestError(`${field} 必须是 UUID`)
  }
  return value.toLowerCase()
}

const normalizeClientCreatedAt = (value: unknown) => {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw new ConversationDispatchRequestError('client_created_at 必须是 ISO 时间')
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new ConversationDispatchRequestError('client_created_at 必须是 ISO 时间')
  }
  return parsed.toISOString()
}

const normalizeTargets = (value: unknown) => {
  if (value === undefined || value === null) {
    return undefined
  }
  if (!Array.isArray(value) || value.length !== 1) {
    throw new ConversationDispatchRequestError('direct 会话必须指定零个或一个 responder')
  }
  const senderKey = value[0]
  if (typeof senderKey !== 'string' || senderKey.trim() === '') {
    throw new ConversationDispatchRequestError('target_sender_keys 必须包含非空 sender key')
  }
  return [senderKey.trim()]
}

export const normalizeConversationDispatchRequest = (
  value: unknown,
): ConversationDispatchRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConversationDispatchRequestError('请求体必须是 JSON object')
  }

  const input = value as Record<string, unknown>
  if (typeof input.content !== 'string' || input.content.trim() === '') {
    throw new ConversationDispatchRequestError('content 不能为空')
  }
  if (input.content.length > MAX_CONVERSATION_CONTENT_LENGTH) {
    throw new ConversationDispatchRequestError(
      `content 最长 ${MAX_CONVERSATION_CONTENT_LENGTH} 个字符`,
    )
  }

  const clientCreatedAt = normalizeClientCreatedAt(input.client_created_at)
  const targetSenderKeys = normalizeTargets(input.target_sender_keys)

  return {
    session_id: requireUuid(input.session_id, 'session_id'),
    client_id: requireUuid(input.client_id, 'client_id'),
    content: input.content,
    ...(clientCreatedAt ? { client_created_at: clientCreatedAt } : {}),
    ...(targetSenderKeys ? { target_sender_keys: targetSenderKeys } : {}),
    retry_failed: input.retry_failed === true,
  }
}

type StreamDelta = {
  choices?: Array<{
    delta?: { content?: unknown }
    message?: { content?: unknown }
  }>
  model?: unknown
}

const extractContentValue = (value: unknown): string => {
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
      if (part && typeof part === 'object' && 'text' in part) {
        return typeof part.text === 'string' ? part.text : ''
      }
      return ''
    })
    .join('')
}

export class OpenAiSseAccumulator {
  #buffer = ''
  content = ''
  model: string | null = null
  done = false

  push(text: string) {
    this.#buffer += text
    const lines = this.#buffer.split('\n')
    this.#buffer = lines.pop() ?? ''
    for (const line of lines) {
      this.#consumeLine(line)
    }
  }

  finish() {
    if (this.#buffer) {
      this.#consumeLine(this.#buffer)
      this.#buffer = ''
    }
  }

  #consumeLine(rawLine: string) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (!line.startsWith('data:')) {
      return
    }
    const data = line.slice(5).trimStart()
    if (!data) {
      return
    }
    if (data === '[DONE]') {
      this.done = true
      return
    }

    let payload: StreamDelta
    try {
      payload = JSON.parse(data) as StreamDelta
    } catch {
      return
    }

    if (typeof payload.model === 'string' && payload.model.trim()) {
      this.model = payload.model.trim()
    }

    const choice = payload.choices?.[0]
    this.content += extractContentValue(choice?.delta?.content) ||
      extractContentValue(choice?.message?.content)
  }
}
