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
const FORUM_AI_DEBUG = import.meta.env.DEV

const unwrapCodeFence = (value: string) => {
  let next = value.trim()
  let previous = ''
  while (next !== previous) {
    previous = next
    const fencedMatch = next.match(/^```[\w-]*\s*([\s\S]*?)\s*```$/)
    next = fencedMatch ? fencedMatch[1].trim() : next
  }
  return next
}

const cleanupGeneratedText = (value: string) =>
  unwrapCodeFence(value)
    .replace(/^\s*```(?:json|markdown|md|text)?\s*$/gim, '')
    .replace(/^\s*```\s*$/gim, '')
    .trim()

const normalizeForumThreadBody = (value: string) =>
  cleanupGeneratedText(value)
    .replace(/^\s*(?:body|正文|内容|回复|回覆|answer|response|reply)\s*[:：]\s*/i, '')
    .trim()

const normalizeForumTitle = (value: string) =>
  cleanupGeneratedText(value)
    .replace(/^\s*(?:title|标题|主题)\s*[:：]\s*/i, '')
    .replace(/^#+\s*/, '')
    .trim()

const parseJsonObjectCandidates = (text: string) => {
  const candidates = new Set<string>()
  const cleaned = cleanupGeneratedText(text)
  if (cleaned) {
    candidates.add(cleaned)
  }

  const stack: number[] = []
  for (let index = 0; index < cleaned.length; index += 1) {
    const char = cleaned[index]
    if (char === '{') {
      stack.push(index)
    } else if (char === '}') {
      const start = stack.pop()
      if (start !== undefined && stack.length === 0) {
        candidates.add(cleaned.slice(start, index + 1).trim())
      }
    }
  }

  return [...candidates]
}

const parseThreadFromJson = (rawText: string): ForumAiNewThreadDraft | null => {
  const candidates = parseJsonObjectCandidates(rawText)
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>
      const parsedTitle = normalizeForumTitle(typeof parsed.title === 'string' ? parsed.title : '')
      const parsedBody = normalizeForumThreadBody(typeof parsed.body === 'string' ? parsed.body : '')
      if (parsedTitle && parsedBody) {
        return { title: parsedTitle, body: parsedBody }
      }
    } catch {
      continue
    }
  }
  return null
}

