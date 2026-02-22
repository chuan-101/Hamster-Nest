import type {
  ChatMessage,
  ChatSession,
  CheckinEntry,
  MemoryEntry,
  MemoryStatus,
  RpNpcCard,
  RpMessage,
  RpSession,
  SnackPost,
  SnackReply,
  SyzygyPost,
  SyzygyReply,
} from '../types'
import { supabase } from '../supabase/client'

type SessionRow = {
  id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string
  override_model: string | null
  override_reasoning: boolean | null
  is_archived: boolean | null
  archived_at: string | null
}

type MessageRow = {
  id: string
  session_id: string
  user_id: string
  role: ChatMessage['role']
  content: string
  created_at: string
  client_id: string | null
  client_created_at: string | null
  meta: ChatMessage['meta'] | null
}


type SnackPostRow = {
  id: string
  user_id: string
  content: string
  created_at: string
  updated_at: string
  is_deleted: boolean
}

type SnackReplyRow = {
  id: string
  user_id: string
  post_id: string
  role: SnackReply['role']
  content: string
  meta: SnackReply['meta'] | null
  created_at: string
  is_deleted: boolean
}


type SyzygyPostRow = {
  id: string
  user_id: string
  content: string
  model_id: string | null
  created_at: string
  updated_at: string
  is_deleted: boolean
}

type SyzygyReplyRow = {
  id: string
  user_id: string
  post_id: string
  author_role: SyzygyReply['authorRole']
  content: string
  model_id: string | null
  created_at: string
  is_deleted: boolean
}

type MemoryEntryRow = {
  id: string
  user_id: string
  content: string
  source: string
  status: MemoryStatus
  created_at: string
  updated_at: string
  is_deleted: boolean
}

type CheckinRow = {
  id: string
  user_id: string
  checkin_date: string
  created_at: string
}

type RpSessionRow = {
  id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string | null
  is_archived: boolean | null
  archived_at: string | null
  player_display_name: string | null
  player_avatar_url: string | null
  worldbook_text: string | null
  settings: Record<string, unknown> | null
}

type RpMessageRow = {
  id: string
  session_id: string
  user_id: string
  role: string
  content: string
  created_at: string
  client_id: string | null
  client_created_at: string | null
  meta: Record<string, unknown> | null
}

type RpNpcCardRow = {
  id: string
  session_id: string
  user_id: string
  display_name: string
  system_prompt: string | null
  model_config: Record<string, unknown> | null
  api_config: Record<string, unknown> | null
  enabled: boolean | null
  created_at: string
  updated_at: string | null
}

const mapSnackPostRow = (row: SnackPostRow): SnackPost => ({
  id: row.id,
  userId: row.user_id,
  content: row.content,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  isDeleted: row.is_deleted,
})

const mapSnackReplyRow = (row: SnackReplyRow): SnackReply => ({
  id: row.id,
  userId: row.user_id,
  postId: row.post_id,
  role: row.role,
  content: row.content,
  createdAt: row.created_at,
  isDeleted: row.is_deleted,
  meta: row.meta ?? undefined,
})


const mapSyzygyPostRow = (row: SyzygyPostRow): SyzygyPost => ({
  id: row.id,
  userId: row.user_id,
  content: row.content,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  isDeleted: row.is_deleted,
  modelId: row.model_id ?? null,
})

const mapSyzygyReplyRow = (row: SyzygyReplyRow): SyzygyReply => ({
  id: row.id,
  userId: row.user_id,
  postId: row.post_id,
  authorRole: row.author_role,
  content: row.content,
  createdAt: row.created_at,
  isDeleted: row.is_deleted,
  modelId: row.model_id ?? null,
})

const mapMemoryEntryRow = (row: MemoryEntryRow): MemoryEntry => ({
  id: row.id,
  userId: row.user_id,
  content: row.content,
  source: row.source,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  isDeleted: row.is_deleted,
})

const mapCheckinRow = (row: CheckinRow): CheckinEntry => ({
  id: row.id,
  userId: row.user_id,
  checkinDate: row.checkin_date,
  createdAt: row.created_at,
})

