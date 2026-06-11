import { supabase } from '../supabase/client'

export type LlmUsageContext = {
  module: string | null
  conversationId?: string | null
  model?: string | null
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/**
 * 从一次 LLM 响应（非流式完整 JSON，或流式的单个 SSE chunk）中取出 usage 对象。
 * OpenRouter 在流式响应的最后一个 SSE chunk 携带 usage，非流式则在顶层。
 */
export const extractLlmUsage = (payload: unknown): Record<string, unknown> | null =>
  asRecord(asRecord(payload)?.usage)

const toInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null

const toNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/**
 * 把一轮 LLM 请求的 usage 写入 llm_usage 表。
 * fire-and-forget：任何失败只打 debug 日志，绝不抛错、绝不阻塞聊天主流程。
 */
export const logLlmUsage = (
  context: LlmUsageContext,
  usage: Record<string, unknown> | null,
): void => {
  try {
    if (!usage || !supabase) {
      return
    }
    const promptDetails = asRecord(usage.prompt_tokens_details)
    void supabase
      .from('llm_usage')
      .insert({
        module: context.module ?? null,
        conversation_id: context.conversationId ?? null,
        model: context.model ?? null,
        prompt_tokens: toInteger(usage.prompt_tokens),
        completion_tokens: toInteger(usage.completion_tokens),
        total_tokens: toInteger(usage.total_tokens),
        cached_tokens: toInteger(promptDetails?.cached_tokens) ?? toInteger(usage.cached_tokens),
        cache_write_tokens:
          toInteger(promptDetails?.cache_write_tokens) ?? toInteger(usage.cache_write_tokens),
        cost_usd: toNumber(usage.cost),
        raw: usage,
      })
      .then(
        ({ error }) => {
          if (error) {
            console.debug('[llm-usage] 写入失败（已忽略）', error.message)
          }
        },
        (insertError) => {
          console.debug('[llm-usage] 写入失败（已忽略）', insertError)
        },
      )
  } catch (error) {
    console.debug('[llm-usage] 写入失败（已忽略）', error)
  }
}
