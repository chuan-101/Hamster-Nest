import type {
  BubbleMessage,
  BubbleSession,
  ChatMessage,
  ChatSession,
  CheckinEntry,
  ForumAiProfile,
  ForumReply,
  ForumThread,
  ForumAuthorType,
  LetterEntry,
  LetterTriggerType,
  MemoEntry,
  MemoSource,
  MemoTag,
  MemoryEntry,
  MemoryStatus,
  RpNpcCard,
  RpMessage,
  RpSession,
  RpSessionGroup,
  RpStoryGroup,
  SnackPost,
  SnackReply,
  SyzygyPost,
  SyzygyReply,
} from '../types'
import { supabase } from '../supabase/client'

const FORUM_USER_AUTHOR_NAME = '串串'

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

type MemoEntryRow = {
  id: string
  user_id: string
  content: string
  source: MemoSource
  is_pinned: boolean | null
  created_at: string
  updated_at: string
  is_deleted: boolean
}

type MemoTagRow = {
  id: string
  user_id: string
  name: string
  created_at: string
}

type MemoEntryTagRow = {
  memo_entry_id: string
  memo_tag_id: string
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
  tile_color: string | null
  created_at: string
  updated_at: string | null
  is_archived: boolean | null
  archived_at: string | null
  player_display_name: string | null
  player_avatar_url: string | null
  worldbook_text: string | null
  rp_context_token_limit: number | null
  rp_keep_recent_messages: number | null
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

type ForumThreadRow = {
  id: string
  user_id: string
  title: string
  body: string
  author_type: ForumAuthorType
  author_slot: number | null
  author_name: string | null
  created_at: string
  updated_at: string
}

type ForumReplyRow = {
  id: string
  thread_id: string
  user_id: string
  body: string
  author_type: ForumAuthorType
  author_slot: number | null
  author_name: string | null
  parent_id: string | null
  reply_to_reply_id: string | null
  reply_to_author_name: string | null
  depth?: number | null
  sort_path?: string | null
  created_at: string
}

type ForumAiProfileRow = {
  id: string
  user_id: string
  slot_index: number
  enabled: boolean | null
  name: string | null
  system_prompt: string | null
  model: string | null
  temperature: number | null
  top_p: number | null
  api_base_url: string | null
  context_token_limit: number | null
  created_at: string
  updated_at: string
}

type LetterRow = {
  id: string
  user_id: string
  model: string
  content: string
  trigger_type: LetterTriggerType
  trigger_reason: string | null
  created_at: string
  is_read: boolean | null
  conversation_id: string | null
  module: string | null
  metadata: Record<string, unknown> | null
}

type LetterConversationRow = {
  letter_id: string
  conversation_id: string
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

const mapMemoEntryRow = (row: MemoEntryRow, tagIds: string[]): MemoEntry => ({
  id: row.id,
  userId: row.user_id,
  content: row.content,
  source: row.source,
  isPinned: row.is_pinned ?? false,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  isDeleted: row.is_deleted,
  tagIds,
})

const mapMemoTagRow = (row: MemoTagRow): MemoTag => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  createdAt: row.created_at,
})

const mapRpSessionRow = (row: RpSessionRow): RpSession => ({
  id: row.id,
  userId: row.user_id,
  title: row.title,
  tileColor: row.tile_color ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  isArchived: row.is_archived ?? false,
  archivedAt: row.archived_at,
  playerDisplayName: row.player_display_name,
  playerAvatarUrl: row.player_avatar_url,
  worldbookText: row.worldbook_text,
  rpContextTokenLimit: row.rp_context_token_limit,
  rpKeepRecentMessages: row.rp_keep_recent_messages,
  settings: row.settings ?? {},
})

const RP_SESSION_SELECT_FIELDS =
  'id,user_id,title,tile_color,created_at,updated_at,is_archived,archived_at,player_display_name,player_avatar_url,worldbook_text,rp_context_token_limit,rp_keep_recent_messages,settings'

const RP_SESSION_SELECT_FIELDS_LEGACY =
  'id,user_id,title,created_at,updated_at,is_archived,archived_at,player_display_name,player_avatar_url,worldbook_text,rp_context_token_limit,rp_keep_recent_messages,settings'