const mapRpSessionRow = (row: RpSessionRow): RpSession => ({
  id: row.id,
  userId: row.user_id,
  title: row.title,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  isArchived: row.is_archived ?? false,
  archivedAt: row.archived_at,
  playerDisplayName: row.player_display_name,
  playerAvatarUrl: row.player_avatar_url,
  worldbookText: row.worldbook_text,
  settings: row.settings ?? {},
})

const RP_SESSION_SELECT_FIELDS =
  'id,user_id,title,created_at,updated_at,is_archived,archived_at,player_display_name,player_avatar_url,worldbook_text,settings'

const mapRpMessageRow = (row: RpMessageRow): RpMessage => ({
  id: row.id,
  sessionId: row.session_id,
  userId: row.user_id,
  role: row.role,
  content: row.content,
  createdAt: row.created_at,
  clientId: row.client_id,
  clientCreatedAt: row.client_created_at,
  meta: row.meta ?? undefined,
})

const RP_NPC_CARD_SELECT_FIELDS =
  'id,session_id,user_id,display_name,system_prompt,model_config,api_config,enabled,created_at,updated_at'

const mapRpNpcCardRow = (row: RpNpcCardRow): RpNpcCard => ({
  id: row.id,
  sessionId: row.session_id,
  userId: row.user_id,
  displayName: row.display_name,
  systemPrompt: row.system_prompt ?? '',
  modelConfig: row.model_config ?? {},
  apiConfig: row.api_config ?? {},
  enabled: row.enabled ?? false,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const mapSessionRow = (row: SessionRow): ChatSession => ({
  id: row.id,
  title: row.title,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  overrideModel: row.override_model ?? null,
  overrideReasoning: row.override_reasoning ?? null,
  isArchived: row.is_archived ?? false,
  archivedAt: row.archived_at ?? null,
})

const mapMessageRow = (row: MessageRow): ChatMessage => ({
  id: row.id,
  sessionId: row.session_id,
  role: row.role,
  content: row.content,
  createdAt: row.created_at,
  clientId: row.client_id ?? row.id,
  clientCreatedAt: row.client_created_at,
  meta: row.meta ?? undefined,
  pending: false,
})

const requireAuthenticatedUserId = async (): Promise<string> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error) {
    throw error
  }
  if (!user) {
    throw new Error('登录状态异常，请重新登录')
  }
  return user.id
}

export const fetchRemoteSessions = async (userId: string): Promise<ChatSession[]> => {
  if (!supabase) {
    return []
  }
  const { data, error } = await supabase
    .from('sessions')
    .select('id,user_id,title,created_at,updated_at,override_model,override_reasoning,is_archived,archived_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) {
    throw error
  }
  return (data ?? []).map(mapSessionRow)
}

export const fetchRemoteMessages = async (userId: string): Promise<ChatMessage[]> => {
  if (!supabase) {
    return []
  }
  const { data, error } = await supabase
    .from('messages')
    .select('id,session_id,user_id,role,content,created_at,client_id,client_created_at,meta')
    .eq('user_id', userId)
    .order('client_created_at', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) {
    throw error
  }
  return (data ?? []).map(mapMessageRow)
}

export const createRemoteSession = async (
  userId: string,
  title: string,
): Promise<ChatSession> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      title,
      created_at: now,
      updated_at: now,
    })
    .select('id,user_id,title,created_at,updated_at,override_model,override_reasoning,is_archived,archived_at')
    .single()
  if (error || !data) {
    throw error ?? new Error('创建会话失败')
  }
  return mapSessionRow(data as SessionRow)
}

export const fetchRpSessions = async (userId: string, isArchived: boolean): Promise<RpSession[]> => {
  if (!supabase) {
    return []
  }
  const { data, error } = await supabase
    .from('rp_sessions')
    .select(RP_SESSION_SELECT_FIELDS)
    .eq('user_id', userId)
    .eq('is_archived', isArchived)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapRpSessionRow(row as RpSessionRow))
}

