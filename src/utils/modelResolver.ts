export type ModelModule = 'chitchat' | 'snack' | 'syzygy'

type ResolveModelContext = {
  defaultModelId: string
  chitchatSelectedModelId?: string | null
}

type ResolveModelOverrides = {
  modelId?: string | null
}

const normalizeModelId = (modelId: string | null | undefined) => {
  const normalized = modelId?.trim()
  return normalized && normalized.length > 0 ? normalized : null
}

export const resolveModelId = (
  module: ModelModule,
  context: ResolveModelContext,
  overrides?: ResolveModelOverrides,
) => {
  const overrideModelId = normalizeModelId(overrides?.modelId)
  if (overrideModelId) {
    return overrideModelId
  }

  const defaultModelId = normalizeModelId(context.defaultModelId) ?? 'openrouter/auto'

  if (module === 'chitchat') {
    return normalizeModelId(context.chitchatSelectedModelId) ?? defaultModelId
  }

  return defaultModelId
}

export const isGpt5Auto = (modelId: string) => {
  const normalized = modelId.trim().toLowerCase()
  return (
    normalized.includes('gpt-5.1') ||
    normalized.includes('gpt-5.2') ||
    normalized.includes('openai/gpt-5.1') ||
    normalized.includes('openai/gpt-5.2')
  )
}