const parseLabeledSections = (rawText: string) => {
  const cleaned = cleanupGeneratedText(rawText)
  const titleRegex = /(?:^|\n)\s*(?:#+\s*)?(?:title|标题|主题)\s*[:：]\s*(.+?)(?=\n|$)/i
  const bodyRegex = /(?:^|\n)\s*(?:#+\s*)?(?:body|正文|内容|reply|回复|回覆)\s*[:：]\s*([\s\S]*)$/i
  const titleMatch = cleaned.match(titleRegex)
  const bodyMatch = cleaned.match(bodyRegex)
  return {
    title: normalizeForumTitle(titleMatch?.[1] ?? ''),
    body: normalizeForumThreadBody(bodyMatch?.[1] ?? ''),
  }
}

const parseThreadFromLabeledText = (rawText: string): ForumAiNewThreadDraft | null => {
  const section = parseLabeledSections(rawText)
  if (section.title && section.body) {
    return section
  }
  return null
}

const parseThreadFromHeading = (rawText: string): ForumAiNewThreadDraft | null => {
  const cleaned = cleanupGeneratedText(rawText)
  const headingMatch = cleaned.match(/^#+\s*(.+?)\s*$/m)
  if (!headingMatch) {
    return null
  }
  const parsedTitle = normalizeForumTitle(headingMatch[1])
  const parsedBody = normalizeForumThreadBody(cleaned.replace(headingMatch[0], ''))
  if (!parsedTitle || !parsedBody) {
    return null
  }
  return { title: parsedTitle, body: parsedBody }
}

const parseThreadFromPlainText = (rawText: string): ForumAiNewThreadDraft | null => {
  const cleaned = cleanupGeneratedText(rawText)
  const lines = cleaned.split(/\r?\n/).map((line) => line.trimEnd())
  const nonEmptyLines = lines.filter((line) => line.trim())
  if (nonEmptyLines.length < 2) {
    return null
  }
  const parsedTitle = normalizeForumTitle(nonEmptyLines[0])
  const parsedBody = normalizeForumThreadBody(nonEmptyLines.slice(1).join('\n'))
  if (!parsedTitle || !parsedBody) {
    return null
  }
  return { title: parsedTitle, body: parsedBody }
}

const normalizeForumAiNewThreadDraft = (rawText: string): ForumAiNewThreadDraft | null => {
  if (!rawText.trim()) {
    return null
  }
  const parsed =
    parseThreadFromJson(rawText) ??
    parseThreadFromLabeledText(rawText) ??
    parseThreadFromHeading(rawText) ??
    parseThreadFromPlainText(rawText)

  if (!parsed?.title || !parsed.body) {
    return null
  }

  return {
    title: parsed.title,
    body: parsed.body,
  }
}

const flattenTextParts = (value: unknown): string => {
  if (typeof value === 'string') {
    return value
  }
  if (!Array.isArray(value)) {
    return ''
  }
  return value
    .map((part) => {
      if (typeof part === 'string') {
        return part
      }
      if (!part || typeof part !== 'object') {
        return ''
      }
      const candidate = part as Record<string, unknown>
      if (typeof candidate.text === 'string') {
        return candidate.text
      }
      if (typeof candidate.content === 'string') {
        return candidate.content
      }
      return ''
    })
    .filter(Boolean)
    .join('')
}

const extractOpenRouterContent = (payload: Record<string, unknown>) => {
  const choice = (payload?.choices as unknown[] | undefined)?.[0] as Record<string, unknown> | undefined
  const message = ((choice?.message as Record<string, unknown>) ?? choice ?? {}) as Record<string, unknown>
  const messageContent = flattenTextParts(message.content)
  const choiceText = typeof choice?.text === 'string' ? choice.text : ''
  const outputText = flattenTextParts(payload.output_text)
  const outputParts = flattenTextParts(payload.output)
  const candidate = [messageContent, choiceText, outputText, outputParts].find((item) => item.trim())
  return (candidate ?? '').trim()
}

const parseReplyFromJson = (rawText: string) => {
  const candidates = parseJsonObjectCandidates(rawText)
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>
      for (const key of ['reply', 'body', 'content', 'message', 'text']) {
        const value = parsed[key]
        if (typeof value === 'string') {
          const normalized = normalizeForumThreadBody(value)
          if (normalized) {
            return normalized
          }
        }
      }
    } catch {
      continue
    }
  }
  return ''
}

const normalizeForumAiReplyBody = (rawText: string): string | null => {
  if (!rawText.trim()) {
    return null
  }

  const fromJson = parseReplyFromJson(rawText)
  if (fromJson) {
    return fromJson
  }

  const sections = parseLabeledSections(rawText)
  if (sections.body) {
    return sections.body
  }

  const cleaned = normalizeForumThreadBody(rawText)
  if (!cleaned) {
    return null
  }

  const looksLikeRawWrapper =
    /^\s*\{[\s\S]*\}\s*$/m.test(cleaned) ||
    /(?:^|\n)\s*(?:title|标题|主题)\s*[:：]/i.test(cleaned) ||
    /(?:^|\n)\s*(?:body|正文|内容)\s*[:：]\s*$/i.test(cleaned)
  if (looksLikeRawWrapper) {
    return null
  }

  return cleaned
}

export const toForumPreviewText = (markdownContent: string, maxLength: number) => {
  const plainText = cleanupGeneratedText(markdownContent)
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/`{1,3}/g, '')
    .replace(/^[>#\-+*]+\s*/gm, '')
    .replace(/\*\*|__|~~|\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (plainText.length <= maxLength) {
    return plainText
  }
  return `${plainText.slice(0, maxLength)}…`
}

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
  if (FORUM_AI_DEBUG) {
    console.info('[Forum AI] openrouter-chat payload', payload)
  }
  const normalizedContent = extractOpenRouterContent(payload)

  if (task === 'new-thread') {
    const draft = normalizeForumAiNewThreadDraft(normalizedContent)
    if (!draft) {
      throw new Error('AI 主题格式解析失败')
    }
    return draft
  }

  const replyBody = normalizeForumAiReplyBody(normalizedContent)
  if (!replyBody) {
    throw new Error('AI 回复格式解析失败')
  }
  return replyBody
}