export const createRpSession = async (
  userId: string,
  title: string,
): Promise<RpSession> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('rp_sessions')
    .insert({
      user_id: userId,
      title,
      created_at: now,
      updated_at: now,
    })
    .select(RP_SESSION_SELECT_FIELDS)
    .single()
  if (error || !data) {
    throw error ?? new Error('创建 RP 房间失败')
  }
  return mapRpSessionRow(data as RpSessionRow)
}

export const fetchRpSessionById = async (sessionId: string, userId: string): Promise<RpSession | null> => {
  if (!supabase) {
    return null
  }
  const { data, error } = await supabase
    .from('rp_sessions')
    .select(RP_SESSION_SELECT_FIELDS)
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    throw error
  }
  if (!data) {
    return null
  }
  return mapRpSessionRow(data as RpSessionRow)
}

export const updateRpSessionArchiveState = async (
  sessionId: string,
  isArchived: boolean,
): Promise<RpSession> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const updates = isArchived
    ? { is_archived: true, archived_at: new Date().toISOString() }
    : { is_archived: false, archived_at: null }
  const { data, error } = await supabase
    .from('rp_sessions')
    .update(updates)
    .eq('id', sessionId)
    .eq('user_id', userId)
    .select(RP_SESSION_SELECT_FIELDS)
    .single()
  if (error || !data) {
    throw error ?? new Error('更新 RP 房间归档状态失败')
  }
  return mapRpSessionRow(data as RpSessionRow)
}

export const renameRpSession = async (
  sessionId: string,
  title: string,
): Promise<RpSession> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('rp_sessions')
    .update({ title, updated_at: now })
    .eq('id', sessionId)
    .eq('user_id', userId)
    .select(RP_SESSION_SELECT_FIELDS)
    .single()
  if (error || !data) {
    throw error ?? new Error('更新 RP 房间名称失败')
  }
  return mapRpSessionRow(data as RpSessionRow)
}

export const deleteRpSession = async (sessionId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const { error } = await supabase
    .from('rp_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('user_id', userId)
  if (error) {
    throw error
  }
}

export const updateRpSessionDashboard = async (
  sessionId: string,
  updates: {
    playerDisplayName?: string
    playerAvatarUrl?: string
    worldbookText?: string
    settings?: Record<string, unknown>
  },
): Promise<RpSession> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const nextUpdates: {
    updated_at: string
    player_display_name?: string
    player_avatar_url?: string
    worldbook_text?: string
    settings?: Record<string, unknown>
  } = {
    updated_at: new Date().toISOString(),
  }

  if (typeof updates.playerDisplayName !== 'undefined') {
    nextUpdates.player_display_name = updates.playerDisplayName
  }
  if (typeof updates.playerAvatarUrl !== 'undefined') {
    nextUpdates.player_avatar_url = updates.playerAvatarUrl
  }
  if (typeof updates.worldbookText !== 'undefined') {
    nextUpdates.worldbook_text = updates.worldbookText
  }
  if (typeof updates.settings !== 'undefined') {
    nextUpdates.settings = updates.settings
  }

  const { data, error } = await supabase
    .from('rp_sessions')
    .update(nextUpdates)
    .eq('id', sessionId)
    .eq('user_id', userId)
    .select(RP_SESSION_SELECT_FIELDS)
    .single()

  if (error || !data) {
    throw error ?? new Error('更新 RP 仪表盘设置失败')
  }

  return mapRpSessionRow(data as RpSessionRow)
}

export const fetchRpMessages = async (sessionId: string, userId: string): Promise<RpMessage[]> => {
  if (!supabase) {
    return []
  }
  const { data, error } = await supabase
    .from('rp_messages')
    .select('id,session_id,user_id,role,content,created_at,client_id,client_created_at,meta')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapRpMessageRow(row as RpMessageRow))
}

