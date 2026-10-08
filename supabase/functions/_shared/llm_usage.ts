// Server-side twin of src/utils/llmUsage.ts: writes one row per model call into
// public.llm_usage. Replies generated inside Edge Functions (App conversation,
// lounge API seat) never pass through the browser logger, so they record here.

export type LlmUsageContext = {
  module: string
  conversationId?: string | null
  model?: string | null
}

type InsertClient = {
  from(table: string): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const toInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null

const toNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

export const buildLlmUsageRow = (
  context: LlmUsageContext,
  usageValue: unknown,
): Record<string, unknown> | null => {
  const usage = asRecord(usageValue)
  if (!usage) return null
  const promptDetails = asRecord(usage.prompt_tokens_details)
  // OpenRouter names (cached_tokens / cache_write_tokens) first, then Anthropic-native.
  const cachedTokens = toInteger(promptDetails?.cached_tokens)
    ?? toInteger(usage.cached_tokens)
    ?? toInteger(usage.cache_read_input_tokens)
  const cacheWriteTokens = toInteger(promptDetails?.cache_write_tokens)
    ?? toInteger(usage.cache_write_tokens)
    ?? toInteger(usage.cache_creation_input_tokens)
  return {
    module: context.module,
    conversation_id: context.conversationId ?? null,
    model: context.model ?? null,
    prompt_tokens: toInteger(usage.prompt_tokens),
    completion_tokens: toInteger(usage.completion_tokens),
    total_tokens: toInteger(usage.total_tokens),
    cached_tokens: cachedTokens,
    cache_write_tokens: cacheWriteTokens,
    cost_usd: toNumber(usage.cost),
    raw: usage,
  }
}

// Bookkeeping must never fail a reply: every error is logged and swallowed.
export const recordLlmUsage = async (
  client: InsertClient,
  context: LlmUsageContext,
  usage: unknown,
): Promise<void> => {
  try {
    const row = buildLlmUsageRow(context, usage)
    if (!row) return
    const { error } = await client.from('llm_usage').insert(row)
    if (error) console.error('[llm-usage] insert failed', error.message)
  } catch (error) {
    console.error('[llm-usage] insert failed', error instanceof Error ? error.message : 'unknown')
  }
}
