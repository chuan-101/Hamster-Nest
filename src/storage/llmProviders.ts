import { supabase } from '../supabase/client'

export type LlmProvider = {
  id: string
  userId: string
  name: string
  displayName: string
  baseUrl: string
  secretName: string
  active: boolean
  priority: number
}

export type EnabledModelRecord = {
  id: string
  userId: string
  providerId: string
  modelId: string
  displayName: string
  isDefault: boolean
  providerDisplayName: string
}

const mapProvider = (row: Record<string, unknown>): LlmProvider => ({
  id: String(row.id ?? ''),
  userId: String(row.user_id ?? ''),
  name: String(row.name ?? ''),
  displayName: String(row.display_name ?? row.name ?? ''),
  baseUrl: String(row.base_url ?? ''),
  secretName: String(row.secret_name ?? ''),
  active: Boolean(row.active),
  priority: Number(row.priority ?? 1000),
})

export const fetchLlmProviders = async (userId: string): Promise<LlmProvider[]> => {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('llm_providers')
    .select('id,user_id,name,display_name,base_url,secret_name,active,priority')
    .eq('user_id', userId)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => mapProvider(row as Record<string, unknown>))
}

export const createLlmProvider = async (
  userId: string,
  payload: { name: string; displayName: string; baseUrl: string; secretName: string },
): Promise<LlmProvider> => {
  if (!supabase) throw new Error('Supabase client unavailable')
  const { data, error } = await supabase
    .from('llm_providers')
    .insert({
      user_id: userId,
      name: payload.name,
      display_name: payload.displayName,
      base_url: payload.baseUrl,
      secret_name: payload.secretName,
      active: false,
      priority: 1000,
    })
    .select('id,user_id,name,display_name,base_url,secret_name,active,priority')
    .single()
  if (error) throw error
  return mapProvider(data as Record<string, unknown>)
}

export const setActiveProvider = async (userId: string, providerId: string) => {
  if (!supabase) throw new Error('Supabase client unavailable')
  const { error: disableError } = await supabase
    .from('llm_providers')
    .update({ active: false })
    .eq('user_id', userId)
  if (disableError) throw disableError

  const { error: enableError } = await supabase
    .from('llm_providers')
    .update({ active: true })
    .eq('user_id', userId)
    .eq('id', providerId)
  if (enableError) throw enableError
}

export const deleteProviderAndModels = async (userId: string, providerId: string) => {
  if (!supabase) throw new Error('Supabase client unavailable')
  const { error: modelError } = await supabase
    .from('enabled_models')
    .delete()
    .eq('user_id', userId)
    .eq('provider_id', providerId)
  if (modelError) throw modelError

  const { error: providerError } = await supabase
    .from('llm_providers')
    .delete()
    .eq('user_id', userId)
    .eq('id', providerId)
  if (providerError) throw providerError
}

export const fetchEnabledModelsWithProviders = async (userId: string): Promise<EnabledModelRecord[]> => {
  if (!supabase) return []
  const { data: providersData, error: providersError } = await supabase
    .from('llm_providers')
    .select('id,display_name')
    .eq('user_id', userId)
  if (providersError) throw providersError
  const providerMap = new Map((providersData ?? []).map((item) => [String(item.id), String(item.display_name ?? '')]))

  const { data, error } = await supabase
    .from('enabled_models')
    .select('id,user_id,provider_id,model_id,display_name,is_default')
    .eq('user_id', userId)
    .order('enabled_at', { ascending: true })
  if (error) throw error

  return (data ?? []).map((row) => ({
    id: String(row.id ?? ''),
    userId: String(row.user_id ?? ''),
    providerId: String(row.provider_id ?? ''),
    modelId: String(row.model_id ?? ''),
    displayName: String(row.display_name ?? row.model_id ?? ''),
    isDefault: Boolean(row.is_default),
    providerDisplayName: providerMap.get(String(row.provider_id ?? '')) ?? 'Unknown Provider',
  }))
}

export const fetchEnabledModelsForProvider = async (
  userId: string,
  providerId: string,
): Promise<EnabledModelRecord[]> => {
  const all = await fetchEnabledModelsWithProviders(userId)
  return all.filter((item) => item.providerId === providerId)
}

export const fetchActiveProviderModelConfig = async (userId: string): Promise<{
  providerId: string | null
  enabledModelIds: string[]
  defaultModelId: string | null
}> => {
  const providers = await fetchLlmProviders(userId)
  const activeProvider = providers.find((item) => item.active) ?? providers[0] ?? null
  if (!activeProvider) {
    return { providerId: null, enabledModelIds: [], defaultModelId: null }
  }
  const scoped = await fetchEnabledModelsForProvider(userId, activeProvider.id)
  return {
    providerId: activeProvider.id,
    enabledModelIds: scoped.map((item) => item.modelId),
    defaultModelId: scoped.find((item) => item.isDefault)?.modelId ?? scoped[0]?.modelId ?? null,
  }
}

export const enableModelForProvider = async (
  userId: string,
  providerId: string,
  modelId: string,
  displayName: string,
) => {
  if (!supabase) throw new Error('Supabase client unavailable')
  const { error } = await supabase
    .from('enabled_models')
    .upsert({
      user_id: userId,
      provider_id: providerId,
      model_id: modelId,
      display_name: displayName,
      is_default: false,
    }, { onConflict: 'user_id,provider_id,model_id' })
  if (error) throw error
}

export const disableModelForProvider = async (userId: string, providerId: string, modelId: string) => {
  if (!supabase) throw new Error('Supabase client unavailable')
  const { error } = await supabase
    .from('enabled_models')
    .delete()
    .eq('user_id', userId)
    .eq('provider_id', providerId)
    .eq('model_id', modelId)
  if (error) throw error
}

export const setDefaultModelForProvider = async (userId: string, providerId: string, modelId: string) => {
  if (!supabase) throw new Error('Supabase client unavailable')
  const { error: clearError } = await supabase
    .from('enabled_models')
    .update({ is_default: false })
    .eq('user_id', userId)
    .eq('provider_id', providerId)
  if (clearError) throw clearError

  const { error } = await supabase
    .from('enabled_models')
    .update({ is_default: true })
    .eq('user_id', userId)
    .eq('provider_id', providerId)
    .eq('model_id', modelId)
  if (error) throw error
}