export const createRpMessage = async (
  sessionId: string,
  userId: string,
  role: string,
  content: string,
): Promise<RpMessage> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('rp_messages')
    .insert({
      session_id: sessionId,
      user_id: userId,
      role,
      content,
      created_at: now,
      meta: {},
    })
    .select('id,session_id,user_id,role,content,created_at,client_id,client_created_at,meta')
    .single()
  if (error || !data) {
    throw error ?? new Error('发送 RP 消息失败')
  }
  return mapRpMessageRow(data as RpMessageRow)
}

export const deleteRpMessage = async (messageId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const { error } = await supabase
    .from('rp_messages')
    .delete()
    .eq('id', messageId)
    .eq('user_id', userId)
  if (error) {
    throw error
  }
}

export const fetchRpNpcCards = async (sessionId: string, userId: string): Promise<RpNpcCard[]> => {
  if (!supabase) {
    return []
  }
  const { data, error } = await supabase
    .from('rp_npc_cards')
    .select(RP_NPC_CARD_SELECT_FIELDS)
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapRpNpcCardRow(row as RpNpcCardRow))
}

export const createRpNpcCard = async (
  payload: {
    sessionId: string
    userId: string
    displayName: string
    systemPrompt?: string
    modelConfig?: Record<string, unknown>
    apiConfig?: Record<string, unknown>
    enabled?: boolean
  },
): Promise<RpNpcCard> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const normalizedSystemPrompt = payload.systemPrompt ?? ''
  const normalizedModelConfig = payload.modelConfig ?? {}
  const normalizedApiConfig = payload.apiConfig ?? {}
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('rp_npc_cards')
    .insert({
      session_id: payload.sessionId,
      user_id: payload.userId,
      display_name: payload.displayName,
      system_prompt: normalizedSystemPrompt,
      model_config: normalizedModelConfig,
      api_config: normalizedApiConfig,
      enabled: payload.enabled ?? false,
      created_at: now,
      updated_at: now,
    })
    .select(RP_NPC_CARD_SELECT_FIELDS)
    .single()
  if (error || !data) {
    throw error ?? new Error('创建 NPC 角色卡失败')
  }
  return mapRpNpcCardRow(data as RpNpcCardRow)
}

export const updateRpNpcCard = async (
  npcCardId: string,
  updates: {
    displayName?: string
    systemPrompt?: string
    modelConfig?: Record<string, unknown>
    apiConfig?: Record<string, unknown>
    enabled?: boolean
  },
): Promise<RpNpcCard> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const nextUpdates: {
    updated_at: string
    display_name?: string
    system_prompt?: string
    model_config?: Record<string, unknown>
    api_config?: Record<string, unknown>
    enabled?: boolean
  } = {
    updated_at: new Date().toISOString(),
  }
  if (typeof updates.displayName !== 'undefined') {
    nextUpdates.display_name = updates.displayName
  }
  if (typeof updates.systemPrompt !== 'undefined') {
    nextUpdates.system_prompt = updates.systemPrompt ?? ''
  }
  if (typeof updates.modelConfig !== 'undefined') {
    nextUpdates.model_config = updates.modelConfig ?? {}
  }
  if (typeof updates.apiConfig !== 'undefined') {
    nextUpdates.api_config = updates.apiConfig ?? {}
  }
  if (typeof updates.enabled !== 'undefined') {
    nextUpdates.enabled = updates.enabled
  }

  const { data, error } = await supabase
    .from('rp_npc_cards')
    .update(nextUpdates)
    .eq('id', npcCardId)
    .eq('user_id', userId)
    .select(RP_NPC_CARD_SELECT_FIELDS)
    .single()

  if (error || !data) {
    throw error ?? new Error('更新 NPC 角色卡失败')
  }
  return mapRpNpcCardRow(data as RpNpcCardRow)
}

export const deleteRpNpcCard = async (npcCardId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const { error } = await supabase
    .from('rp_npc_cards')
    .delete()
    .eq('id', npcCardId)
    .eq('user_id', userId)
  if (error) {
    throw error
  }
}

