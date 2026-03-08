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

type RequestForumAiNewThreadParams = Omit<RequestForumAiContentParams, 'task'> & { task: 'new-thread' }
type RequestForumAiReplyParams = Omit<RequestForumAiContentParams, 'task'> & { task: 'reply' }

export type ForumAiNewThreadDraft = {
  title: string
  body: string
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

export async function requestForumAiContent(params: RequestForumAiNewThreadParams): Promise<ForumAiNewThreadDraft>
export async function requestForumAiContent(params: RequestForumAiReplyParams): Promise<string>
export async function requestForumAiContent({
  profile,
  thread,
  replies,
  memoryEntries,
  globalModelConfig,
  task,
  replyTargetLabel,
  userPrompt,
}: RequestForumAiContentParams) {
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
    content: `Forum 模式指令层。你的身份是 slot_${profile.slotIndex}（${profile.displayName}）。严格遵循输出格式要求，不要包含额外解释。`,
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
      content:
        '请生成新的论坛主题，必须返回 JSON：{"title":"...","body":"..."}。title 为主题标题，body 为主题正文。禁止输出 JSON 之外的任何文字。',
    })
    messagesPayload.push({
      role: 'user',
      content: `写作方向（可选）：${userPrompt?.trim() || '（未提供）'}。不要引用任何历史线程内容。`,
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
  const normalizedContent = content.trim()

  if (task === 'new-thread') {
    const fallbackBody = normalizedContent || '（空主题）'
    const parseStructuredDraft = (rawText: string): ForumAiNewThreadDraft | null => {
      if (!rawText.trim()) {
        return null
      }
      const normalized = rawText.trim()
      const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
      const candidate = (fencedMatch?.[1] ?? normalized).trim()
      try {
        const parsed = JSON.parse(candidate) as Record<string, unknown>
        const parsedTitle = typeof parsed.title === 'string' ? parsed.title.trim() : ''
        const parsedBody = typeof parsed.body === 'string' ? parsed.body.trim() : ''
        if (!parsedTitle || !parsedBody) {
          return null
        }
        return {
          title: parsedTitle,
          body: parsedBody,
        }
      } catch {
        return null
      }
    }

    const structuredDraft = parseStructuredDraft(normalizedContent)
    if (structuredDraft) {
      return structuredDraft
    }

    return {
      title: thread.title.trim() || `AI 主题 ${new Date().toLocaleString('zh-CN')}`,
      body: fallbackBody,
    }
  }

  return normalizedContent || '（空回复）'
}
