export type ConversationDispatchRequest = {
  sessionId: string
  clientId: string
  content: string
  clientCreatedAt?: string
  targetSenderKeys?: string[]
  retryFailed?: boolean
}

export type ConversationDispatchResponse = {
  status: number
  userMessageId: string | null
  replyId: string | null
  contentType: string
  bodyText: string
}

export type ConversationDispatchOptions = {
  timeoutMs?: number
  signal?: AbortSignal
}

export type ConversationDispatchClientConfig = {
  endpointUrl: string
  publishableKey: string
  getAccessToken: () => Promise<string | null>
  fetchImpl?: typeof fetch
}

export class ConversationDispatchError extends Error {
  readonly status: number | null
  readonly code: string | null
  readonly userMessageId: string | null
  readonly replyId: string | null

  constructor(
    message: string,
    options: {
      status?: number | null
      code?: string | null
      userMessageId?: string | null
      replyId?: string | null
    } = {},
  ) {
    super(message)
    this.name = 'ConversationDispatchError'
    this.status = options.status ?? null
    this.code = options.code ?? null
    this.userMessageId = options.userMessageId ?? null
    this.replyId = options.replyId ?? null
  }
}

export class ConversationDispatchTimeoutError extends ConversationDispatchError {
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super('会话请求超时；可使用原 clientId 对账或重试', {
      code: 'CLIENT_TIMEOUT',
    })
    this.name = 'ConversationDispatchTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

const parseErrorPayload = (bodyText: string) => {
  if (!bodyText) {
    return { message: '', code: null }
  }
  try {
    const payload = JSON.parse(bodyText) as {
      error?: unknown
      code?: unknown
    }
    return {
      message: typeof payload.error === 'string' ? payload.error : '',
      code: typeof payload.code === 'string' ? payload.code : null,
    }
  } catch {
    return { message: '', code: null }
  }
}

const serializeRequest = (request: ConversationDispatchRequest) => ({
  session_id: request.sessionId,
  client_id: request.clientId,
  content: request.content,
  ...(request.clientCreatedAt
    ? { client_created_at: request.clientCreatedAt }
    : {}),
  ...(request.targetSenderKeys
    ? { target_sender_keys: request.targetSenderKeys }
    : {}),
  retry_failed: request.retryFailed === true,
})

export const createConversationDispatchClient = (
  config: ConversationDispatchClientConfig,
) => {
  const fetchImpl = config.fetchImpl ?? fetch

  return async (
    request: ConversationDispatchRequest,
    options: ConversationDispatchOptions = {},
  ): Promise<ConversationDispatchResponse> => {
    const timeoutMs = options.timeoutMs ?? 90_000
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new ConversationDispatchError('timeoutMs 必须是正数', {
        code: 'INVALID_TIMEOUT',
      })
    }

    const accessToken = await config.getAccessToken()
    if (!accessToken) {
      throw new ConversationDispatchError('登录状态异常，请重新登录', {
        status: 401,
        code: 'MISSING_SESSION',
      })
    }

    const controller = new AbortController()
    let didTimeout = false
    const relayAbort = () => controller.abort()
    options.signal?.addEventListener('abort', relayAbort, { once: true })
    if (options.signal?.aborted) {
      controller.abort()
    }
    const timeout = setTimeout(() => {
      didTimeout = true
      controller.abort()
    }, timeoutMs)

    try {
      const response = await fetchImpl(config.endpointUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: config.publishableKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(serializeRequest(request)),
        signal: controller.signal,
      })
      const bodyText = await response.text()
      const userMessageId = response.headers.get(
        'x-conversation-user-message-id',
      )
      const replyId = response.headers.get('x-conversation-reply-id')
      const contentType = response.headers.get('content-type') ?? ''

      if (!response.ok) {
        const errorPayload = parseErrorPayload(bodyText)
        throw new ConversationDispatchError(
          errorPayload.message || `会话请求失败（HTTP ${response.status}）`,
          {
            status: response.status,
            code: errorPayload.code,
            userMessageId,
            replyId,
          },
        )
      }

      return {
        status: response.status,
        userMessageId,
        replyId,
        contentType,
        bodyText,
      }
    } catch (error) {
      if (didTimeout) {
        throw new ConversationDispatchTimeoutError(timeoutMs)
      }
      if (error instanceof ConversationDispatchError) {
        throw error
      }
      if (controller.signal.aborted) {
        throw new ConversationDispatchError('会话请求已取消', {
          code: 'CLIENT_ABORTED',
        })
      }
      throw new ConversationDispatchError('会话入口暂时无法连接', {
        code: 'NETWORK_ERROR',
      })
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', relayAbort)
    }
  }
}