export const renameRemoteSession = async (
  sessionId: string,
  title: string,
): Promise<ChatSession> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('sessions')
    .update({ title, updated_at: now })
    .eq('id', sessionId)
    .select('id,user_id,title,created_at,updated_at,override_model,override_reasoning,is_archived,archived_at')
    .single()
  if (error || !data) {
    throw error ?? new Error('更新会话失败')
  }
  return mapSessionRow(data as SessionRow)
}

export const updateRemoteSessionOverride = async (
  sessionId: string,
  overrideModel: string | null,
): Promise<ChatSession> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('sessions')
    .update({ override_model: overrideModel, updated_at: now })
    .eq('id', sessionId)
    .select('id,user_id,title,created_at,updated_at,override_model,override_reasoning,is_archived,archived_at')
    .single()
  if (error || !data) {
    throw error ?? new Error('更新会话模型失败')
  }
  return mapSessionRow(data as SessionRow)
}

export const updateRemoteSessionReasoningOverride = async (
  sessionId: string,
  overrideReasoning: boolean | null,
): Promise<ChatSession> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('sessions')
    .update({ override_reasoning: overrideReasoning, updated_at: now })
    .eq('id', sessionId)
    .select('id,user_id,title,created_at,updated_at,override_model,override_reasoning,is_archived,archived_at')
    .single()
  if (error || !data) {
    throw error ?? new Error('更新会话思考链失败')
  }
  return mapSessionRow(data as SessionRow)
}


export const updateRemoteSessionArchiveState = async (
  sessionId: string,
  isArchived: boolean,
): Promise<ChatSession> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const updates = isArchived
    ? { is_archived: true, archived_at: new Date().toISOString() }
    : { is_archived: false, archived_at: null }
  const { data, error } = await supabase
    .from('sessions')
    .update(updates)
    .eq('id', sessionId)
    .eq('user_id', userId)
    .select('id,user_id,title,created_at,updated_at,override_model,override_reasoning,is_archived,archived_at')
    .single()
  if (error || !data) {
    throw error ?? new Error('更新会话抽屉状态失败')
  }
  return mapSessionRow(data as SessionRow)
}

export const deleteRemoteSession = async (sessionId: string) => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { error: messagesError } = await supabase
    .from('messages')
    .delete()
    .eq('session_id', sessionId)
  if (messagesError) {
    throw messagesError
  }
  const { error: sessionError } = await supabase
    .from('sessions')
    .delete()
    .eq('id', sessionId)
  if (sessionError) {
    throw sessionError
  }
}

export const addRemoteMessage = async (
  sessionId: string,
  userId: string,
  role: ChatMessage['role'],
  content: string,
  clientId: string,
  clientCreatedAt: string,
  meta?: ChatMessage['meta'],
): Promise<{ message: ChatMessage; updatedAt: string }> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const safeMeta = meta ?? {}
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('messages')
    .insert({
      session_id: sessionId,
      user_id: userId,
      role,
      content,
      created_at: now,
      client_id: clientId,
      client_created_at: clientCreatedAt,
      meta: safeMeta,
    })
    .select('id,session_id,user_id,role,content,created_at,client_id,client_created_at,meta')
    .single()
  if (error || !data) {
    throw error ?? new Error('发送消息失败')
  }
  const { error: sessionError } = await supabase
    .from('sessions')
    .update({ updated_at: now })
    .eq('id', sessionId)
  if (sessionError) {
    throw sessionError
  }
  return { message: mapMessageRow(data as MessageRow), updatedAt: now }
}

export const deleteRemoteMessage = async (messageId: string) => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { error } = await supabase.from('messages').delete().eq('id', messageId)
  if (error) {
    throw error
  }
}


export const fetchSnackPosts = async (): Promise<SnackPost[]> => {
  if (!supabase) {
    return []
  }
  const { data, error } = await supabase
    .from('snack_posts')
    .select('id,user_id,content,created_at,updated_at,is_deleted')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapSnackPostRow(row as SnackPostRow))
}


