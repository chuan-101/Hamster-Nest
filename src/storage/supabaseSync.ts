import type { ChatMessage, ChatSession } from '../types'
import { supabase } from '../supabase/client'

type SessionRow = {
  id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string
}

type MessageRow = {
  id: string
  session_id: string
  user_id: string
  role: ChatMessage['role']
  content: string
  created_at: string
  meta: ChatMessage['meta'] | null
}

const mapSessionRow = (row: SessionRow): ChatSession => ({
  id: row.id,
  title: row.title,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const mapMessageRow = (row: MessageRow): ChatMessage => ({
  id: row.id,
  sessionId: row.session_id,
  role: row.role,
  content: row.content,
  createdAt: row.created_at,
  meta: row.meta ?? undefined,
})

export const fetchRemoteSessions = async (userId: string): Promise<ChatSession[]> => {
  if (!supabase) {
    return []
  }
  const { data, error } = await supabase
    .from('sessions')
    .select('id,user_id,title,created_at,updated_at')
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
    .select('id,session_id,user_id,role,content,created_at,meta')
    .eq('user_id', userId)
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
    .select('id,user_id,title,created_at,updated_at')
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
    .select('id,user_id,title,created_at,updated_at')
    .single()
  if (error || !data) {
    throw error ?? new Error('更新会话失败')
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
  meta?: ChatMessage['meta'],
): Promise<{ message: ChatMessage; updatedAt: string }> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('messages')
    .insert({
      session_id: sessionId,
      user_id: userId,
      role,
      content,
      created_at: now,
      meta: meta ?? null,
    })
    .select('id,session_id,user_id,role,content,created_at,meta')
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
