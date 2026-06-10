import { supabase } from '../supabase/client'
import type { LoungeMember, LoungeMessage, LoungeSofa } from '../types'

type LoungeSofaRow = {
  id: string
  name: string
  created_at: string
  updated_at: string
}

type LoungeMessageRow = {
  id: string
  sofa_id: string
  sender: string
  content: string
  mentions: string[] | null
  meta: Record<string, unknown> | null
  created_at: string
}

type LoungeMemberRow = {
  sender: string
  display_name: string
  emoji: string
  color: string
}

const requireClient = () => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  return supabase
}

const mapSofa = (row: LoungeSofaRow): LoungeSofa => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const mapLoungeMessageRow = (row: LoungeMessageRow): LoungeMessage => ({
  id: row.id,
  sofaId: row.sofa_id,
  sender: row.sender,
  content: row.content,
  mentions: row.mentions ?? [],
  meta: row.meta ?? {},
  createdAt: row.created_at,
})

const mapMember = (row: LoungeMemberRow): LoungeMember => ({
  sender: row.sender,
  displayName: row.display_name,
  emoji: row.emoji,
  color: row.color,
})

export const fetchLoungeSofas = async (): Promise<LoungeSofa[]> => {
  const client = requireClient()
  const { data, error } = await client
    .from('lounge_sofas')
    .select('id,name,created_at,updated_at')
    .order('updated_at', { ascending: false })
  if (error) {
    throw error
  }
  return ((data ?? []) as LoungeSofaRow[]).map(mapSofa)
}

export const fetchLoungeSofa = async (sofaId: string): Promise<LoungeSofa | null> => {
  const client = requireClient()
  const { data, error } = await client
    .from('lounge_sofas')
    .select('id,name,created_at,updated_at')
    .eq('id', sofaId)
    .maybeSingle()
  if (error) {
    throw error
  }
  return data ? mapSofa(data as LoungeSofaRow) : null
}

export const createLoungeSofa = async (name: string): Promise<LoungeSofa> => {
  const client = requireClient()
  const { data, error } = await client
    .from('lounge_sofas')
    .insert({ name })
    .select('id,name,created_at,updated_at')
    .single()
  if (error || !data) {
    throw error ?? new Error('创建沙发失败')
  }
  return mapSofa(data as LoungeSofaRow)
}

export const renameLoungeSofa = async (sofaId: string, name: string): Promise<LoungeSofa> => {
  const client = requireClient()
  const { data, error } = await client
    .from('lounge_sofas')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', sofaId)
    .select('id,name,created_at,updated_at')
    .single()
  if (error || !data) {
    throw error ?? new Error('重命名沙发失败')
  }
  return mapSofa(data as LoungeSofaRow)
}

export const deleteLoungeSofa = async (sofaId: string): Promise<void> => {
  const client = requireClient()
  const { error } = await client.from('lounge_sofas').delete().eq('id', sofaId)
  if (error) {
    throw error
  }
}

export const fetchLoungeMessages = async (sofaId: string): Promise<LoungeMessage[]> => {
  const client = requireClient()
  const { data, error } = await client
    .from('lounge_messages')
    .select('id,sofa_id,sender,content,mentions,meta,created_at')
    .eq('sofa_id', sofaId)
    .order('created_at', { ascending: true })
  if (error) {
    throw error
  }
  return ((data ?? []) as LoungeMessageRow[]).map(mapLoungeMessageRow)
}

export const fetchLoungeMessageCounts = async (
  sofaIds: string[],
): Promise<Record<string, number>> => {
  if (sofaIds.length === 0) {
    return {}
  }
  const client = requireClient()
  const { data, error } = await client
    .from('lounge_messages')
    .select('sofa_id')
    .in('sofa_id', sofaIds)
  if (error) {
    throw error
  }
  return ((data ?? []) as Array<{ sofa_id: string }>).reduce<Record<string, number>>(
    (accumulator, row) => {
      accumulator[row.sofa_id] = (accumulator[row.sofa_id] ?? 0) + 1
      return accumulator
    },
    {},
  )
}

export const addLoungeMessage = async (
  sofaId: string,
  sender: string,
  content: string,
  mentions: string[],
  meta: Record<string, unknown> = {},
): Promise<LoungeMessage> => {
  const client = requireClient()
  const { data, error } = await client
    .from('lounge_messages')
    .insert({ sofa_id: sofaId, sender, content, mentions, meta })
    .select('id,sofa_id,sender,content,mentions,meta,created_at')
    .single()
  if (error || !data) {
    throw error ?? new Error('发送消息失败')
  }
  // 沙发列表按 updated_at 排序：发消息后把沙发顶到最前。
  const { error: touchError } = await client
    .from('lounge_sofas')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sofaId)
  if (touchError) {
    console.warn('更新沙发时间戳失败', touchError)
  }
  return mapLoungeMessageRow(data as LoungeMessageRow)
}

export const fetchLoungeMembers = async (): Promise<LoungeMember[]> => {
  const client = requireClient()
  const { data, error } = await client
    .from('lounge_members')
    .select('sender,display_name,emoji,color')
    .order('sender', { ascending: true })
  if (error) {
    throw error
  }
  return ((data ?? []) as LoungeMemberRow[]).map(mapMember)
}