export const fetchDeletedSnackPosts = async (): Promise<SnackPost[]> => {
  if (!supabase) {
    return []
  }
  const { data, error } = await supabase
    .from('snack_posts')
    .select('id,user_id,content,created_at,updated_at,is_deleted')
    .eq('is_deleted', true)
    .order('updated_at', { ascending: false })

  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapSnackPostRow(row as SnackPostRow))
}

export const createSnackPost = async (content: string): Promise<SnackPost> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { data, error } = await supabase
    .from('snack_posts')
    .insert({ content })
    .select('id,user_id,content,created_at,updated_at,is_deleted')
    .single()

  if (error || !data) {
    throw error ?? new Error('发布零食记录失败')
  }
  return mapSnackPostRow(data as SnackPostRow)
}


export const restoreSnackPost = async (postId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { error } = await supabase.rpc('restore_snack_post', { p_post_id: postId })

  if (error) {
    throw error
  }
}

export const softDeleteSnackPost = async (postId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { error } = await supabase.rpc('soft_delete_snack_post', { p_post_id: postId })

  if (error) {
    throw error
  }
}

export const fetchSnackReplies = async (postIds: string[]): Promise<SnackReply[]> => {
  if (!supabase || postIds.length === 0) {
    return []
  }
  const { data, error } = await supabase
    .from('snack_replies')
    .select('id,user_id,post_id,role,content,meta,created_at,is_deleted')
    .in('post_id', postIds)
    .in('role', ['user', 'assistant'])
    .eq('is_deleted', false)
    .order('created_at', { ascending: true })
  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapSnackReplyRow(row as SnackReplyRow))
}

export const fetchSnackRepliesByPost = async (postId: string): Promise<SnackReply[]> => {
  if (!supabase) {
    return []
  }
  const { data, error } = await supabase
    .from('snack_replies')
    .select('id,user_id,post_id,role,content,meta,created_at,is_deleted')
    .eq('post_id', postId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapSnackReplyRow(row as SnackReplyRow))
}

export const createSnackReply = async (
  postId: string,
  role: SnackReply['role'],
  content: string,
  meta: SnackReply['meta'],
): Promise<SnackReply> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { data, error } = await supabase
    .from('snack_replies')
    .insert({ post_id: postId, role, content, meta: meta ?? {} })
    .select('id,user_id,post_id,role,content,meta,created_at,is_deleted')
    .single()
  if (error || !data) {
    throw error ?? new Error('保存零食回复失败')
  }
  return mapSnackReplyRow(data as SnackReplyRow)
}

export const softDeleteSnackReply = async (replyId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { error } = await supabase.rpc('soft_delete_snack_reply', { p_reply_id: replyId })

  if (error) {
    throw error
  }
}

export const fetchDeletedSnackReplies = async (): Promise<SnackReply[]> => {
  if (!supabase) {
    return []
  }
  const { data, error } = await supabase
    .from('snack_replies')
    .select('id,user_id,post_id,role,content,meta,created_at,is_deleted')
    .eq('is_deleted', true)
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapSnackReplyRow(row as SnackReplyRow))
}

export const restoreSnackReply = async (replyId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { error } = await supabase
    .from('snack_replies')
    .update({ is_deleted: false })
    .eq('id', replyId)

  if (error) {
    throw error
  }
}

export const permanentlyDeleteSnackPost = async (postId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { error: repliesError } = await supabase.from('snack_replies').delete().eq('post_id', postId)
  if (repliesError) {
    throw repliesError
  }

  const { error: postError } = await supabase
    .from('snack_posts')
    .delete()
    .eq('id', postId)
    .eq('is_deleted', true)

  if (postError) {
    throw postError
  }
}

export const permanentlyDeleteSnackReply = async (replyId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { error } = await supabase
    .from('snack_replies')
    .delete()
    .eq('id', replyId)
    .eq('is_deleted', true)

  if (error) {
    throw error
  }
}


export const fetchSyzygyPosts = async (): Promise<SyzygyPost[]> => {
  if (!supabase) {
    return []
  }
  const { data, error } = await supabase
    .from('syzygy_posts')
    .select('id,user_id,content,model_id,created_at,updated_at,is_deleted')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapSyzygyPostRow(row as SyzygyPostRow))
}