const isMissingTileColorColumnError = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return false
  }
  const candidate = error as { code?: unknown; message?: unknown }
  const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : ''
  return candidate.code === '42703' || message.includes('tile_color')
}

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

const mapForumThreadRow = (row: ForumThreadRow): ForumThread => ({
  id: row.id,
  userId: row.user_id,
  title: row.title,
  content: row.body,
  authorType: row.author_type,
  authorSlot: row.author_slot,
  authorName: row.author_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const mapForumReplyRow = (row: ForumReplyRow): ForumReply => {
  const canonicalParentId = row.parent_id ?? row.reply_to_reply_id

  return {
    id: row.id,
    threadId: row.thread_id,
    userId: row.user_id,
    content: row.body,
    authorType: row.author_type,
    authorSlot: row.author_slot,
    authorName: row.author_name,
    parentId: canonicalParentId,
    depth: row.depth ?? undefined,
    sortPath: row.sort_path ?? undefined,
    replyToType: canonicalParentId ? 'reply' : 'thread',
    replyToReplyId: row.reply_to_reply_id ?? canonicalParentId,
    replyToAuthorName: row.reply_to_author_name,
    createdAt: row.created_at,
  }
}

const normalizeForumContextTokenLimit = (value: number | null | undefined) => {
  if (!Number.isFinite(value)) {
    return 32000
  }
  const rounded = Math.round(value as number)
  return rounded >= 8000 && rounded <= 128000 ? rounded : 32000
}

const mapForumAiProfileRow = (row: ForumAiProfileRow): ForumAiProfile => ({
  id: row.id,
  userId: row.user_id,
  slotIndex: row.slot_index,
  enabled: row.enabled ?? true,
  displayName: row.name ?? `AI Slot ${row.slot_index}`,
  systemPrompt: row.system_prompt ?? '',
  model: row.model ?? 'openrouter/auto',
  temperature: row.temperature ?? 0.8,
  topP: row.top_p ?? 0.9,
  contextTokenLimit: normalizeForumContextTokenLimit(row.context_token_limit),
  apiBaseUrl: row.api_base_url ?? '',
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

const mapLetterRow = (row: LetterRow): LetterEntry => ({
  id: row.id,
  userId: row.user_id,
  model: row.model,
  content: row.content,
  triggerType: row.trigger_type,
  triggerReason: row.trigger_reason,
  createdAt: row.created_at,
  isRead: row.is_read ?? false,
  conversationId: row.conversation_id,
  module: row.module,
  metadata: row.metadata,
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

export const fetchLetters = async (): Promise<LetterEntry[]> => {
  if (!supabase) {
    return []
  }
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase
    .from('letters')
    .select(
      'id,user_id,model,content,trigger_type,trigger_reason,created_at,is_read,conversation_id,module,metadata',
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapLetterRow(row as LetterRow))
}

export const fetchLettersByConversation = async (sessionId: string): Promise<LetterEntry[]> => {
  if (!supabase) {
    return []
  }
  const userId = await requireAuthenticatedUserId()
  const { data: links, error: linkError } = await supabase
    .from('letter_conversations')
    .select('letter_id,conversation_id')
    .eq('conversation_id', sessionId)
  if (linkError) {
    throw linkError
  }

  const linkedLetterIds = Array.from(
    new Set((links ?? []).map((row) => (row as LetterConversationRow).letter_id).filter(Boolean)),
  )

  let query = supabase
    .from('letters')
    .select(
      'id,user_id,model,content,trigger_type,trigger_reason,created_at,is_read,conversation_id,module,metadata',
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (linkedLetterIds.length > 0) {
    query = query.in('id', linkedLetterIds)
  } else {
    query = query.eq('conversation_id', sessionId)
  }

  const { data, error } = await query
  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapLetterRow(row as LetterRow))
}

export const createLetter = async (
  input: {
    model: string
    content: string
    triggerType?: LetterTriggerType
    triggerReason?: string | null
    conversationId?: string | null
    module?: string | null
    metadata?: Record<string, unknown> | null
    createdAt?: string
    isRead?: boolean
  },
): Promise<LetterEntry> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase
    .from('letters')
    .insert({
      user_id: userId,
      model: input.model,
      content: input.content,
      trigger_type: input.triggerType ?? 'manual',
      trigger_reason: input.triggerReason ?? null,
      created_at: input.createdAt ?? new Date().toISOString(),
      is_read: input.isRead ?? false,
      conversation_id: input.conversationId ?? null,
      module: input.module ?? null,
      metadata: input.metadata ?? null,
    })
    .select(
      'id,user_id,model,content,trigger_type,trigger_reason,created_at,is_read,conversation_id,module,metadata',
    )
    .single()
  if (error || !data) {
    throw error ?? new Error('创建信件失败')
  }
  const letter = mapLetterRow(data as LetterRow)
  return letter
}

export const markLetterAsRead = async (letterId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const { error } = await supabase
    .from('letters')
    .update({ is_read: true })
    .eq('id', letterId)
    .eq('user_id', userId)
  if (error) {
    throw error
  }
}

export const linkLetterToConversation = async (letterId: string, conversationId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const { error: linkError } = await supabase
    .from('letter_conversations')
    .upsert(
      {
        letter_id: letterId,
        conversation_id: conversationId,
      },
      {
        onConflict: 'letter_id,conversation_id',
        ignoreDuplicates: true,
      },
    )
  if (linkError) {
    throw linkError
  }

  const { error: legacyError } = await supabase
    .from('letters')
    .update({ conversation_id: conversationId })
    .eq('id', letterId)
    .eq('user_id', userId)
    .is('conversation_id', null)
  if (legacyError) {
    throw legacyError
  }
}

export const deleteLetter = async (letterId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const { error } = await supabase
    .from('letters')
    .delete()
    .eq('id', letterId)
    .eq('user_id', userId)
  if (error) {
    throw error
  }
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
  const query = supabase
    .from('rp_sessions')
    .select(RP_SESSION_SELECT_FIELDS)
    .eq('user_id', userId)
    .eq('is_archived', isArchived)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  const { data, error } = await query
  if (error && isMissingTileColorColumnError(error)) {
    const { data: legacyData, error: legacyError } = await supabase
      .from('rp_sessions')
      .select(RP_SESSION_SELECT_FIELDS_LEGACY)
      .eq('user_id', userId)
      .eq('is_archived', isArchived)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })

    if (legacyError) {
      throw legacyError
    }

    return (legacyData ?? []).map((row) => mapRpSessionRow({ ...(row as RpSessionRow), tile_color: null }))
  }
  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapRpSessionRow(row as RpSessionRow))
}

export const updateRpSessionTileColor = async (
  sessionId: string,
  tileColor: string,
  signal?: AbortSignal,
): Promise<void> => {
  if (!supabase) {
    return
  }
  const userId = await requireAuthenticatedUserId()
  const now = new Date().toISOString()
  let query = supabase
    .from('rp_sessions')
    .update({ tile_color: tileColor, updated_at: now })
    .eq('id', sessionId)
    .eq('user_id', userId)

  if (signal) {
    query = query.abortSignal(signal)
  }

  const { error } = await query
  if (error && !isMissingTileColorColumnError(error)) {
    throw error
  }
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
    rpContextTokenLimit?: number
    rpKeepRecentMessages?: number
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
    rp_context_token_limit?: number
    rp_keep_recent_messages?: number
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
  if (typeof updates.rpContextTokenLimit !== 'undefined') {
    nextUpdates.rp_context_token_limit = updates.rpContextTokenLimit
  }
  if (typeof updates.rpKeepRecentMessages !== 'undefined') {
    nextUpdates.rp_keep_recent_messages = updates.rpKeepRecentMessages
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

export const fetchRpMessageCounts = async (
  userId: string,
  sessionIds: string[],
  signal?: AbortSignal,
): Promise<Record<string, number>> => {
  if (!supabase || sessionIds.length === 0) {
    return {}
  }

  let query = supabase
    .from('rp_messages')
    .select('session_id')
    .eq('user_id', userId)
    .in('session_id', sessionIds)

  if (signal) {
    query = query.abortSignal(signal)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  const counts = sessionIds.reduce<Record<string, number>>((accumulator, sessionId) => {
    accumulator[sessionId] = 0
    return accumulator
  }, {})

  const rows = (data ?? []) as Array<{ session_id: string }>
  rows.forEach((row) => {
    counts[row.session_id] = (counts[row.session_id] ?? 0) + 1
  })

  return counts
}

export const createRpMessage = async (
  sessionId: string,
  userId: string,
  role: string,
  content: string,
  options?: {
    createdAt?: string
    meta?: Record<string, unknown>
  },
): Promise<RpMessage> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const now = options?.createdAt ?? new Date().toISOString()
  const { data, error } = await supabase
    .from('rp_messages')
    .insert({
      session_id: sessionId,
      user_id: userId,
      role,
      content,
      created_at: now,
      meta: options?.meta ?? {},
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
  const message = mapMessageRow(data as MessageRow)
  return { message, updatedAt: now }
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
  const post = mapSnackPostRow(data as SnackPostRow)
  return post
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
  const reply = mapSnackReplyRow(data as SnackReplyRow)
  return reply
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
  const post = mapSyzygyPostRow(data as SyzygyPostRow)
  return post
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
  const reply = mapSyzygyReplyRow(data as SyzygyReplyRow)
  return reply
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

const resolveForumAuthorPayload = async (
  userId: string,
  authorType: ForumAuthorType,
  authorSlot?: number | null,
  preferredAuthorName?: string,
): Promise<{ authorSlot: number | null; authorName: string }> => {
  if (authorType === 'user') {
    return { authorSlot: null, authorName: FORUM_USER_AUTHOR_NAME }
  }

  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }

  const normalizedSlot = authorSlot ?? 1
  const preferredName = preferredAuthorName?.trim()
  if (preferredName) {
    return {
      authorSlot: normalizedSlot,
      authorName: preferredName,
    }
  }

  const { data, error } = await supabase
    .from('forum_ai_profiles')
    .select('name')
    .eq('user_id', userId)
    .eq('slot_index', normalizedSlot)
    .maybeSingle()

  if (error) {
    throw error
  }

  const profileName = data?.name?.trim()
  return {
    authorSlot: normalizedSlot,
    authorName: profileName || `AI Slot ${normalizedSlot}`,
  }
}

const resolveReplyTargetAuthorName = async (userId: string, threadId: string, replyId?: string | null) => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }

  if (replyId) {
    const { data, error } = await supabase
      .from('forum_replies')
      .select('author_name')
      .eq('id', replyId)
      .eq('thread_id', threadId)
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      throw error
    }

    const targetName = data?.author_name?.trim()
    if (targetName) {
      return targetName
    }
  }

  const { data: threadData, error: threadError } = await supabase
    .from('forum_threads')
    .select('author_name')
    .eq('id', threadId)
    .eq('user_id', userId)
    .maybeSingle()

  if (threadError) {
    throw threadError
  }

  const threadAuthorName = threadData?.author_name?.trim()
  return threadAuthorName || FORUM_USER_AUTHOR_NAME
}

export const fetchForumThreads = async (): Promise<ForumThread[]> => {
  if (!supabase) {
    return []
  }
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase
    .from('forum_threads')
    .select('id,user_id,title,body,author_type,author_slot,author_name,created_at,updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapForumThreadRow(row as ForumThreadRow))
}

export const fetchForumThreadById = async (threadId: string): Promise<ForumThread | null> => {
  if (!supabase) {
    return null
  }
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase
    .from('forum_threads')
    .select('id,user_id,title,body,author_type,author_slot,author_name,created_at,updated_at')
    .eq('id', threadId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw error
  }
  return data ? mapForumThreadRow(data as ForumThreadRow) : null
}

export const fetchForumReplyCountMap = async (threadIds: string[]): Promise<Record<string, number>> => {
  if (!supabase || threadIds.length === 0) {
    return {}
  }
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase
    .from('forum_replies')
    .select('thread_id')
    .eq('user_id', userId)
    .in('thread_id', threadIds)

  if (error) {
    throw error
  }

  return (data ?? []).reduce<Record<string, number>>((acc, row) => {
    const threadId = String((row as { thread_id: string }).thread_id)
    acc[threadId] = (acc[threadId] ?? 0) + 1
    return acc
  }, {})
}

export const createForumThread = async (params: {
  title: string
  content: string
  authorType: ForumAuthorType
  authorSlot?: number | null
  authorName?: string
}): Promise<ForumThread> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const now = new Date().toISOString()
  const authorPayload = await resolveForumAuthorPayload(userId, params.authorType, params.authorSlot, params.authorName)
  const { data, error } = await supabase
    .from('forum_threads')
    .insert({
      user_id: userId,
      title: params.title,
      body: params.content,
      author_type: params.authorType,
      author_slot: authorPayload.authorSlot,
      author_name: authorPayload.authorName,
      created_at: now,
      updated_at: now,
    })
    .select('id,user_id,title,body,author_type,author_slot,author_name,created_at,updated_at')
    .single()

  if (error || !data) {
    throw error ?? new Error('创建论坛主题失败')
  }
  const thread = mapForumThreadRow(data as ForumThreadRow)
  return thread
}

export const fetchForumRepliesByThread = async (threadId: string): Promise<ForumReply[]> => {
  if (!supabase) {
    return []
  }
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase
    .from('forum_replies')
    .select('id,thread_id,user_id,body,author_type,author_slot,author_name,parent_id,reply_to_reply_id,reply_to_author_name,created_at')
    .eq('thread_id', threadId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapForumReplyRow(row as ForumReplyRow))
}

export const fetchForumReplyTreeByThread = async (threadId: string): Promise<ForumReply[]> => {
  if (!supabase) {
    return []
  }
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase.rpc('get_forum_thread_replies_tree', { p_thread_id: threadId })

  if (error) {
    throw error
  }

  const rows = (data ?? []) as ForumReplyRow[]
  return rows.filter((row) => row.user_id === userId).map((row) => mapForumReplyRow(row))
}

export const createForumReply = async (params: {
  threadId: string
  content: string
  authorType: ForumAuthorType
  authorSlot?: number | null
  parentId?: string | null
  replyToType?: 'thread' | 'reply' | null
  replyToReplyId?: string | null
}): Promise<ForumReply> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const normalizedParentId = params.replyToType === 'thread'
    ? null
    : params.parentId ?? params.replyToReplyId ?? null
  const authorPayload = await resolveForumAuthorPayload(userId, params.authorType, params.authorSlot)
  const replyToAuthorName = await resolveReplyTargetAuthorName(userId, params.threadId, normalizedParentId)
  const { data, error } = await supabase
    .from('forum_replies')
    .insert({
      thread_id: params.threadId,
      user_id: userId,
      body: params.content,
      author_type: params.authorType,
      author_slot: authorPayload.authorSlot,
      author_name: authorPayload.authorName,
      parent_id: normalizedParentId,
      reply_to_reply_id: normalizedParentId,
      reply_to_author_name: replyToAuthorName,
    })
    .select('id,thread_id,user_id,body,author_type,author_slot,author_name,parent_id,reply_to_reply_id,reply_to_author_name,created_at')
    .single()

  if (error || !data) {
    throw error ?? new Error('创建论坛回复失败')
  }
  const reply = mapForumReplyRow(data as ForumReplyRow)
  return reply
}

export const deleteForumThread = async (threadId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const { error } = await supabase.from('forum_threads').delete().eq('id', threadId).eq('user_id', userId)

  if (error) {
    throw error
  }
}

export const deleteForumReply = async (replyId: string, threadId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const { error } = await supabase
    .from('forum_replies')
    .delete()
    .eq('id', replyId)
    .eq('thread_id', threadId)
    .eq('user_id', userId)

  if (error) {
    throw error
  }
}

export const fetchForumAiProfiles = async (): Promise<ForumAiProfile[]> => {
  if (!supabase) {
    return []
  }
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase
    .from('forum_ai_profiles')
    .select('id,user_id,slot_index,enabled,name,system_prompt,model,temperature,top_p,api_base_url,context_token_limit,created_at,updated_at')
    .eq('user_id', userId)
    .in('slot_index', [1, 2, 3])
    .order('slot_index', { ascending: true })

  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapForumAiProfileRow(row as ForumAiProfileRow))
}

export const upsertForumAiProfile = async (
  slotIndex: number,
  payload: {
    enabled: boolean
    displayName: string
    systemPrompt: string
    model: string
    temperature: number
    topP: number
    contextTokenLimit: number
    apiBaseUrl: string
  },
): Promise<ForumAiProfile> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('forum_ai_profiles')
    .upsert(
      {
        user_id: userId,
        slot_index: slotIndex,
        enabled: payload.enabled,
        name: payload.displayName,
        system_prompt: payload.systemPrompt,
        model: payload.model,
        temperature: payload.temperature,
        top_p: payload.topP,
        context_token_limit: normalizeForumContextTokenLimit(payload.contextTokenLimit),
        api_base_url: payload.apiBaseUrl,
        updated_at: now,
      },
      { onConflict: 'user_id,slot_index' },
    )
    .select('id,user_id,slot_index,enabled,name,system_prompt,model,temperature,top_p,api_base_url,context_token_limit,created_at,updated_at')
    .single()

  if (error || !data) {
    throw error ?? new Error('保存论坛 AI 档案失败')
  }

  return mapForumAiProfileRow(data as ForumAiProfileRow)
}

