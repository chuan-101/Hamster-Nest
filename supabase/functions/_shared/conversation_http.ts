import { isAllowedBrowserOrigin } from './cors.ts'

export const isAllowedConversationOrigin = (origin: string | null) => {
  if (!origin) {
    return true
  }
  return isAllowedBrowserOrigin(origin)
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
