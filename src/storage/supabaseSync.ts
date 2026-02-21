import type {
  ChatMessage,
  ChatSession,
  MemoryEntry,
  MemoryStatus,
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
    .update({ is_deleted: false })
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
    .update({ is_deleted: true })
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
    .update({ is_deleted: true })
    .eq('id', replyId)

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