export const fetchDeletedSyzygyPosts = async (): Promise<SyzygyPost[]> => {
  if (!supabase) {
    return []
  }
  const { data, error } = await supabase
    .from('syzygy_posts')
    .select('id,user_id,content,model_id,created_at,updated_at,is_deleted')
    .eq('is_deleted', true)
    .order('updated_at', { ascending: false })

  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapSyzygyPostRow(row as SyzygyPostRow))
}

export const createSyzygyPost = async (
  content: string,
  selectedModelId: string | null = null,
): Promise<SyzygyPost> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase
    .from('syzygy_posts')
    .insert({ user_id: userId, content, model_id: selectedModelId ?? null })
    .select('id,user_id,content,model_id,created_at,updated_at,is_deleted')
    .single()

  if (error || !data) {
    throw error ?? new Error('发布观察日志失败')
  }
  return mapSyzygyPostRow(data as SyzygyPostRow)
}

export const restoreSyzygyPost = async (postId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { error } = await supabase
    .from('syzygy_posts')
    .update({ is_deleted: false, deleted_at: null })
    .eq('id', postId)

  if (error) {
    throw error
  }
}

export const softDeleteSyzygyPost = async (postId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { error } = await supabase
    .from('syzygy_posts')
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq('id', postId)

  if (error) {
    throw error
  }
}

export const fetchSyzygyReplies = async (postIds: string[]): Promise<SyzygyReply[]> => {
  if (!supabase || postIds.length === 0) {
    return []
  }
  const { data, error } = await supabase
    .from('syzygy_replies')
    .select('id,user_id,post_id,author_role,content,model_id,created_at,is_deleted')
    .in('post_id', postIds)
    .in('author_role', ['user', 'ai'])
    .eq('is_deleted', false)
    .order('created_at', { ascending: true })
  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapSyzygyReplyRow(row as SyzygyReplyRow))
}

export const fetchSyzygyRepliesByPost = async (postId: string): Promise<SyzygyReply[]> => {
  if (!supabase) {
    return []
  }
  const { data, error } = await supabase
    .from('syzygy_replies')
    .select('id,user_id,post_id,author_role,content,model_id,created_at,is_deleted')
    .eq('post_id', postId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapSyzygyReplyRow(row as SyzygyReplyRow))
}

export const createSyzygyReply = async (
  postId: string,
  authorRole: SyzygyReply['authorRole'],
  content: string,
  selectedModelId: string | null = null,
): Promise<SyzygyReply> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase
    .from('syzygy_replies')
    .insert({
      user_id: userId,
      post_id: postId,
      author_role: authorRole,
      content,
      model_id: selectedModelId ?? null,
    })
    .select('id,user_id,post_id,author_role,content,model_id,created_at,is_deleted')
    .single()
  if (error || !data) {
    throw error ?? new Error('保存观察日志回复失败')
  }
  return mapSyzygyReplyRow(data as SyzygyReplyRow)
}

export const softDeleteSyzygyReply = async (replyId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { error } = await supabase
    .from('syzygy_replies')
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq('id', replyId)

  if (error) {
    throw error
  }
}

export const fetchDeletedSyzygyReplies = async (): Promise<SyzygyReply[]> => {
  if (!supabase) {
    return []
  }
  const { data, error } = await supabase
    .from('syzygy_replies')
    .select('id,user_id,post_id,author_role,content,model_id,created_at,is_deleted')
    .eq('is_deleted', true)
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapSyzygyReplyRow(row as SyzygyReplyRow))
}

export const restoreSyzygyReply = async (replyId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { error } = await supabase
    .from('syzygy_replies')
    .update({ is_deleted: false, deleted_at: null })
    .eq('id', replyId)

  if (error) {
    throw error
  }
}