export const fetchAllMemoryEntries = async (): Promise<MemoryEntry[]> => {
  if (!supabase) {
    return []
  }
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase
    .from('memory_entries')
    .select('id,user_id,content,source,status,created_at,updated_at,is_deleted')
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true })
  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapMemoryEntryRow(row as MemoryEntryRow))
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

export const listMemoTags = async (): Promise<MemoTag[]> => {
  if (!supabase) {
    return []
  }
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase
    .from('memo_tags')
    .select('id,user_id,name,created_at')
    .eq('user_id', userId)
    .order('name', { ascending: true })
  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapMemoTagRow(row as MemoTagRow))
}

export const createMemoTag = async (name: string): Promise<MemoTag> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('标签名不能为空')
  }
  const { data: existing, error: findError } = await supabase
    .from('memo_tags')
    .select('id,user_id,name,created_at')
    .eq('user_id', userId)
    .eq('name', trimmed)
    .maybeSingle()
  if (findError) {
    throw findError
  }
  if (existing) {
    return mapMemoTagRow(existing as MemoTagRow)
  }
  const { data, error } = await supabase
    .from('memo_tags')
    .insert({ user_id: userId, name: trimmed })
    .select('id,user_id,name,created_at')
    .single()
  if (error || !data) {
    throw error ?? new Error('创建标签失败')
  }
  return mapMemoTagRow(data as MemoTagRow)
}

