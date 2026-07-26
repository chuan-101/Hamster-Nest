import '@supabase/functions-js/edge-runtime.d.ts'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getOwnerUserId } from '../_shared/owner.ts'
import {
  buildRuntimeControlCorsHeaders,
  isAllowedRuntimeControlOrigin,
  isRuntimeControlPrepareResult,
  normalizeRuntimeControlRequest,
  RuntimeControlRequestError,
} from './contract.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore no-explicit-any
type UserClient = SupabaseClient<any, 'public', 'public', any, any>
/* eslint-enable @typescript-eslint/no-explicit-any */

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
      return 409
    case 'P0002':
      return 404
    default:
      return 500
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin')
  const originAllowed = isAllowedRuntimeControlOrigin(origin)
  const corsHeaders = originAllowed ? buildRuntimeControlCorsHeaders(origin) : {}

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
    console.error('[runtime-control] owner configuration invalid', error)
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
    payload = normalizeRuntimeControlRequest(await request.json())
  } catch (error) {
    const message = error instanceof RuntimeControlRequestError ? error.message : '请求体格式错误'
    return jsonResponse({ error: message }, 400, corsHeaders)
  }

  const client: UserClient = createClient(supabaseUrl, apiKey, {
    global: {
      headers: {
        Authorization: authorization,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const { data, error } = await client.rpc('runtime_control_prepare', {
    p_action: payload.action,
    p_target_role: payload.target_role,
    p_client_id: payload.client_id,
    p_confirm_running_tasks: payload.confirm_running_tasks,
  })

  if (error) {
    const status = mapRpcErrorStatus(error.code)
    console.error('[runtime-control] prepare RPC failed', {
      code: error.code,
      status,
    })
    return jsonResponse(
      {
        error: status >= 500 ? 'Runtime 控制入口暂时不可用' : error.message,
        code: error.code ?? 'RUNTIME_CONTROL_PREPARE_FAILED',
      },
      status,
      corsHeaders,
    )
  }

  if (!isRuntimeControlPrepareResult(data)) {
    console.error('[runtime-control] prepare RPC returned an invalid contract')
    return jsonResponse(
      {
        error: 'Runtime 控制入口返回了无效契约',
        code: 'INVALID_RUNTIME_CONTROL_CONTRACT',
      },
      500,
      corsHeaders,
    )
  }

  const status = data.command.status === 'done' ? 200 : data.command.status === 'failed' ? 409 : 202
  return jsonResponse(data, status, corsHeaders)
})