export const permanentlyDeleteSyzygyPost = async (postId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { error: repliesError } = await supabase.from('syzygy_replies').delete().eq('post_id', postId)
  if (repliesError) {
    throw repliesError
  }

  const { error: postError } = await supabase
    .from('syzygy_posts')
    .delete()
    .eq('id', postId)
    .eq('is_deleted', true)

  if (postError) {
    throw postError
  }
}

export const permanentlyDeleteSyzygyReply = async (replyId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { error } = await supabase
    .from('syzygy_replies')
    .delete()
    .eq('id', replyId)
    .eq('is_deleted', true)

  if (error) {
    throw error
  }
}

export const listMemories = async (status: MemoryStatus): Promise<MemoryEntry[]> => {
  if (!supabase) {
    return []
  }
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase
    .from('memory_entries')
    .select('id,user_id,content,source,status,created_at,updated_at,is_deleted')
    .eq('user_id', userId)
    .eq('status', status)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapMemoryEntryRow(row as MemoryEntryRow))
}

export const fetchPendingMemoryCount = async (userId: string): Promise<number> => {
  if (!supabase) {
    return 0
  }
  const { count, error } = await supabase
    .from('memory_entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'pending')
    .eq('is_deleted', false)
  if (error) {
    throw error
  }
  return count ?? 0
}

export const createMemory = async (content: string): Promise<MemoryEntry> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('memory_entries')
    .insert({
      user_id: userId,
      content,
      source: 'user_created',
      status: 'confirmed',
      created_at: now,
      updated_at: now,
      is_deleted: false,
    })
    .select('id,user_id,content,source,status,created_at,updated_at,is_deleted')
    .single()
  if (error || !data) {
    throw error ?? new Error('创建记忆失败')
  }
  return mapMemoryEntryRow(data as MemoryEntryRow)
}

export const updateMemory = async (id: string, content: string): Promise<MemoryEntry> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('memory_entries')
    .update({ content, source: 'user_edited', updated_at: now })
    .eq('id', id)
    .eq('is_deleted', false)
    .select('id,user_id,content,source,status,created_at,updated_at,is_deleted')
    .single()
  if (error || !data) {
    throw error ?? new Error('更新记忆失败')
  }
  return mapMemoryEntryRow(data as MemoryEntryRow)
}

export const confirmMemory = async (id: string, content?: string): Promise<MemoryEntry> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const now = new Date().toISOString()
  const updates: Record<string, unknown> = {
    status: 'confirmed',
    updated_at: now,
  }
  if (typeof content === 'string') {
    updates.content = content
    updates.source = 'user_edited'
  }
  const { data, error } = await supabase
    .from('memory_entries')
    .update(updates)
    .eq('id', id)
    .eq('is_deleted', false)
    .select('id,user_id,content,source,status,created_at,updated_at,is_deleted')
    .single()
  if (error || !data) {
    throw error ?? new Error('确认记忆失败')
  }
  return mapMemoryEntryRow(data as MemoryEntryRow)
}

export const discardMemory = async (id: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { error } = await supabase
    .from('memory_entries')
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    throw error
  }
}

export const createTodayCheckin = async (checkinDate: string): Promise<'created' | 'already_checked_in'> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const { error } = await supabase.from('checkins').insert({
    user_id: userId,
    checkin_date: checkinDate,
  })
  if (!error) {
    return 'created'
  }

  if (error.code === '23505') {
    return 'already_checked_in'
  }
  throw error
}

export const fetchRecentCheckins = async (limit = 60): Promise<CheckinEntry[]> => {
  if (!supabase) {
    return []
  }
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase
    .from('checkins')
    .select('id,user_id,checkin_date,created_at')
    .eq('user_id', userId)
    .order('checkin_date', { ascending: false })
    .limit(limit)
  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapCheckinRow(row as CheckinRow))
}

export const fetchCheckinTotalCount = async (): Promise<number> => {
  if (!supabase) {
    return 0
  }
  const userId = await requireAuthenticatedUserId()
  const { count, error } = await supabase
    .from('checkins')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (error) {
    throw error
  }
  return count ?? 0
}
