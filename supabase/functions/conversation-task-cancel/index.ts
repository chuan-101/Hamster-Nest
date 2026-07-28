import '@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from '@supabase/supabase-js'
import {
  buildConversationCorsHeaders,
  isAllowedConversationOrigin,
} from '../_shared/conversation_http.ts'
import { getOwnerUserId } from '../_shared/owner.ts'
import { getSupabaseAdminKey } from '../_shared/supabase_secret.ts'
import {
  isConversationTaskCancelResult,
  normalizeConversationTaskCancelRequest,
  ConversationTaskCancelRequestError,
} from './contract.ts'

const jsonResponse = (
  payload: Record<string, unknown>,
  status: number,
  corsHeaders: Record<string, string>,
) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
  })

const mapRpcErrorStatus = (code: string | undefined) => {
  switch (code) {
    case '42501':
      return 403
    case '22023':
      return 400
    case '23505':
    case '40001':
    case '55000':
      return 409
    case 'P0002':
      return 404
    default:
      return 500
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin')
  const originAllowed = isAllowedConversationOrigin(origin)
  const corsHeaders = originAllowed ? buildConversationCorsHeaders(origin) : {}

  if (!originAllowed) {
    return jsonResponse({ error: '来源不允许' }, 403, corsHeaders)
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: '只支持 POST' }, 405, corsHeaders)
  }

  const authorization = request.headers.get('authorization')
  const apiKey = request.headers.get('apikey')
  if (!authorization || !apiKey) {
    return jsonResponse({ error: '缺少身份令牌' }, 401, corsHeaders)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  if (!supabaseUrl) {
    return jsonResponse({ error: '服务未配置' }, 500, corsHeaders)
  }

  let userId = ''
  try {
    const authResponse = await fetch(new URL('/auth/v1/user', supabaseUrl), {
      headers: {
        apikey: apiKey,
        Authorization: authorization,
      },
    })
    if (!authResponse.ok) {
      return jsonResponse({ error: '身份令牌无效' }, 401, corsHeaders)
    }
    const authData = (await authResponse.json()) as { id?: unknown }
    userId = typeof authData.id === 'string' ? authData.id : ''
  } catch {
    return jsonResponse({ error: '身份令牌无效' }, 401, corsHeaders)
  }

  let ownerId = ''
  try {
    ownerId = getOwnerUserId()
  } catch (error) {
    console.error('[conversation-task-cancel] owner configuration invalid', error)
    return jsonResponse({ error: '服务未配置' }, 500, corsHeaders)
  }
  if (!userId) {
    return jsonResponse({ error: '身份令牌无效' }, 401, corsHeaders)
  }
  if (userId !== ownerId) {
    return jsonResponse({ error: '无权访问' }, 403, corsHeaders)
  }

  let payload
  try {
    payload = normalizeConversationTaskCancelRequest(await request.json())
  } catch (error) {
    const message = error instanceof ConversationTaskCancelRequestError
      ? error.message
      : '请求体格式错误'
    return jsonResponse({ error: message }, 400, corsHeaders)
  }

  let serviceClient
  try {
    serviceClient = createClient(supabaseUrl, getSupabaseAdminKey(), {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  } catch (error) {
    console.error('[conversation-task-cancel] privileged RPC client unavailable', error)
    return jsonResponse({ error: '服务未配置' }, 500, corsHeaders)
  }

  const { data, error } = await serviceClient.rpc('conversation_dispatch_cancel_pending', {
    p_user_id: userId,
    p_task_id: payload.task_id,
  })

  if (error) {
    const status = mapRpcErrorStatus(error.code)
    console.error('[conversation-task-cancel] cancel RPC failed', {
      code: error.code,
      status,
    })
    return jsonResponse(
      {
        error: status >= 500 ? '任务取消入口暂时不可用' : error.message,
        code: error.code ?? 'CONVERSATION_TASK_CANCEL_FAILED',
      },
      status,
      corsHeaders,
    )
  }

  if (!isConversationTaskCancelResult(data)) {
    console.error('[conversation-task-cancel] cancel RPC returned an invalid contract')
    return jsonResponse(
      { error: '任务取消入口返回了无效契约', code: 'INVALID_CANCEL_CONTRACT' },
      500,
      corsHeaders,
    )
  }

  return jsonResponse(data, data.cancelled ? 200 : 409, corsHeaders)
})
