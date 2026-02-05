import type { ChatMessage, ChatSession, SnackPost } from '../types'
import { supabase } from '../supabase/client'

type SessionRow = {
  id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string
  override_model: string | null
  override_reasoning: boolean | null
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

const mapSnackPostRow = (row: SnackPostRow): SnackPost => ({
  id: row.id,
  userId: row.user_id,
  content: row.content,
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

export const fetchRemoteSessions = async (userId: string): Promise<ChatSession[]> => {
  if (!supabase) {
    return []
  }
  const { data, error } = await supabase
    .from('sessions')
    .select('id,user_id,title,created_at,updated_at,override_model,override_reasoning')
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
    .select('id,user_id,title,created_at,updated_at,override_model,override_reasoning')
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
    .select('id,user_id,title,created_at,updated_at,override_model,override_reasoning')
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
    .select('id,user_id,title,created_at,updated_at,override_model,override_reasoning')
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
    .select('id,user_id,title,created_at,updated_at,override_model,override_reasoning')
    .single()
  if (error || !data) {
    throw error ?? new Error('更新会话思考链失败')
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

export const createSnackPost = async (userId: string, content: string): Promise<SnackPost> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('snack_posts')
    .insert({
      user_id: userId,
      content,
      created_at: now,
      updated_at: now,
      is_deleted: false,
    })
    .select('id,user_id,content,created_at,updated_at,is_deleted')
    .single()

  if (error || !data) {
    throw error ?? new Error('发布零食记录失败')
  }
  return mapSnackPostRow(data as SnackPostRow)
}

export const softDeleteSnackPost = async (postId: string, userId: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { error } = await supabase.from('snack_posts').update({ is_deleted: true }).eq('id', postId)

  if (error) {
    throw error
  }
}
