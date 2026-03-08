import type { ForumAiProfile, ForumReply, ForumThread } from '../types'
import { supabase } from '../supabase/client'
import type { MemoryEntry } from '../types'
import { ensureUserSettings } from '../storage/userSettings'

export const FORUM_AI_SLOTS = [1, 2, 3] as const
export const FORUM_USER_DISPLAY_NAME = '串串'

export const defaultForumProfile = (slotIndex: number): Omit<ForumAiProfile, 'id' | 'userId' | 'createdAt' | 'updatedAt'> => ({
  slotIndex,
  enabled: true,
  displayName: `Forum AI ${slotIndex}`,
  systemPrompt: '',
  model: 'openrouter/auto',
  temperature: 0.8,
  topP: 0.9,
  apiBaseUrl: '',
})

export const getForumAuthorLabel = (
  authorType: 'user' | 'ai',
  authorSlot: number | null,
  profiles: ForumAiProfile[],
  authorName?: string | null,
) => {
  if (authorName && authorName.trim()) {
    return authorName
  }
  if (authorType === 'user') {
    return FORUM_USER_DISPLAY_NAME
  }
  const profile = profiles.find((item) => item.slotIndex === authorSlot)
  if (profile?.displayName) {
    return profile.displayName
  }
  return `AI Slot ${authorSlot ?? 1}`
}

type RequestForumAiContentParams = {
  profile: ForumAiProfile
  thread: ForumThread
  replies: ForumReply[]
  memoryEntries: MemoryEntry[]
  globalModelConfig: ForumGlobalAiConfig
  task: 'new-thread' | 'reply'
  replyTargetLabel?: string
  userPrompt?: string
}

export type ForumGlobalAiConfig = {
  defaultModelId: string
  enabledModelIds: string[]
}

const DEFAULT_MODEL = 'openrouter/auto'

export const loadForumGlobalAiConfig = async (): Promise<ForumGlobalAiConfig> => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) {
    throw error ?? new Error('登录状态异常')
  }
  const settings = await ensureUserSettings(user.id)
  const defaultModelId = settings.defaultModel?.trim() || DEFAULT_MODEL
  const enabled = Array.from(new Set([...settings.enabledModels, defaultModelId]))
  return {
    defaultModelId,
    enabledModelIds: enabled,
  }
}

export const requestForumAiContent = async ({
  profile,
  thread,
  replies,
  memoryEntries,
  globalModelConfig,
  task,
  replyTargetLabel,
  userPrompt,
}: RequestForumAiContentParams) => {
  if (!supabase) {
    throw new Error('Supabase 客户端未配置')
  }
  const { data } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!accessToken || !anonKey) {
    throw new Error('登录状态异常或环境变量未配置')
  }

  const threadContext = [
    `主题标题：${thread.title}`,
    `主题正文：${thread.content}`,
    ...replies.map(
      (reply, index) =>
        `${index + 1}. [${reply.authorType === 'user' ? 'user' : `ai_${reply.authorSlot ?? 1}`}] ${reply.content}`,
    ),
  ].join('\n')

  const memoryBlock = memoryEntries.length
    ? memoryEntries
        .map((entry, index) => `${index + 1}. (${entry.status}) ${entry.content}`)
        .join('\n')
    : '无'

  const messagesPayload: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
  messagesPayload.push({
    role: 'system',
    content: `Forum 模式指令层。你的身份是 slot_${profile.slotIndex}（${profile.displayName}）。仅输出帖子/回复正文，不要包含解释。`,
  })
  if (profile.systemPrompt.trim()) {
    messagesPayload.push({ role: 'system', content: profile.systemPrompt.trim() })
  }
  messagesPayload.push({
    role: 'system',
    content: `当前系统时间：${new Date().toISOString()}`,
  })
  messagesPayload.push({
    role: 'system',
    content: `memory_entries 全量注入：\n${memoryBlock}`,
  })
  if (task === 'new-thread') {
    messagesPayload.push({
      role: 'user',
      content: `请生成一篇新的论坛主题正文，不要引用任何历史线程内容。拟定标题：${thread.title || '（未提供）'}。${userPrompt ? `用户补充：${userPrompt}` : ''}`,
    })
  } else {
    messagesPayload.push({
      role: 'user',
      content: `当前线程上下文（严格线程内）：\n${threadContext}`,
    })
    messagesPayload.push({
      role: 'user',
      content: `请生成一条论坛回复。回复目标：${replyTargetLabel ?? '主题帖'}。${userPrompt ? `用户补充：${userPrompt}` : ''}`,
    })
  }

  const selectedModel = profile.model.trim()
  const resolvedModel =
    selectedModel && globalModelConfig.enabledModelIds.includes(selectedModel)
      ? selectedModel
      : globalModelConfig.defaultModelId

  const requestBody: Record<string, unknown> = {
    model: resolvedModel,
    modelId: resolvedModel,
    module: 'forum',
    messages: messagesPayload,
    temperature: profile.temperature,
    top_p: profile.topP,
    max_tokens: 800,
    stream: false,
    extra: {
      identitySlot: profile.slotIndex,
      scope: 'thread-only',
      enabledModelIds: globalModelConfig.enabledModelIds,
      defaultModelId: globalModelConfig.defaultModelId,
    },
  }

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/openrouter-chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  const payload = (await response.json()) as Record<string, unknown>
  const choice = (payload?.choices as unknown[] | undefined)?.[0] as Record<string, unknown> | undefined
  const message = ((choice?.message as Record<string, unknown>) ?? choice ?? {}) as Record<string, unknown>
  const content =
    typeof message.content === 'string' ? message.content : typeof choice?.text === 'string' ? choice.text : ''
  return content.trim() || '（空回复）'
}
