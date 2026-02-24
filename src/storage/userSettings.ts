import type { UserSettings } from '../types'
import { supabase } from '../supabase/client'
import {
  DEFAULT_SNACK_SYSTEM_OVERLAY,
  DEFAULT_SYZYGY_POST_PROMPT,
  DEFAULT_SYZYGY_REPLY_PROMPT,
  resolveSnackSystemOverlay,
  resolveSyzygyPostPrompt,
  resolveSyzygyReplyPrompt,
} from '../constants/aiOverlays'

type UserSettingsRow = {
  user_id: string
  enabled_models: string[] | null
  default_model: string | null
  memory_extract_model: string | null
  compression_enabled: boolean | null
  compression_trigger_ratio: number | null
  compression_keep_recent_messages: number | null
  summarizer_model: string | null
  memory_merge_enabled: boolean | null
  memory_auto_extract_enabled: boolean | null
  temperature: number | null
  top_p: number | null
  max_tokens: number | null
  system_prompt: string | null
  snack_system_prompt: string | null
  syzygy_post_system_prompt: string | null
  syzygy_reply_system_prompt: string | null
  enable_reasoning: boolean | null
  chat_reasoning_enabled: boolean | null
  rp_reasoning_enabled: boolean | null
  updated_at: string
}

const defaultModel = 'openrouter/auto'

export const createDefaultSettings = (userId: string): UserSettings => ({
  userId,
  enabledModels: [defaultModel],
  defaultModel,
  compressionEnabled: true,
  compressionTriggerRatio: 0.65,
  compressionKeepRecentMessages: 20,
  summarizerModel: 'openai/gpt-4o-mini',
  memoryExtractModel: null,
  memoryMergeEnabled: true,
  memoryAutoExtractEnabled: false,
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 1024,
  systemPrompt: '',
  snackSystemOverlay: DEFAULT_SNACK_SYSTEM_OVERLAY,
  syzygyPostSystemPrompt: DEFAULT_SYZYGY_POST_PROMPT,
  syzygyReplySystemPrompt: DEFAULT_SYZYGY_REPLY_PROMPT,
  chatReasoningEnabled: true,
  rpReasoningEnabled: false,
  updatedAt: new Date().toISOString(),
})

const mapSettingsRow = (row: UserSettingsRow): UserSettings => ({
  userId: row.user_id,
  enabledModels: row.enabled_models ?? [defaultModel],
  defaultModel: row.default_model ?? defaultModel,
  compressionEnabled: row.compression_enabled ?? true,
  compressionTriggerRatio: row.compression_trigger_ratio ?? 0.65,
  compressionKeepRecentMessages: row.compression_keep_recent_messages ?? 20,
  summarizerModel: row.summarizer_model?.trim() ? row.summarizer_model : null,
  memoryExtractModel: row.memory_extract_model?.trim() ? row.memory_extract_model : null,
  memoryMergeEnabled: row.memory_merge_enabled ?? true,
  memoryAutoExtractEnabled: row.memory_auto_extract_enabled ?? false,
  temperature: row.temperature ?? 0.7,
  topP: row.top_p ?? 0.9,
  maxTokens: row.max_tokens ?? 1024,
  systemPrompt: row.system_prompt ?? '',
  snackSystemOverlay: resolveSnackSystemOverlay(row.snack_system_prompt),
  syzygyPostSystemPrompt: resolveSyzygyPostPrompt(row.syzygy_post_system_prompt),
  syzygyReplySystemPrompt: resolveSyzygyReplyPrompt(row.syzygy_reply_system_prompt),
  chatReasoningEnabled: row.chat_reasoning_enabled ?? row.enable_reasoning ?? true,
  rpReasoningEnabled: row.rp_reasoning_enabled ?? false,
  updatedAt: row.updated_at,
})

