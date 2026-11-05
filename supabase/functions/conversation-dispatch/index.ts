/// <reference types="npm:@supabase/functions-js@2.110.8/src/edge-runtime.d.ts" />
import { handleLoungeRequest, handleLoungeWorker } from './lounge.ts'
import { verifyConversationUser } from './auth.ts'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getOwnerUserId } from '../_shared/owner.ts'
import { getSupabaseAdminKey } from '../_shared/supabase_secret.ts'
import {
  buildConversationCorsHeaders,
  type ConversationDispatchPrepareResult,
  ConversationDispatchRequestError,
  isAllowedConversationOrigin,
  normalizeConversationDispatchRequest,
  resolveConversationDispatchHttpStatus,
} from './contract.ts'
import {
  composeConversationSystemPrompt,
  type ConversationPromptNames,
  type ConversationPromptRow,
  resolveConversationProfileKey,
} from './prompt.ts'
import {
  type ContextMessageRow,
  parseConversationContextRecipe,
  resolveHistoryTokenBudget,
  selectNewestContextWindow,
  startOfShanghaiDayIso,
} from './context.ts'
import {
  buildConversationModelMessages,
} from './model-context.ts'
import { startApiConversation, type ApiRunMeta } from './api-conversation-runner.ts'
import { handleApiToolSettings } from './api-tool-settings.ts'

declare const EdgeRuntime:
  | {
    waitUntil(promise: Promise<unknown>): void
  }
  | undefined

type SessionRow = {
  id: string
  session_key: string | null
  conversation_profile_key: string | null
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
  compression_trigger_ratio: number | null
}

type MessageRow = ContextMessageRow

type ConversationProfileRow = {
  default_responder_port_key: string
  rules_prompt_name: string | null
  context_recipe: unknown
}

type GenerationPortRow = {
  identity_prompt_name: string
  style_prompt_name: string | null
  model_channel_name: string | null
}

type ChannelConfigRow = {
  active_model: string
}

// This Edge bundle intentionally stays decoupled from the 100 KB generated
// browser type file; request/row contracts above provide the narrow boundary.
/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore no-explicit-any
type UserClient = SupabaseClient<any, 'public', 'public', any, any>
/* eslint-enable @typescript-eslint/no-explicit-any */

const HISTORY_PAGE_SIZE = 100

const loadActiveConversationProfile = async (
  client: UserClient,
  userId: string,
  session: SessionRow,
) => {
  const profileKey = resolveConversationProfileKey({
    conversationProfileKey: session.conversation_profile_key,
    sessionKey: session.session_key,
  })
  const profileResult = await client
    .from('conversation_profiles')
    .select('default_responder_port_key,rules_prompt_name,context_recipe')
    .eq('user_id', userId)
    .eq('profile_key', profileKey)
    .eq('active', true)
    .maybeSingle<ConversationProfileRow>()

  if (profileResult.error || !profileResult.data) {
    throw new Error(
      `active conversation profile load failed: ${profileResult.error?.code ?? 'not_found'}`,
    )
  }

  return { profileKey, profile: profileResult.data }
}

