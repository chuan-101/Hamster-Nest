const ALLOWED_CONVERSATION_ORIGINS = [
  'https://chuan-101.github.io',
  /^http:\/\/localhost:\d+$/u,
  /^http:\/\/127\.0\.0\.1:\d+$/u,
]

export const isAllowedConversationOrigin = (origin: string | null) => {
  if (!origin) {
    return true
  }
  return ALLOWED_CONVERSATION_ORIGINS.some((candidate) =>
    typeof candidate === 'string' ? candidate === origin : candidate.test(origin)
  )
}

export const buildConversationCorsHeaders = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin ?? '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Expose-Headers':
    'x-conversation-user-message-id,x-conversation-reply-id,x-conversation-agent-task-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
})