export const listMemoEntries = async (): Promise<MemoEntry[]> => {
  if (!supabase) {
    return []
  }
  const userId = await requireAuthenticatedUserId()
  const { data: entryRows, error: entryError } = await supabase
    .from('memo_entries')
    .select('id,user_id,content,source,is_pinned,created_at,updated_at,is_deleted')
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false })
  if (entryError) {
    throw entryError
  }
  const entries = (entryRows ?? []) as MemoEntryRow[]
  if (entries.length === 0) {
    return []
  }
  const entryIds = entries.map((entry) => entry.id)
  const { data: relationRows, error: relationError } = await supabase
    .from('memo_entry_tags')
    .select('memo_entry_id,memo_tag_id')
    .in('memo_entry_id', entryIds)
  if (relationError) {
    throw relationError
  }

  const tagIdsByEntryId = new Map<string, string[]>()
  ;((relationRows ?? []) as MemoEntryTagRow[]).forEach((relation) => {
    const current = tagIdsByEntryId.get(relation.memo_entry_id) ?? []
    current.push(relation.memo_tag_id)
    tagIdsByEntryId.set(relation.memo_entry_id, current)
  })
  return entries.map((entry) => mapMemoEntryRow(entry, tagIdsByEntryId.get(entry.id) ?? []))
}

