import type { UserSettings } from '../types'
import { supabase } from '../supabase/client'

type UserSettingsRow = {
  user_id: string
  enabled_models: string[] | null
  default_model: string | null
  temperature: number | null
  top_p: number | null
  max_tokens: number | null
  system_prompt: string | null
  enable_reasoning: boolean | null
  updated_at: string
}

const defaultModel = 'openrouter/auto'

export const createDefaultSettings = (userId: string): UserSettings => ({
  userId,
  enabledModels: [defaultModel],
  defaultModel,
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 1024,
  systemPrompt: '',
  enableReasoning: false,
  updatedAt: new Date().toISOString(),
})

const mapSettingsRow = (row: UserSettingsRow): UserSettings => ({
  userId: row.user_id,
  enabledModels: row.enabled_models ?? [defaultModel],
  defaultModel: row.default_model ?? defaultModel,
  temperature: row.temperature ?? 0.7,
  topP: row.top_p ?? 0.9,
  maxTokens: row.max_tokens ?? 1024,
  systemPrompt: row.system_prompt ?? '',
  enableReasoning: row.enable_reasoning ?? false,
  updatedAt: row.updated_at,
})

export const ensureUserSettings = async (userId: string): Promise<UserSettings> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { data, error } = await supabase
    .from('user_settings')
    .select(
      'user_id,enabled_models,default_model,temperature,top_p,max_tokens,system_prompt,enable_reasoning,updated_at',
    )
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    throw error
  }
  if (!data) {
    const defaults = createDefaultSettings(userId)
    const now = defaults.updatedAt
    const { data: inserted, error: insertError } = await supabase
      .from('user_settings')
      .insert({
        user_id: defaults.userId,
        enabled_models: defaults.enabledModels,
        default_model: defaults.defaultModel,
        temperature: defaults.temperature,
        top_p: defaults.topP,
        max_tokens: defaults.maxTokens,
        system_prompt: defaults.systemPrompt,
        enable_reasoning: defaults.enableReasoning,
        updated_at: now,
      })
      .select(
        'user_id,enabled_models,default_model,temperature,top_p,max_tokens,system_prompt,enable_reasoning,updated_at',
      )
      .single()
    if (insertError || !inserted) {
      throw insertError ?? new Error('初始化设置失败')
    }
    return mapSettingsRow(inserted as UserSettingsRow)
  }
  return mapSettingsRow(data as UserSettingsRow)
}

export const updateUserSettings = async (settings: UserSettings): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('user_settings')
    .update({
      enabled_models: settings.enabledModels,
      default_model: settings.defaultModel,
      temperature: settings.temperature,
      top_p: settings.topP,
      max_tokens: settings.maxTokens,
      system_prompt: settings.systemPrompt,
      enable_reasoning: settings.enableReasoning,
      updated_at: now,
    })
    .eq('user_id', settings.userId)
  if (error) {
    throw error
  }
}
