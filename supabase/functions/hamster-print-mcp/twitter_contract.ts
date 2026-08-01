export const TWITTER_COMMAND_TYPE = 'browser_opencli'
export const TWITTER_SCHEMA_VERSION = 1
export const MAX_TWEET_TEXT_LENGTH = 280

export type PostTweetInput = {
  text: string
  request_id?: string
  allow_duplicate?: boolean
}

export type NormalizedTweetRequest = {
  idempotencyKey: string
  payload: {
    platform: 'twitter'
    action: 'post'
    text: string
  }
}

const normalizeSingleLine = (value: string | undefined) =>
  (value ?? '').replace(/\s+/gu, ' ').trim()

const normalizeMultiline = (value: string | undefined) =>
  (value ?? '').replace(/\r\n?/gu, '\n').trim()

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return bytesToHex(new Uint8Array(digest))
}

const shanghaiDateString = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

export const countTweetCharacters = (value: string) => Array.from(value).length

export const normalizeTweetRequestId = (value: string | undefined) => {
  const normalized = normalizeSingleLine(value)
  if (!normalized) return ''
  if (!/^[a-z0-9][a-z0-9._:-]{0,119}$/iu.test(normalized)) {
    throw new Error('request_id 只能包含字母、数字、点、下划线、冒号和短横线，最长 120 字符')
  }
  return normalized
}

export const tweetRequestIdempotencyKey = (requestId: string) => {
  const normalized = normalizeTweetRequestId(requestId)
  if (!normalized) throw new Error('request_id 不能为空')
  return `twitter:v${TWITTER_SCHEMA_VERSION}:request:${normalized}`
}

export const isTwitterPostJob = (job: unknown) => {
  if (!job || typeof job !== 'object') return false
  const payload = (job as Record<string, unknown>).payload
  if (!payload || typeof payload !== 'object') return false
  const record = payload as Record<string, unknown>
  return record.platform === 'twitter' && record.action === 'post'
}

export const normalizeTweetRequest = async (
  input: PostTweetInput,
  now = new Date(),
): Promise<NormalizedTweetRequest> => {
  const text = normalizeMultiline(input.text)
  const requestId = normalizeTweetRequestId(input.request_id)

  if (!text) throw new Error('text 不能为空')
  if (countTweetCharacters(text) > MAX_TWEET_TEXT_LENGTH) {
    throw new Error(`text 最长 ${MAX_TWEET_TEXT_LENGTH} 个 Unicode 字符`)
  }

  const payload = {
    platform: 'twitter' as const,
    action: 'post' as const,
    text,
  }

  if (input.allow_duplicate === true) {
    return {
      payload,
      idempotencyKey: `twitter:v${TWITTER_SCHEMA_VERSION}:duplicate:${crypto.randomUUID()}`,
    }
  }

  if (requestId) {
    return {
      payload,
      idempotencyKey: tweetRequestIdempotencyKey(requestId),
    }
  }

  const day = shanghaiDateString(now)
  const fingerprint = await sha256(JSON.stringify({ day, text }))
  return {
    payload,
    idempotencyKey: `twitter:v${TWITTER_SCHEMA_VERSION}:auto:${day}:${fingerprint.slice(0, 32)}`,
  }
}