export const createMemoEntry = async (payload: {
  content: string
  isPinned: boolean
  source?: MemoSource
  tagIds: string[]
}): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const now = new Date().toISOString()
  const { data: entry, error: entryError } = await supabase
    .from('memo_entries')
    .insert({
      user_id: userId,
      content: payload.content,
      source: payload.source ?? 'user',
      is_pinned: payload.isPinned,
      is_deleted: false,
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single()
  if (entryError || !entry) {
    throw entryError ?? new Error('创建备忘录失败')
  }
  const uniqueTagIds = Array.from(new Set(payload.tagIds))
  if (uniqueTagIds.length === 0) {
    return
  }
  const { error: linkError } = await supabase.from('memo_entry_tags').insert(
    uniqueTagIds.map((tagId) => ({
      memo_entry_id: entry.id,
      memo_tag_id: tagId,
    })),
  )
  if (linkError) {
    throw linkError
  }
}

export const updateMemoEntry = async (
  entryId: string,
  payload: { content: string; isPinned: boolean; tagIds: string[] },
): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const now = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('memo_entries')
    .update({
      content: payload.content,
      is_pinned: payload.isPinned,
      updated_at: now,
    })
    .eq('id', entryId)
    .eq('is_deleted', false)
  if (updateError) {
    throw updateError
  }

  const { error: deleteLinksError } = await supabase
    .from('memo_entry_tags')
    .delete()
    .eq('memo_entry_id', entryId)
  if (deleteLinksError) {
    throw deleteLinksError
  }

  const uniqueTagIds = Array.from(new Set(payload.tagIds))
  if (uniqueTagIds.length === 0) {
    return
  }
  const { error: linkError } = await supabase.from('memo_entry_tags').insert(
    uniqueTagIds.map((tagId) => ({
      memo_entry_id: entryId,
      memo_tag_id: tagId,
    })),
  )
  if (linkError) {
    throw linkError
  }
}

