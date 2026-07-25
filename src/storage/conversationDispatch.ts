import {
  createConversationDispatchClient,
  type ConversationDispatchOptions,
  type ConversationDispatchRequest,
} from '../lib/conversation-dispatch-client'
import { supabase, supabasePublicConfig } from '../supabase/client'

export const dispatchConversation = async (
  request: ConversationDispatchRequest,
  options?: ConversationDispatchOptions,
) => {
  if (!supabase || !supabasePublicConfig) {
    throw new Error('Supabase 客户端未配置')
  }
  const client = supabase

  const dispatchAuthenticatedConversation = createConversationDispatchClient({
    endpointUrl: `${supabasePublicConfig.url}/functions/v1/conversation-dispatch`,
    publishableKey: supabasePublicConfig.publishableKey,
    getAccessToken: async () => {
      const { data, error } = await client.auth.getSession()
      if (error) {
        throw error
      }
      return data.session?.access_token ?? null
    },
  })

  return dispatchAuthenticatedConversation(request, options)
}

export type {
  ConversationDispatchOptions,
  ConversationDispatchRequest,
  ConversationDispatchResponse,
} from '../lib/conversation-dispatch-client'
