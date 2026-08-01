type ContextAwarePayload = {
  module?: string
  extra?: Record<string, unknown>
}

type CanonicalContextContract = {
  version: 1
  managed_by: 'conversation-dispatch'
  external_sources: string[]
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

export const readCanonicalContextContract = (
  payload: ContextAwarePayload,
): CanonicalContextContract | null => {
  const contract = asRecord(payload.extra?.canonical_context)
  if (
    contract?.version !== 1 ||
    contract.managed_by !== 'conversation-dispatch' ||
    !Array.isArray(contract.external_sources) ||
    contract.external_sources.some((source) => typeof source !== 'string')
  ) {
    return null
  }
  return {
    version: 1,
    managed_by: 'conversation-dispatch',
    external_sources: contract.external_sources,
  }
}

export const shouldInjectChitchatMemory = (payload: ContextAwarePayload) => {
  const contract = readCanonicalContextContract(payload)
  if (contract) {
    return contract.external_sources.includes('memory_entries')
  }
  return !payload.module || payload.module === 'chitchat'
}

export const resolveCompressionModule = (
  payload: ContextAwarePayload,
): 'chat' | 'rp' | null => {
  if (readCanonicalContextContract(payload)) {
    return null
  }
  if (!payload.module || payload.module === 'chitchat') {
    return 'chat'
  }
  if (payload.module === 'rp-room') {
    return 'rp'
  }
  return null
}
