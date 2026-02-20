import type { ExtractMessageInput } from '../types'
import { supabase } from '../supabase/client'

type ExtractMemoriesResult = {
  insertedCount: number
  skippedCount: number
}

type InvokeResponse = {
  insertedCount?: unknown
  skippedCount?: unknown
}

export const invokeMemoryExtraction = async (
  recentMessages: ExtractMessageInput[],
  timezone?: string,
): Promise<ExtractMemoriesResult> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const sanitized = recentMessages
    .map((message) => ({ role: message.role, content: message.content.trim() }))
    .filter((message) => message.content.length > 0)
  if (sanitized.length === 0) {
    return { insertedCount: 0, skippedCount: 0 }
  }
  const { data, error } = await supabase.functions.invoke('memory-extract', {
    body: {
      recentMessages: sanitized,
      timezone,
    },
  })
  if (error) {
    throw error
  }
  const payload = (data ?? {}) as InvokeResponse
  return {
    insertedCount: Number(payload.insertedCount ?? 0),
    skippedCount: Number(payload.skippedCount ?? 0),
  }
}