const loadActiveConversationGeneration = async (
  client: UserClient,
  userId: string,
  profileKey: string,
  profile: ConversationProfileRow,
  legacySystemPrompt: string,
) => {
  const portResult = await client
    .from('generation_ports')
    .select('identity_prompt_name,style_prompt_name,model_channel_name')
    .eq('user_id', userId)
    .eq('port_key', profile.default_responder_port_key)
    .eq('active', true)
    .maybeSingle<GenerationPortRow>()

  if (portResult.error || !portResult.data) {
    if (profileKey === 'app_companion') {
      throw new Error('active app companion generation port was not found')
    }
    return { systemPrompt: legacySystemPrompt.trim(), activeModel: null }
  }

  const promptNames: ConversationPromptNames = {
    identityPromptName: portResult.data.identity_prompt_name,
    stylePromptName: portResult.data.style_prompt_name,
    rulesPromptName: profile.rules_prompt_name,
  }
  const requiredPromptNames = [
    promptNames.identityPromptName,
    promptNames.stylePromptName,
    promptNames.rulesPromptName,
  ].filter((name): name is string => Boolean(name))
  const [promptsResult, channelResult] = await Promise.all([
    client
      .from('prompt_templates')
      .select('name,content,version')
      .eq('user_id', userId)
      .eq('active', true)
      .in('name', requiredPromptNames)
      .returns<ConversationPromptRow[]>(),
    portResult.data.model_channel_name
      ? client
        .from('channel_config')
        .select('active_model')
        .eq('user_id', userId)
        .eq('channel_name', portResult.data.model_channel_name)
        .maybeSingle<ChannelConfigRow>()
      : Promise.resolve({ data: null, error: null }),
  ])

  const activeModel = channelResult.data?.active_model?.trim() || null
  if (profileKey === 'app_companion' && (channelResult.error || !activeModel)) {
    throw new Error('active app companion model channel was not found')
  }

  return {
    systemPrompt: promptsResult.error
      ? legacySystemPrompt.trim()
      : composeConversationSystemPrompt({
        names: promptNames,
        activePrompts: promptsResult.data ?? [],
        legacySystemPrompt,
      }),
    activeModel,
  }
}

