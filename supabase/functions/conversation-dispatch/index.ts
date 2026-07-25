import '@supabase/functions-js/edge-runtime.d.ts'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getOwnerUserId } from '../_shared/owner.ts'
import {
  buildConversationCorsHeaders,
  type ConversationDispatchPrepareResult,
  ConversationDispatchRequestError,
  isAllowedConversationOrigin,
  normalizeConversationDispatchRequest,
  OpenAiSseAccumulator,
} from './contract.ts'

declare const EdgeRuntime:
  | {
    waitUntil(promise: Promise<unknown>): void
  }
  | undefined

type SessionRow = {
  id: string
  override_model: string | null
  override_reasoning: boolean | null
}

type UserSettingsRow = {
  default_model: string
  system_prompt: string
  temperature: number
  top_p: number
  max_tokens: number
  chat_reasoning_enabled: boolean
}

type MessageRow = {
  id: string
  role: 'user' | 'assistant'
  content: string
  meta: Record<string, unknown> | null
  created_at: string
}

// This Edge bundle intentionally stays decoupled from the 100 KB generated
// browser type file; request/row contracts above provide the narrow boundary.
/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore no-explicit-any
type UserClient = SupabaseClient<any, 'public', 'public', any, any>
/* eslint-enable @typescript-eslint/no-explicit-any */

const HISTORY_LIMIT = 200
const STREAM_PERSIST_INTERVAL_MS = 450

const jsonResponse = (
  payload: Record<string, unknown>,
  status: number,
  corsHeaders: Record<string, string>,
  dispatch?: ConversationDispatchPrepareResult,
) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      ...(dispatch
        ? {
          'x-conversation-user-message-id': dispatch.user_message.id,
          'x-conversation-reply-id': dispatch.reply.id,
        }
        : {}),
      'Content-Type': 'application/json; charset=utf-8',
    },
  })

const isDispatchPrepareResult = (
  value: unknown,
): value is ConversationDispatchPrepareResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const result = value as Record<string, unknown>
  const userMessage = result.user_message as Record<string, unknown> | undefined
  const reply = result.reply as Record<string, unknown> | undefined
  return (
    result.schema_version === 1 &&
    (result.handler === 'api' || result.handler === 'cli') &&
    typeof result.responder_sender_key === 'string' &&
    Boolean(userMessage && typeof userMessage.id === 'string') &&
    Boolean(reply && typeof reply.id === 'string') &&
    typeof result.should_execute === 'boolean' &&
    typeof result.was_duplicate === 'boolean'
  )
}

const mapRpcErrorStatus = (code: string | undefined) => {
  switch (code) {
    case '42501':
      return 403
    case 'P0002':
      return 404
    case '23505':
      return 409
    case '0A000':
      return 501
    case '22023':
      return 400
    default:
      return 500
  }
}

const buildReplyMeta = (
  dispatch: ConversationDispatchPrepareResult,
  deliveryState: 'generating' | 'completed' | 'failed',
  options: {
    model?: string | null
    errorCode?: string
    errorMessage?: string
  } = {},
) => ({
  schema_version: 1,
  source: 'conversation_dispatch',
  delivery_state: deliveryState,
  delivery_attempt: dispatch.reply.delivery_attempt,
  responder_sender_key: dispatch.responder_sender_key,
  ...(options.model ? { model: options.model } : {}),
  ...(deliveryState === 'completed' ? { completed_at: new Date().toISOString() } : {}),
  ...(options.errorCode ? { delivery_error_code: options.errorCode } : {}),
  ...(options.errorMessage ? { delivery_error: options.errorMessage.slice(0, 180) } : {}),
})

const persistReply = async (
  client: UserClient,
  userId: string,
  dispatch: ConversationDispatchPrepareResult,
  content: string,
  state: 'generating' | 'completed' | 'failed',
  options?: {
    model?: string | null
    errorCode?: string
    errorMessage?: string
  },
) => {
  const { data, error } = await client
    .from('messages')
    .update({
      content,
      meta: buildReplyMeta(dispatch, state, options),
    })
    .eq('id', dispatch.reply.id)
    .eq('user_id', userId)
    .eq('role', 'assistant')
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`reply persistence failed: ${error?.code ?? 'not_found'}`)
  }
}

