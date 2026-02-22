import { useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { ensureUserSettings } from '../storage/userSettings'
import { supabase } from '../supabase/client'

type OpenRouterModel = {
  id: string
  name?: string
}

export type EnabledModelOption = {
  id: string
  label: string
}

export const useEnabledModels = (user: User | null) => {
  const [enabledModelIds, setEnabledModelIds] = useState<string[]>([])
  const [catalog, setCatalog] = useState<OpenRouterModel[]>([])

  useEffect(() => {
    let active = true
    if (!user) {
      return () => {
        active = false
      }
    }

    ensureUserSettings(user.id).then((settings) => {
      if (!active) {
        return
      }
      setEnabledModelIds(settings.enabledModels)
    })

    return () => {
      active = false
    }
  }, [user])

  useEffect(() => {
    let active = true
    if (!user || !supabase) {
      return () => {
        active = false
      }
    }

    supabase.functions
      .invoke<{ data?: OpenRouterModel[] }>('openrouter-models', { body: {} })
      .then(({ data }) => {
        if (!active) {
          return
        }
        const models = Array.isArray(data?.data) ? data.data : []
        setCatalog(models)
      })
      .catch(() => {
        if (!active) {
          return
        }
        setCatalog([])
      })

    return () => {
      active = false
    }
  }, [user])

  const catalogMap = useMemo(() => {
    return new Map(catalog.map((model) => [model.id, model.name ?? model.id]))
  }, [catalog])

  const safeEnabledIds = useMemo(() => (user ? enabledModelIds : []), [enabledModelIds, user])

  const enabledModelOptions = useMemo<EnabledModelOption[]>(() => {
    return safeEnabledIds.map((id) => ({
      id,
      label: catalogMap.get(id) ?? id,
    }))
  }, [catalogMap, safeEnabledIds])

  return {
    enabledModelIds: safeEnabledIds,
    enabledModelOptions,
  }
}
