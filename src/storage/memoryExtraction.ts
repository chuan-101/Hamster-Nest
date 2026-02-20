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

const parseInvokeErrorMessage = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return null
  }

  const maybeMessage = (error as { message?: unknown }).message
  if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
    return maybeMessage
  }

  const context = (error as { context?: unknown }).context
  if (typeof context === 'string' && context.trim()) {
    try {
      const parsed = JSON.parse(context) as { error?: unknown }
      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        return parsed.error
      }
    } catch {
      return context
    }
  }

  return null
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

  const { data, error } = await supabase.functions.invoke('memory-extract', {
    body: {
      recentMessages: sanitized,
    },
  })

  if (error) {
    throw new Error(parseInvokeErrorMessage(error) ?? '抽取建议失败')
  }

  const payload = (data ?? {}) as InvokeResponse
  return {
    inserted: Number(payload.inserted ?? 0),
    skipped: Number(payload.skipped ?? 0),
    items: Array.isArray(payload.items) ? payload.items.filter((item): item is string => typeof item === 'string') : [],
  }
}