const loadConversationRequest = async (
  client: UserClient,
  dispatch: ConversationDispatchPrepareResult,
  sessionId: string,
  userId: string,
) => {
  const [sessionResult, settingsResult, messagesResult] = await Promise.all([
    client
      .from('sessions')
      .select('id,override_model,override_reasoning')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .maybeSingle<SessionRow>(),
    client
      .from('user_settings')
      .select(
        'default_model,system_prompt,temperature,top_p,max_tokens,chat_reasoning_enabled',
      )
      .eq('user_id', userId)
      .maybeSingle<UserSettingsRow>(),
    client
      .from('messages')
      .select('id,role,content,meta,created_at')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT)
      .returns<MessageRow[]>(),
  ])

  if (sessionResult.error || !sessionResult.data) {
    throw new Error(`session load failed: ${sessionResult.error?.code ?? 'not_found'}`)
  }
  if (settingsResult.error || !settingsResult.data) {
    throw new Error(`settings load failed: ${settingsResult.error?.code ?? 'not_found'}`)
  }
  if (messagesResult.error) {
    throw new Error(`message history load failed: ${messagesResult.error.code ?? 'unknown'}`)
  }

  const session = sessionResult.data
  const settings = settingsResult.data
  const canonicalMessages = [...(messagesResult.data ?? [])]
    .reverse()
    .filter((message) => {
      if (message.id === dispatch.reply.id) {
        return false
      }
      if (message.role !== 'assistant') {
        return true
      }
      const state = message.meta && typeof message.meta.delivery_state === 'string'
        ? message.meta.delivery_state
        : null
      return state !== 'generating' && state !== 'failed'
    })
    .map((message) => ({
      role: message.role,
      content: message.content,
    }))

  const systemPrompt = settings.system_prompt.trim()
  const messages = [
    ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
    ...canonicalMessages,
  ]

  return {
    messages,
    model: session.override_model?.trim() || settings.default_model,
    reasoning: session.override_reasoning ?? settings.chat_reasoning_enabled,
    temperature: settings.temperature,
    top_p: settings.top_p,
    max_tokens: settings.max_tokens,
  }
}