const loadConversationHistory = async ({
  client,
  userId,
  sessionId,
  epochStart,
  tokenBudget,
  requiredMessageId,
  excludedMessageId,
}: {
  client: UserClient
  userId: string
  sessionId: string
  epochStart: string | null
  tokenBudget: number
  requiredMessageId: string
  excludedMessageId: string
}) => {
  const candidates: MessageRow[] = []
  let cursor: { createdAt: string; id: string } | null = null

  while (true) {
    let query = client
      .from('messages')
      .select('id,role,content,meta,created_at')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(HISTORY_PAGE_SIZE)

    if (epochStart) {
      query = query.gte('created_at', epochStart)
    }
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
      )
    }

    const result = await query.returns<MessageRow[]>()
    if (result.error) {
      throw new Error(`message history load failed: ${result.error.code ?? 'unknown'}`)
    }

    const page = result.data ?? []
    candidates.push(...page)
    const selection = selectNewestContextWindow({
      newestFirst: candidates,
      tokenBudget,
      requiredMessageId,
      excludedMessageIds: [excludedMessageId],
    })
    if (selection.reachedBudget || page.length < HISTORY_PAGE_SIZE) {
      if (!selection.containsRequiredMessage) {
        throw new Error('canonical user message was not found inside its context boundary')
      }
      return [...selection.newestFirst].reverse()
    }

    const last = page.at(-1)
    if (!last) {
      throw new Error('message history pagination stopped before the canonical user message')
    }
    cursor = { createdAt: last.created_at, id: last.id }
  }
}

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
          ...(dispatch.task
            ? { 'x-conversation-agent-task-id': dispatch.task.id }
            : {}),
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
  const command = result.command as Record<string, unknown> | null | undefined
  const task = result.task as Record<string, unknown> | null | undefined
  const userMessageId = typeof userMessage?.id === 'string' ? userMessage.id : ''
  const validReply = Boolean(
    reply &&
      typeof reply.id === 'string' &&
      ['generating', 'completed', 'failed'].includes(String(reply.delivery_state)) &&
      Number.isInteger(reply.delivery_attempt) &&
      Number(reply.delivery_attempt) >= 1,
  )
  const validCliEnvelope = Boolean(
    command &&
      typeof command.id === 'string' &&
      ['pending', 'running', 'done', 'failed'].includes(String(command.status)) &&
      typeof command.idempotency_key === 'string' &&
      task &&
      typeof task.id === 'string' &&
      ['pending', 'running', 'completed', 'failed', 'cancelled'].includes(
        String(task.status),
      ) &&
      task.correlation_id === userMessageId,
  )
  return (
    result.schema_version === 1 &&
    (result.handler === 'api' || result.handler === 'cli') &&
    typeof result.responder_sender_key === 'string' &&
    Boolean(userMessageId) &&
    validReply &&
    (result.handler === 'api'
      ? command === null && task === null
      : validCliEnvelope) &&
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
    api?: ApiRunMeta
  } = {},
) => ({
  schema_version: 1,
  source: 'conversation_dispatch',
  delivery_state: deliveryState,
  delivery_attempt: dispatch.reply.delivery_attempt,
  responder_sender_key: dispatch.responder_sender_key,
  ...(options.model ? { model: options.model } : {}),
  ...(options.api ? { api_tools: options.api.api_tools, api_usage: options.api.api_usage, api_updated_at: new Date().toISOString() } : {}),
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
    api?: ApiRunMeta
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

const publishApiReplyCompletedEvent = async (
  client: UserClient,
  userId: string,
  sessionId: string,
  dispatch: ConversationDispatchPrepareResult,
) => {
  const { error } = await client.from('agent_events').insert({
    user_id: userId,
    actor: dispatch.responder_sender_key,
    event_type: 'conversation_reply_completed',
    entity_type: 'conversation_reply',
    entity_id: dispatch.reply.id,
    title: 'Syzygy · 陪伴回复了你',
    payload: {
      schema_version: 1,
      screen: 'conversation_detail',
      params: { id: sessionId },
      url: `/#/chat?session=${sessionId}`,
      session_id: sessionId,
      user_message_id: dispatch.user_message.id,
      reply_id: dispatch.reply.id,
      responder_sender_key: dispatch.responder_sender_key,
    },
    importance: 'normal',
  })

  // The partial unique index on (user_id, event_type, entity_id) makes a retry
  // safe. A duplicate means the first completion already created the push fact.
  if (error && error.code !== '23505') {
    throw new Error(`reply completion event failed: ${error.code ?? 'unknown'}`)
  }
}

const loadConversationRequest = async (
  client: UserClient,
  dispatch: ConversationDispatchPrepareResult,
  sessionId: string,
  userId: string,
  includeTimestamps: boolean,
) => {
  const [sessionResult, settingsResult] = await Promise.all([
    client
      .from('sessions')
      .select(
        'id,session_key,conversation_profile_key,override_model,override_reasoning',
      )
      .eq('id', sessionId)
      .eq('user_id', userId)
      .maybeSingle<SessionRow>(),
    client
      .from('user_settings')
      .select(
        'default_model,system_prompt,temperature,top_p,max_tokens,chat_reasoning_enabled,compression_trigger_ratio',
      )
      .eq('user_id', userId)
      .maybeSingle<UserSettingsRow>(),
  ])

  if (sessionResult.error || !sessionResult.data) {
    throw new Error(`session load failed: ${sessionResult.error?.code ?? 'not_found'}`)
  }
  if (settingsResult.error || !settingsResult.data) {
    throw new Error(`settings load failed: ${settingsResult.error?.code ?? 'not_found'}`)
  }
  const session = sessionResult.data
  const settings = settingsResult.data
  const { profileKey, profile } = await loadActiveConversationProfile(
    client,
    userId,
    session,
  )
  const generation = await loadActiveConversationGeneration(
    client,
    userId,
    profileKey,
    profile,
    settings.system_prompt,
  )
  const systemPrompt = generation.systemPrompt
  const contextRecipe = parseConversationContextRecipe(profile.context_recipe)
  const tokenBudget = resolveHistoryTokenBudget({
    systemPrompt,
    maxOutputTokens: settings.max_tokens,
    triggerRatio: settings.compression_trigger_ratio,
  })
  const epochStart = contextRecipe.epoch === 'asia_shanghai_day'
    ? startOfShanghaiDayIso(dispatch.user_message.created_at)
    : null
  const canonicalMessages = await loadConversationHistory({
    client,
    userId,
    sessionId,
    epochStart,
    tokenBudget,
    requiredMessageId: dispatch.user_message.id,
    excludedMessageId: dispatch.reply.id,
  })
  const messages = buildConversationModelMessages(systemPrompt, canonicalMessages, includeTimestamps)

  return {
    messages,
    model: profileKey === 'app_companion'
      ? generation.activeModel
      : session.override_model?.trim() || generation.activeModel || settings.default_model,
    reasoning: session.override_reasoning ?? settings.chat_reasoning_enabled,
    temperature: settings.temperature,
    top_p: settings.top_p,
    max_tokens: settings.max_tokens,
    extra: {
      canonical_context: {
        version: 1,
        managed_by: 'conversation-dispatch',
        profile_key: profileKey,
        recipe_version: contextRecipe.version,
        history_scope: contextRecipe.history_scope,
        epoch: contextRecipe.epoch,
        selection: contextRecipe.selection,
        external_sources: contextRecipe.external_sources,
      },
    },
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

  if (request.headers.has('x-lounge-worker-secret')) return handleLoungeWorker(request)

  const authorization = request.headers.get('authorization')
  const apiKey = request.headers.get('apikey')
  if (!authorization || !apiKey) {
    return jsonResponse({ error: '缺少身份令牌' }, 401, corsHeaders)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  if (!supabaseUrl) {
    return jsonResponse({ error: '服务未配置' }, 500, corsHeaders)
  }

  const identity = await verifyConversationUser(supabaseUrl, {
    apikey: apiKey,
    Authorization: authorization,
  })
  if (!identity.ok) {
    return jsonResponse({ error: identity.error, code: identity.code }, identity.status, corsHeaders)
  }
  const userId = identity.userId

  let ownerId = ''
  try {
    ownerId = getOwnerUserId()
  } catch (error) {
    console.error('[conversation-dispatch] owner configuration invalid', error)
    return jsonResponse({ error: '服务未配置' }, 500, corsHeaders)
  }

  if (userId !== ownerId) {
    return jsonResponse({ error: '无权访问' }, 403, corsHeaders)
  }

  const loungeBody = await request.clone().json().catch(() => null)
  if (loungeBody?.mode === 'lounge') return handleLoungeRequest(userId, loungeBody, corsHeaders)
  if (loungeBody?.mode === 'api_tools') return handleApiToolSettings(loungeBody, userId, supabaseUrl, authorization, apiKey, corsHeaders)

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

  let serviceClient: UserClient
  try {
    serviceClient = createClient(supabaseUrl, getSupabaseAdminKey(), {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  } catch (error) {
    console.error('[conversation-dispatch] privileged RPC client unavailable', error)
    return jsonResponse({ error: '服务未配置' }, 500, corsHeaders)
  }

  const { data, error } = await serviceClient.rpc('conversation_dispatch_prepare_durable', {
    p_user_id: userId,
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
    task: dispatch.task,
    should_execute: dispatch.should_execute,
    was_duplicate: dispatch.was_duplicate,
  }

  if (dispatch.handler === 'cli') {
    return jsonResponse(
      basePayload,
      resolveConversationDispatchHttpStatus(dispatch.reply.delivery_state),
      corsHeaders,
      dispatch,
    )
  }

  if (!dispatch.should_execute) {
    return jsonResponse(
      basePayload,
      resolveConversationDispatchHttpStatus(dispatch.reply.delivery_state),
      corsHeaders,
      dispatch,
    )
  }

  let modelRequest
  try {
    modelRequest = await loadConversationRequest(
      client,
      dispatch,
      payload.session_id,
      userId,
      payload.include_timestamps,
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

  const { readable, work: streamWork } = startApiConversation({
    client: serviceClient, userId, sessionId: payload.session_id,
    replyId: dispatch.reply.id, attempt: dispatch.reply.delivery_attempt,
    url: supabaseUrl, modelUrl: new URL('/functions/v1/openrouter-chat', supabaseUrl),
    headers: { apikey: apiKey, Authorization: authorization }, request: modelRequest,
    persist: (content, state, api, errorMessage) => persistReply(serviceClient, userId, dispatch, content, state,
      { model: api.model, api, errorMessage, ...(errorMessage ? { errorCode: 'API_EXECUTION_FAILED' } : {}) }),
    completed: () => publishApiReplyCompletedEvent(serviceClient, userId, payload.session_id, dispatch),
  })

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
      ...(dispatch.task
        ? { 'x-conversation-agent-task-id': dispatch.task.id }
        : {}),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
})
