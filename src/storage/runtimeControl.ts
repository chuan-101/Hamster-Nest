import {
  createRuntimeControlClient,
  type RuntimeControlOptions,
  type RuntimeControlRequest,
} from '../lib/runtime-control-client'
import { normalizeRuntimeStatusSnapshot } from '../lib/runtime-status'
import { supabase, supabasePublicConfig } from '../supabase/client'

export const controlRuntime = async (
  request: RuntimeControlRequest,
  options?: RuntimeControlOptions,
) => {
  if (!supabase || !supabasePublicConfig) {
    throw new Error('Supabase 客户端未配置')
  }
  const client = supabase
  const controlAuthenticatedRuntime = createRuntimeControlClient({
    endpointUrl: `${supabasePublicConfig.url}/functions/v1/runtime-control`,
    publishableKey: supabasePublicConfig.publishableKey,
    getAccessToken: async () => {
      const { data, error } = await client.auth.getSession()
      if (error) {
        throw error
      }
      return data.session?.access_token ?? null
    },
  })
  return controlAuthenticatedRuntime(request, options)
}

export const loadRuntimeStatusSnapshot = async () => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession()
  if (sessionError) {
    throw sessionError
  }
  const userId = sessionData.session?.user.id
  if (!userId) {
    throw new Error('登录状态异常，请重新登录')
  }

  const { data, error } = await supabase
    .from('agent_settings')
    .select('last_seen_at,heartbeat_data')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    throw error
  }
  return normalizeRuntimeStatusSnapshot(data)
}

export type {
  RuntimeControlOptions,
  RuntimeControlRequest,
  RuntimeControlResponse,
  RuntimeControlTargetRole,
} from '../lib/runtime-control-client'
export type {
  RuntimeRoleStatus,
  RuntimeStatus,
  RuntimeStatusSnapshot,
} from '../lib/runtime-status'