export const softDeleteMemoEntry = async (entryId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { error } = await supabase
    .from('memo_entries')
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq('id', entryId)
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


// --- Bubble Chat ---

type BubbleSessionRow = {
  id: string
  user_id: string
  session_date: string
  created_at: string
  updated_at: string
}

type BubbleMessageRow = {
  id: string
  session_id: string
  user_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

const mapBubbleSessionRow = (row: BubbleSessionRow): BubbleSession => ({
  id: row.id,
  userId: row.user_id,
  sessionDate: row.session_date,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const mapBubbleMessageRow = (row: BubbleMessageRow): BubbleMessage => ({
  id: row.id,
  sessionId: row.session_id,
  userId: row.user_id,
  role: row.role,
  content: row.content,
  createdAt: row.created_at,
})

export const resolveOrCreateBubbleSession = async (dateStr: string): Promise<BubbleSession> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()

  const { data: existing, error: fetchError } = await supabase
    .from('bubble_sessions')
    .select('id,user_id,session_date,created_at,updated_at')
    .eq('user_id', userId)
    .eq('session_date', dateStr)
    .maybeSingle()

  if (fetchError) {
    throw fetchError
  }

  if (existing) {
    return mapBubbleSessionRow(existing as BubbleSessionRow)
  }

  const now = new Date().toISOString()
  const { data: created, error: insertError } = await supabase
    .from('bubble_sessions')
    .insert({
      user_id: userId,
      session_date: dateStr,
      created_at: now,
      updated_at: now,
    })
    .select('id,user_id,session_date,created_at,updated_at')
    .single()

  if (insertError) {
    if (insertError.code === '23505') {
      const { data: retry, error: retryError } = await supabase
        .from('bubble_sessions')
        .select('id,user_id,session_date,created_at,updated_at')
        .eq('user_id', userId)
        .eq('session_date', dateStr)
        .single()
      if (retryError || !retry) {
        throw retryError ?? new Error('获取气泡聊天会话失败')
      }
      return mapBubbleSessionRow(retry as BubbleSessionRow)
    }
    throw insertError
  }

  if (!created) {
    throw new Error('创建气泡聊天会话失败')
  }
  return mapBubbleSessionRow(created as BubbleSessionRow)
}

export const createBubbleMessage = async (
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<BubbleMessage> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const userId = await requireAuthenticatedUserId()
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('bubble_messages')
    .insert({
      session_id: sessionId,
      user_id: userId,
      role,
      content,
      created_at: now,
    })
    .select('id,session_id,user_id,role,content,created_at')
    .single()

  if (error || !data) {
    throw error ?? new Error('保存气泡聊天消息失败')
  }

  await supabase
    .from('bubble_sessions')
    .update({ updated_at: now })
    .eq('id', sessionId)
    .eq('user_id', userId)

  const message = mapBubbleMessageRow(data as BubbleMessageRow)
  return message
}

export const fetchAllBubbleSessions = async (): Promise<BubbleSession[]> => {
  if (!supabase) {
    return []
  }
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase
    .from('bubble_sessions')
    .select('id,user_id,session_date,created_at,updated_at')
    .eq('user_id', userId)
    .order('session_date', { ascending: false })

  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapBubbleSessionRow(row as BubbleSessionRow))
}

export const fetchBubbleMessages = async (sessionId: string): Promise<BubbleMessage[]> => {
  if (!supabase) {
    return []
  }
  const userId = await requireAuthenticatedUserId()
  const { data, error } = await supabase
    .from('bubble_messages')
    .select('id,session_id,user_id,role,content,created_at')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }
  return (data ?? []).map((row) => mapBubbleMessageRow(row as BubbleMessageRow))
}

// ── Story Groups ──────────────────────────────────────────────────────

type StoryGroupRow = {
  id: string
  user_id: string
  name: string
  created_at: string
  updated_at: string | null
}

type SessionGroupRow = {
  id: string
  session_id: string
  story_group_id: string
  created_at: string
}

const mapStoryGroupRow = (row: StoryGroupRow): RpStoryGroup => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const mapSessionGroupRow = (row: SessionGroupRow): RpSessionGroup => ({
  id: row.id,
  sessionId: row.session_id,
  storyGroupId: row.story_group_id,
  createdAt: row.created_at,
})

export const fetchStoryGroups = async (userId: string): Promise<RpStoryGroup[]> => {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('rp_story_groups')
    .select('id,user_id,name,created_at,updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => mapStoryGroupRow(row as StoryGroupRow))
}

export const createStoryGroup = async (userId: string, name: string): Promise<RpStoryGroup> => {
  if (!supabase) throw new Error('Supabase 客户端未配置')
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('rp_story_groups')
    .insert({ user_id: userId, name, created_at: now })
    .select('id,user_id,name,created_at,updated_at')
    .single()
  if (error || !data) throw error ?? new Error('创建故事组失败')
  return mapStoryGroupRow(data as StoryGroupRow)
}

export const renameStoryGroup = async (groupId: string, name: string): Promise<void> => {
  if (!supabase) return
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('rp_story_groups')
    .update({ name, updated_at: now })
    .eq('id', groupId)
  if (error) throw error
}

export const deleteStoryGroup = async (groupId: string): Promise<void> => {
  if (!supabase) return
  const { error } = await supabase
    .from('rp_story_groups')
    .delete()
    .eq('id', groupId)
  if (error) throw error
}

export const fetchSessionGroups = async (_userId: string): Promise<RpSessionGroup[]> => {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('rp_session_groups')
    .select('id,session_id,story_group_id,created_at')
  if (error) throw error
  return (data ?? []).map((row) => mapSessionGroupRow(row as SessionGroupRow))
}

export const addSessionToGroup = async (sessionId: string, storyGroupId: string): Promise<RpSessionGroup> => {
  if (!supabase) throw new Error('Supabase 客户端未配置')
  const { data, error } = await supabase
    .from('rp_session_groups')
    .upsert(
      { session_id: sessionId, story_group_id: storyGroupId, created_at: new Date().toISOString() },
      { onConflict: 'session_id' },
    )
    .select('id,session_id,story_group_id,created_at')
    .single()
  if (error || !data) throw error ?? new Error('添加 session 到故事组失败')
  return mapSessionGroupRow(data as SessionGroupRow)
}

export const removeSessionFromGroup = async (sessionId: string): Promise<void> => {
  if (!supabase) return
  const { error } = await supabase
    .from('rp_session_groups')
    .delete()
    .eq('session_id', sessionId)
  if (error) throw error
}