export const ensureUserSettings = async (userId: string): Promise<UserSettings> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { data, error } = await supabase
    .from('user_settings')
    .select(
      'user_id,enabled_models,default_model,memory_extract_model,compression_enabled,compression_trigger_ratio,compression_keep_recent_messages,summarizer_model,memory_merge_enabled,memory_auto_extract_enabled,temperature,top_p,max_tokens,system_prompt,snack_system_prompt,syzygy_post_system_prompt,syzygy_reply_system_prompt,enable_reasoning,chat_reasoning_enabled,rp_reasoning_enabled,updated_at',
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
        memory_extract_model: defaults.memoryExtractModel,
        compression_enabled: defaults.compressionEnabled,
        compression_trigger_ratio: defaults.compressionTriggerRatio,
        compression_keep_recent_messages: defaults.compressionKeepRecentMessages,
        summarizer_model: defaults.summarizerModel,
        memory_merge_enabled: defaults.memoryMergeEnabled,
        memory_auto_extract_enabled: defaults.memoryAutoExtractEnabled,
        temperature: defaults.temperature,
        top_p: defaults.topP,
        max_tokens: defaults.maxTokens,
        system_prompt: defaults.systemPrompt,
        snack_system_prompt: defaults.snackSystemOverlay,
        syzygy_post_system_prompt: defaults.syzygyPostSystemPrompt,
        syzygy_reply_system_prompt: defaults.syzygyReplySystemPrompt,
        enable_reasoning: defaults.chatReasoningEnabled,
        chat_reasoning_enabled: defaults.chatReasoningEnabled,
        rp_reasoning_enabled: defaults.rpReasoningEnabled,
        updated_at: now,
      })
      .select(
        'user_id,enabled_models,default_model,memory_extract_model,compression_enabled,compression_trigger_ratio,compression_keep_recent_messages,summarizer_model,memory_merge_enabled,memory_auto_extract_enabled,temperature,top_p,max_tokens,system_prompt,snack_system_prompt,syzygy_post_system_prompt,syzygy_reply_system_prompt,enable_reasoning,chat_reasoning_enabled,rp_reasoning_enabled,updated_at',
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
      memory_extract_model: settings.memoryExtractModel,
      compression_enabled: settings.compressionEnabled,
      compression_trigger_ratio: settings.compressionTriggerRatio,
      compression_keep_recent_messages: settings.compressionKeepRecentMessages,
      summarizer_model: settings.summarizerModel,
      memory_merge_enabled: settings.memoryMergeEnabled,
      memory_auto_extract_enabled: settings.memoryAutoExtractEnabled,
      temperature: settings.temperature,
      top_p: settings.topP,
      max_tokens: settings.maxTokens,
      system_prompt: settings.systemPrompt,
      snack_system_prompt: settings.snackSystemOverlay,
      syzygy_post_system_prompt: settings.syzygyPostSystemPrompt,
      syzygy_reply_system_prompt: settings.syzygyReplySystemPrompt,
      enable_reasoning: settings.chatReasoningEnabled,
      chat_reasoning_enabled: settings.chatReasoningEnabled,
      rp_reasoning_enabled: settings.rpReasoningEnabled,
      updated_at: now,
    })
    .eq('user_id', settings.userId)
  if (error) {
    throw error
  }
}

export const saveSnackSystemPrompt = async (userId: string, value: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('user_settings')
    .update({
      snack_system_prompt: value,
      updated_at: now,
    })
    .eq('user_id', userId)
  if (error) {
    throw error
  }
}

export const saveMemoryExtractModel = async (
  userId: string,
  modelId: string | null,
): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('user_settings')
    .update({
      memory_extract_model: modelId,
      updated_at: now,
    })
    .eq('user_id', userId)
  if (error) {
    throw error
  }
}

export const loadMemoryMergeEnabled = async (userId: string): Promise<boolean> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { data, error } = await supabase
    .from('user_settings')
    .select('memory_merge_enabled')
    .eq('user_id', userId)
    .maybeSingle<{ memory_merge_enabled: boolean | null }>()
  if (error) {
    throw error
  }
  return data?.memory_merge_enabled ?? true
}

export const saveMemoryMergeEnabled = async (userId: string, enabled: boolean): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('user_settings')
    .update({
      memory_merge_enabled: enabled,
      updated_at: now,
    })
    .eq('user_id', userId)
  if (error) {
    throw error
  }
}

export const saveMemoryAutoExtractEnabled = async (
  userId: string,
  enabled: boolean,
): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('user_settings')
    .update({
      memory_auto_extract_enabled: enabled,
      updated_at: now,
    })
    .eq('user_id', userId)
  if (error) {
    throw error
  }
}


export const saveSyzygyPostSystemPrompt = async (userId: string, value: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('user_settings')
    .update({
      syzygy_post_system_prompt: value,
      updated_at: now,
    })
    .eq('user_id', userId)
  if (error) {
    throw error
  }
}

export const saveSyzygyReplySystemPrompt = async (userId: string, value: string): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('user_settings')
    .update({
      syzygy_reply_system_prompt: value,
      updated_at: now,
    })
    .eq('user_id', userId)
  if (error) {
    throw error
  }
}
