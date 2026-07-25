export type ConversationCanaryRequest = {
  sessionId: string
  clientId: string
  content: string
  clientCreatedAt?: string
  retryFailed?: boolean
}

export type ConversationCanaryResponse = {
  status: number
  userMessageId: string | null
  replyId: string | null
}

export type ConversationCanaryAttempt = ConversationCanaryResponse

type DispatchConversation = (
  request: ConversationCanaryRequest,
  options?: { timeoutMs?: number },
) => Promise<ConversationCanaryResponse>

type RunConversationCanaryOptions = {
  dispatch: DispatchConversation
  request: ConversationCanaryRequest
  sleep: (milliseconds: number) => Promise<unknown>
  initialTimeoutMs?: number
  retryDelayMs?: number
  roundDelayMs?: number
  maxRounds?: number
}

export type ConversationCanaryResult = {
  timeoutObserved: true
  rounds: number
  attempts: ConversationCanaryAttempt[]
}

const isClientTimeout = (error: unknown) =>
  error instanceof Error &&
  'code' in error &&
  error.code === 'CLIENT_TIMEOUT'

const summarize = (
  response: ConversationCanaryResponse,
): ConversationCanaryAttempt => ({
  status: response.status,
  userMessageId: response.userMessageId,
  replyId: response.replyId,
})

export const runConversationCanary = async ({
  dispatch,
  request,
  sleep,
  initialTimeoutMs = 200,
  retryDelayMs = 4_000,
  roundDelayMs = 1_500,
  maxRounds = 20,
}: RunConversationCanaryOptions): Promise<ConversationCanaryResult> => {
  let timeoutObserved = false
  try {
    await dispatch(request, { timeoutMs: initialTimeoutMs })
  } catch (error) {
    if (!isClientTimeout(error)) {
      throw error
    }
    timeoutObserved = true
  }

  if (!timeoutObserved) {
    throw new Error('未观察到真实客户端 timeout，请调整 canary 后重试')
  }

  await sleep(retryDelayMs)
  const retryRequest = { ...request, retryFailed: true }
  let canonicalPair: string | null = null
  let lastStatuses = '无响应'

  for (let round = 1; round <= maxRounds; round += 1) {
    const settled = await Promise.allSettled([
      dispatch(retryRequest),
      dispatch(retryRequest),
    ])
    const attempts = settled.flatMap((attempt) =>
      attempt.status === 'fulfilled' ? [summarize(attempt.value)] : [],
    )

    for (const attempt of attempts) {
      if (!attempt.userMessageId || !attempt.replyId) {
        throw new Error('补账响应缺少 canonical message IDs')
      }
      const pair = `${attempt.userMessageId}/${attempt.replyId}`
      if (canonicalPair && pair !== canonicalPair) {
        throw new Error('同一 client_id 返回了不同的 canonical message IDs')
      }
      canonicalPair = pair
    }

    lastStatuses =
      attempts.length > 0
        ? attempts.map((attempt) => String(attempt.status)).join(' / ')
        : '全部失败'

    if (
      attempts.length === 2 &&
      attempts.some((attempt) => attempt.status === 200)
    ) {
      return {
        timeoutObserved: true,
        rounds: round,
        attempts,
      }
    }

    if (round < maxRounds) {
      await sleep(roundDelayMs)
    }
  }

  throw new Error(
    `补账未等到 completed 响应（最后状态：${lastStatuses}），请查数据库后再重试`,
  )
}
