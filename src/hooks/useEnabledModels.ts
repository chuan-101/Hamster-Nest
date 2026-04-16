import { useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { fetchEnabledModelsWithProviders, fetchLlmProviders } from '../storage/llmProviders'

export type EnabledModelOption = {
  id: string
  label: string
}

export const useEnabledModels = (user: User | null) => {
  const [enabledModelIds, setEnabledModelIds] = useState<string[]>([])
  const [enabledModelOptions, setEnabledModelOptions] = useState<EnabledModelOption[]>([])
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!user) {
      return () => {
        active = false
      }
    }

    const load = async () => {
      try {
        const providers = await fetchLlmProviders(user.id)
        const activeProvider = providers.find((item) => item.active) ?? providers[0] ?? null
        if (!activeProvider) {
          if (!active) return
          setEnabledModelIds([])
          setEnabledModelOptions([])
          setDefaultModelId(null)
          return
        }

        const rows = await fetchEnabledModelsWithProviders(user.id)
        const scoped = rows.filter((item) => item.providerId === activeProvider.id)
        const ids = scoped.map((item) => item.modelId)
        const options = scoped.map((item) => ({
          id: item.modelId,
          label: `${item.displayName || item.modelId} (via ${item.providerDisplayName})`,
        }))
        const defaultRow = scoped.find((item) => item.isDefault) ?? scoped[0] ?? null
        if (!active) {
          return
        }
        setEnabledModelIds(ids)
        setEnabledModelOptions(options)
        setDefaultModelId(defaultRow?.modelId ?? null)
      } catch {
        if (!active) {
          return
        }
        setEnabledModelIds([])
        setEnabledModelOptions([])
        setDefaultModelId(null)
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [user])

  const safeEnabledIds = useMemo(() => (user ? enabledModelIds : []), [enabledModelIds, user])
  const safeEnabledOptions = useMemo(() => (user ? enabledModelOptions : []), [enabledModelOptions, user])
  const safeDefaultModelId = user ? defaultModelId : null

  return {
    enabledModelIds: safeEnabledIds,
    enabledModelOptions: safeEnabledOptions,
    defaultModelId: safeDefaultModelId,
  }
}
