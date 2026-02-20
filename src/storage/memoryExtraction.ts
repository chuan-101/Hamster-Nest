import type { ExtractMessageInput } from '../types'
import { supabase } from '../supabase/client'

type ExtractMemoriesResult = {
  inserted: number
  skipped: number
  items: string[]
}

type InvokeResponse = {
  inserted?: unknown
  skipped?: unknown
  items?: unknown
}

export const invokeMemoryExtraction = async (
  recentMessages: ExtractMessageInput[],
): Promise<ExtractMemoriesResult> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const sanitized = recentMessages
    .map((message) => ({ role: message.role, content: message.content.trim() }))
    .filter((message) => message.content.length > 0)
  if (sanitized.length === 0) {
    return { inserted: 0, skipped: 0, items: [] }
  }

  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!accessToken || !anonKey) {
    throw new Error('登录状态异常或环境变量未配置')
  }

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/memory-extract`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recentMessages: sanitized }),
    },
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || '抽取建议失败')
  }

  const payload = (await response.json()) as InvokeResponse
  return {
    inserted: Number(payload.inserted ?? 0),
    skipped: Number(payload.skipped ?? 0),
    items: Array.isArray(payload.items)
      ? payload.items.filter((item): item is string => typeof item === 'string')
      : [],
  }
}
