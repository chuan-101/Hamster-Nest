export type ConversationContextRecipe = {
  version: number
  history_scope: 'current_session'
  epoch: 'asia_shanghai_day' | 'session'
  selection: 'newest_within_token_budget'
  external_sources: string[]
}

export type ContextMessageRow = {
  id: string
  role: 'user' | 'assistant'
  content: string
  meta: Record<string, unknown> | null
  created_at: string
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const DEFAULT_CONTEXT_LIMIT = 32_000
const DEFAULT_TRIGGER_RATIO = 0.65
const MAX_TRIGGER_RATIO = 0.9
const MIN_TRIGGER_RATIO = 0.2
const CONTEXT_SAFETY_TOKENS = 1_024
const TOKEN_OVERHEAD_PER_MESSAGE = 8

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

export const parseConversationContextRecipe = (
  value: unknown,
): ConversationContextRecipe => {
  const recipe = asRecord(value)
  const externalSources = recipe?.external_sources
  if (
    typeof recipe?.version !== 'number' ||
    !Number.isInteger(recipe.version) ||
    recipe.version < 1 ||
    recipe.history_scope !== 'current_session' ||
    (recipe.epoch !== 'asia_shanghai_day' && recipe.epoch !== 'session') ||
    recipe.selection !== 'newest_within_token_budget' ||
    !Array.isArray(externalSources) ||
    externalSources.some(
      (source) => typeof source !== 'string' || !source.trim(),
    )
  ) {
    throw new Error(
      'active conversation profile has an invalid context recipe',
    )
  }

  return {
    version: recipe.version,
    history_scope: 'current_session',
    epoch: recipe.epoch,
    selection: 'newest_within_token_budget',
    external_sources: externalSources.map((source) => source.trim()),
  }
}

export const startOfShanghaiDayIso = (value: string | Date): string => {
  const instant = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(instant.getTime())) {
    throw new Error('canonical user message has an invalid created_at')
  }
  const shifted = new Date(instant.getTime() + SHANGHAI_OFFSET_MS)
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    ) - SHANGHAI_OFFSET_MS,
  ).toISOString()
}

export const estimateTextTokens = (content: string): number => {
  const trimmed = content.trim()
  if (!trimmed) {
    return TOKEN_OVERHEAD_PER_MESSAGE
  }
  const chineseChars = (trimmed.match(/[\u4e00-\u9fff]/g) ?? []).length
  const englishWords = (trimmed.match(/[A-Za-z0-9_]+/g) ?? []).length
  const otherChars = Math.max(trimmed.length - chineseChars, 0)
  return Math.ceil(
    chineseChars * 1.7 +
      englishWords * 1.1 +
      otherChars * 0.3 +
      TOKEN_OVERHEAD_PER_MESSAGE,
  )
}

export const resolveHistoryTokenBudget = ({
  systemPrompt,
  maxOutputTokens,
  triggerRatio,
}: {
  systemPrompt: string
  maxOutputTokens: number
  triggerRatio: number | null
}): number => {
  const normalizedRatio = typeof triggerRatio === 'number' && Number.isFinite(triggerRatio)
    ? Math.min(Math.max(triggerRatio, MIN_TRIGGER_RATIO), MAX_TRIGGER_RATIO)
    : DEFAULT_TRIGGER_RATIO
  const targetTokens = Math.floor(DEFAULT_CONTEXT_LIMIT * normalizedRatio)
  const reservedTokens = estimateTextTokens(systemPrompt) +
    Math.max(0, Math.floor(maxOutputTokens)) +
    CONTEXT_SAFETY_TOKENS
  return Math.max(0, targetTokens - reservedTokens)
}

const isEligibleContextMessage = (
  message: ContextMessageRow,
  excludedMessageIds: Set<string>,
) => {
  if (excludedMessageIds.has(message.id)) {
    return false
  }
  if (message.role !== 'assistant') {
    return true
  }
  const state = typeof message.meta?.delivery_state === 'string'
    ? message.meta.delivery_state
    : null
  return state !== 'generating' && state !== 'failed'
}

export const selectNewestContextWindow = ({
  newestFirst,
  tokenBudget,
  requiredMessageId,
  excludedMessageIds = [],
}: {
  newestFirst: ContextMessageRow[]
  tokenBudget: number
  requiredMessageId: string
  excludedMessageIds?: string[]
}) => {
  const excluded = new Set(excludedMessageIds)
  const selected: ContextMessageRow[] = []
  let usedTokens = 0
  let reachedBudget = false

  for (const message of newestFirst) {
    if (!isEligibleContextMessage(message, excluded)) {
      continue
    }
    const messageTokens = estimateTextTokens(message.content)
    const required = message.id === requiredMessageId
    if (!required && usedTokens + messageTokens > tokenBudget) {
      reachedBudget = true
      break
    }
    selected.push(message)
    usedTokens += messageTokens
  }

  return {
    newestFirst: selected,
    usedTokens,
    reachedBudget,
    containsRequiredMessage: selected.some(
      (message) => message.id === requiredMessageId,
    ),
  }
}