const proxyAndPersistStream = async (
  upstreamBody: ReadableStream<Uint8Array>,
  writable: WritableStream<Uint8Array>,
  client: UserClient,
  userId: string,
  dispatch: ConversationDispatchPrepareResult,
) => {
  const reader = upstreamBody.getReader()
  const writer = writable.getWriter()
  const decoder = new TextDecoder()
  const accumulator = new OpenAiSseAccumulator()
  let lastPersistedAt = 0
  let lastPersistedContent = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      await writer.write(value)
      accumulator.push(decoder.decode(value, { stream: true }))

      const now = Date.now()
      if (
        accumulator.content !== lastPersistedContent &&
        now - lastPersistedAt >= STREAM_PERSIST_INTERVAL_MS
      ) {
        await persistReply(
          client,
          userId,
          dispatch,
          accumulator.content,
          'generating',
          { model: accumulator.model },
        )
        lastPersistedContent = accumulator.content
        lastPersistedAt = now
      }
    }

    accumulator.push(decoder.decode())
    accumulator.finish()
    if (!accumulator.content.trim()) {
      throw new Error('EMPTY_MODEL_CONTENT')
    }

    await persistReply(
      client,
      userId,
      dispatch,
      accumulator.content,
      'completed',
      { model: accumulator.model },
    )
    await writer.close()
  } catch (error) {
    const errorCode = error instanceof Error && error.message === 'EMPTY_MODEL_CONTENT'
      ? 'EMPTY_MODEL_CONTENT'
      : 'STREAM_INTERRUPTED'
    const publicMessage = errorCode === 'EMPTY_MODEL_CONTENT'
      ? '模型未返回可用内容'
      : '回复流中断，请重试'

    try {
      await persistReply(
        client,
        userId,
        dispatch,
        accumulator.content,
        'failed',
        {
          model: accumulator.model,
          errorCode,
          errorMessage: publicMessage,
        },
      )
    } catch (persistError) {
      console.error('[conversation-dispatch] failed to persist stream failure', persistError)
    }

    try {
      const errorEvent = new TextEncoder().encode(
        `event: error\ndata: ${
          JSON.stringify({
            error: publicMessage,
            code: errorCode,
            reply_id: dispatch.reply.id,
          })
        }\n\n`,
      )
      await writer.write(errorEvent)
      await writer.close()
    } catch {
      // The client may already have disconnected; the canonical reply state is
      // still persisted above for a safe retry.
    }
  } finally {
    reader.releaseLock()
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
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    })
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
    console.error('[conversation-dispatch] owner configuration invalid', error)
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
    payload = normalizeConversationDispatchRequest(await request.json())
  } catch (error) {
    const message = error instanceof ConversationDispatchRequestError
      ? error.message
      : '请求体格式错误'
    return jsonResponse({ error: message }, 400, corsHeaders)
  }

  const client = createClient(supabaseUrl, apiKey, {
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

  const { data, error } = await client.rpc('conversation_dispatch_prepare', {
    p_session_id: payload.session_id,
    p_client_id: payload.client_id,
    p_content: payload.content,
    ...(payload.client_created_at ? { p_client_created_at: payload.client_created_at } : {}),
    ...(payload.target_sender_keys ? { p_target_sender_keys: payload.target_sender_keys } : {}),
    p_retry_failed: payload.retry_failed,
  })

  if (error) {
    const status = mapRpcErrorStatus(error.code)
    console.error('[conversation-dispatch] prepare RPC failed', {
      code: error.code,
      status,
    })
    return jsonResponse(
      {
        error: status >= 500 ? '会话入口暂时不可用' : error.message,
        code: error.code ?? 'DISPATCH_PREPARE_FAILED',
      },
      status,
      corsHeaders,
    )
  }

  if (!isDispatchPrepareResult(data)) {
    console.error('[conversation-dispatch] prepare RPC returned an invalid contract')
    return jsonResponse(
      { error: '会话入口返回了无效契约', code: 'INVALID_PREPARE_CONTRACT' },
      500,
      corsHeaders,
    )
  }

  const dispatch = data
  const basePayload = {
    schema_version: dispatch.schema_version,
    handler: dispatch.handler,
    user_message: dispatch.user_message,
    reply: dispatch.reply,
    command: dispatch.command,
    should_execute: dispatch.should_execute,
    was_duplicate: dispatch.was_duplicate,
  }

  if (dispatch.handler === 'cli') {
    return jsonResponse(basePayload, 202, corsHeaders, dispatch)
  }

  if (!dispatch.should_execute) {
    const status = dispatch.reply.delivery_state === 'completed'
      ? 200
      : dispatch.reply.delivery_state === 'generating'
      ? 202
      : 409
    return jsonResponse(basePayload, status, corsHeaders, dispatch)
  }

  let modelRequest
  try {
    modelRequest = await loadConversationRequest(
      client,
      dispatch,
      payload.session_id,
      userId,
    )
  } catch (loadError) {
    console.error('[conversation-dispatch] canonical context load failed', loadError)
    try {
      await persistReply(client, userId, dispatch, '', 'failed', {
        errorCode: 'CONTEXT_LOAD_FAILED',
        errorMessage: '会话上下文读取失败',
      })
    } catch (persistError) {
      console.error('[conversation-dispatch] failed to persist context error', persistError)
    }
    return jsonResponse(
      {
        ...basePayload,
        error: '会话上下文读取失败',
        code: 'CONTEXT_LOAD_FAILED',
      },
      500,
      corsHeaders,
      dispatch,
    )
  }

  let upstream: Response
  try {
    upstream = await fetch(new URL('/functions/v1/openrouter-chat', supabaseUrl), {
      method: 'POST',
      headers: {
        apikey: apiKey,
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...modelRequest,
        modelId: modelRequest.model,
        conversationId: payload.session_id,
        module: 'chitchat',
        stream: true,
      }),
    })
  } catch (upstreamError) {
    console.error('[conversation-dispatch] model function network failure', upstreamError)
    try {
      await persistReply(client, userId, dispatch, '', 'failed', {
        model: modelRequest.model,
        errorCode: 'UPSTREAM_NETWORK_ERROR',
        errorMessage: '模型服务暂时无法连接',
      })
    } catch (persistError) {
      console.error('[conversation-dispatch] failed to persist network error', persistError)
    }
    return jsonResponse(
      {
        ...basePayload,
        error: '模型服务暂时无法连接',
        code: 'UPSTREAM_NETWORK_ERROR',
      },
      502,
      corsHeaders,
      dispatch,
    )
  }

  if (!upstream.ok || !upstream.body) {
    console.error('[conversation-dispatch] model function failed', {
      status: upstream.status,
      hasBody: Boolean(upstream.body),
    })
    try {
      await persistReply(client, userId, dispatch, '', 'failed', {
        model: modelRequest.model,
        errorCode: 'UPSTREAM_HTTP_ERROR',
        errorMessage: '模型服务请求失败',
      })
    } catch (persistError) {
      console.error('[conversation-dispatch] failed to persist upstream error', persistError)
    }
    return jsonResponse(
      {
        ...basePayload,
        error: '模型服务请求失败',
        code: 'UPSTREAM_HTTP_ERROR',
      },
      upstream.ok ? 502 : upstream.status,
      corsHeaders,
      dispatch,
    )
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const streamWork = proxyAndPersistStream(
    upstream.body,
    writable,
    client,
    userId,
    dispatch,
  )

  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(streamWork)
  } else {
    void streamWork
  }

  return new Response(readable, {
    status: 200,
    headers: {
      ...corsHeaders,
      'x-conversation-user-message-id': dispatch.user_message.id,
      'x-conversation-reply-id': dispatch.reply.id,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
})
