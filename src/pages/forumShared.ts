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
  contextTokenLimit: 32000,
  maxOutputTokens: 1600,
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
  replyTargetReplyId?: string | null
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
const FORUM_NEW_THREAD_MAX_TOKENS = 1200
const FORUM_CONTEXT_TOKEN_LIMIT_MIN = 8000
const FORUM_CONTEXT_TOKEN_LIMIT_MAX = 128000
const FORUM_CONTEXT_TOKEN_LIMIT_DEFAULT = 32000
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

const deriveFallbackTitleFromBody = (body: string) => {
  const cleanedBody = normalizeForumThreadBody(body)
  if (!cleanedBody) {
    return ''
  }
  const firstLine = cleanedBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  const base = (firstLine ?? cleanedBody).replace(/[。！？!?].*$/, '').trim()
  if (!base) {
    return ''
  }
  return normalizeForumTitle(base.slice(0, 60))
}

const parseThreadFromLooseJsonFields = (rawText: string): ForumAiNewThreadDraft | null => {
  const cleaned = cleanupGeneratedText(rawText)
  const titleMatch = cleaned.match(/"title"\s*:\s*"([\s\S]*?)"\s*(?:,|\n|\})/i)
  const bodyMatch = cleaned.match(/"body"\s*:\s*"([\s\S]*?)"\s*(?:,|\n|\})/i)
  const parsedTitle = normalizeForumTitle(titleMatch?.[1]?.replace(/\\n/g, '\n') ?? '')
  const parsedBody = normalizeForumThreadBody(bodyMatch?.[1]?.replace(/\\n/g, '\n') ?? '')
  if (!parsedBody) {
    return null
  }
  return {
    title: parsedTitle || deriveFallbackTitleFromBody(parsedBody),
    body: parsedBody,
  }
}

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

const normalizeForumAiNewThreadDraft = (
  rawText: string,
): { draft: ForumAiNewThreadDraft | null; failureReasons: string[] } => {
  const failureReasons: string[] = []
  if (!rawText.trim()) {
    return { draft: null, failureReasons: ['empty_response'] }
  }

  const parseSteps: Array<{ name: string; parser: (text: string) => ForumAiNewThreadDraft | null }> = [
    { name: 'json', parser: parseThreadFromJson },
    { name: 'labeled_text', parser: parseThreadFromLabeledText },
    { name: 'markdown_heading', parser: parseThreadFromHeading },
    { name: 'plain_text', parser: parseThreadFromPlainText },
    { name: 'loose_json_fields', parser: parseThreadFromLooseJsonFields },
  ]

  for (const step of parseSteps) {
    const parsed = step.parser(rawText)
    if (!parsed?.body) {
      failureReasons.push(`${step.name}:missing_body`)
      continue
    }

    const fallbackTitle = parsed.title || deriveFallbackTitleFromBody(parsed.body)
    if (!fallbackTitle) {
      failureReasons.push(`${step.name}:missing_title`)
      continue
    }

    return {
      draft: {
        title: normalizeForumTitle(fallbackTitle),
        body: normalizeForumThreadBody(parsed.body),
      },
      failureReasons,
    }
  }

  return { draft: null, failureReasons }
}

const resolveForumSpeakerName = (author: { authorType: 'user' | 'ai'; authorSlot: number | null; authorName?: string | null }) => {
  if (author.authorName?.trim()) {
    return author.authorName.trim()
  }
  if (author.authorType === 'user') {
    return FORUM_USER_DISPLAY_NAME
  }
  return `AI Slot ${author.authorSlot ?? 1}`
}

const buildFullThreadConversationContext = (thread: ForumThread, replies: ForumReply[]) => {
  const threadAuthorName = resolveForumSpeakerName(thread)
  const rootSection = [
    'Root thread:',
    `Author: ${threadAuthorName}`,
    `Title: ${normalizeForumTitle(thread.title)}`,
    `Body: ${normalizeForumThreadBody(thread.content)}`,
  ].join('\n')

  const replyLookup = new Map<string, ForumReply>()
  replies.forEach((reply) => replyLookup.set(reply.id, reply))

  const repliesSection = [
    'Replies:',
    ...replies.map((reply, index) => {
      const authorName = resolveForumSpeakerName(reply)
      const fallbackReplyToAuthor =
        reply.replyToType === 'thread'
          ? threadAuthorName
          : resolveForumSpeakerName(replyLookup.get(reply.replyToReplyId ?? '') ?? thread)
      const replyToAuthor = reply.replyToAuthorName?.trim() || fallbackReplyToAuthor
      return [
        `Reply #${index + 1}`,
        `Author: ${authorName}`,
        `Replying to: ${replyToAuthor}`,
        `Content: ${normalizeForumThreadBody(reply.content)}`,
      ].join('\n')
    }),
  ].join('\n\n')

  return [rootSection, repliesSection].join('\n\n')
}

export const clampForumMaxOutputTokens = (value: number | null | undefined) => {
  if (!Number.isFinite(value)) {
    return 1600
  }
  const rounded = Math.round(value as number)
  if (rounded < 128 || rounded > 4000) {
    return 1600
  }
  return rounded
}

export const clampForumContextTokenLimit = (value: number | null | undefined) => {
  if (!Number.isFinite(value)) {
    return FORUM_CONTEXT_TOKEN_LIMIT_DEFAULT
  }
  const rounded = Math.round(value as number)
  if (rounded < FORUM_CONTEXT_TOKEN_LIMIT_MIN || rounded > FORUM_CONTEXT_TOKEN_LIMIT_MAX) {
    return FORUM_CONTEXT_TOKEN_LIMIT_DEFAULT
  }
  return rounded
}

const cropTextToTokenLimit = (value: string, tokenLimit: number) => {
  if (!value.trim()) {
    return value
  }
  const safeLimit = Math.max(1, tokenLimit)
  const approxMaxChars = safeLimit * 4
  if (value.length <= approxMaxChars) {
    return value
  }
  return `${value.slice(0, approxMaxChars)}…`
}

const isLikelyTruncatedCompletion = (payload: Record<string, unknown>) => {
  const choice = (payload?.choices as unknown[] | undefined)?.[0] as Record<string, unknown> | undefined
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : ''
  const nativeFinishReason =
    typeof choice?.native_finish_reason === 'string'
      ? choice.native_finish_reason
      : typeof payload?.native_finish_reason === 'string'
        ? payload.native_finish_reason
        : ''
  return finishReason.toLowerCase() === 'length' || nativeFinishReason.toUpperCase() === 'MAX_TOKENS'
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
  replyTargetReplyId,
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

  const contextTokenLimit = clampForumContextTokenLimit(profile.contextTokenLimit)
  const configuredMaxOutputTokens = clampForumMaxOutputTokens(profile.maxOutputTokens)
  const threadContext = buildFullThreadConversationContext(thread, replies)
  const threadAuthorName = resolveForumSpeakerName(thread)

  const replyTarget =
    task === 'reply' && replyTargetReplyId
      ? replies.find((item) => item.id === replyTargetReplyId) ?? null
      : null
  const replyTargetType = task === 'reply' ? (replyTargetReplyId ? 'reply' : 'thread') : null
  const replyTargetAuthorName =
    task === 'reply'
      ? replyTarget
        ? resolveForumSpeakerName(replyTarget)
        : threadAuthorName
      : null
  const replyTargetContent =
    task === 'reply'
      ? normalizeForumThreadBody(replyTarget ? replyTarget.content : thread.content)
      : null

  const memoryBlockRaw = memoryEntries.length
    ? memoryEntries
        .map((entry, index) => `${index + 1}. (${entry.status}) ${entry.content}`)
        .join('\n')
    : '无'
  const memoryBlock = cropTextToTokenLimit(memoryBlockRaw, Math.max(2000, Math.floor(contextTokenLimit * 0.45)))

  const messagesPayload: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
  messagesPayload.push({
    role: 'system',
    content: `Forum 模式指令层。你的身份是 slot_${profile.slotIndex}（${profile.displayName}）。严格遵循输出格式要求，不要包含额外解释。`,
  })
  messagesPayload.push({
    role: 'system',
    content: [
      'Current AI identity:',
      `Selected AI slot: ${profile.slotIndex}`,
      `Display name: ${profile.displayName}`,
      `Forum system prompt: ${profile.systemPrompt.trim() || '（未设置）'}`,
    ].join('\n'),
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
  messagesPayload.push({
    role: 'system',
    content: `forum_thread_context_token_limit：${contextTokenLimit}`,
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
      content: [
        'Root thread metadata:',
        `Thread author: ${threadAuthorName}`,
        `Thread title: ${normalizeForumTitle(thread.title)}`,
        `Thread body: ${normalizeForumThreadBody(thread.content)}`,
      ].join('\n'),
    })
    messagesPayload.push({
      role: 'user',
      content: [
        'Reply target metadata:',
        `Current reply target type: ${replyTargetType ?? 'thread'}`,
        `Current reply target author name: ${replyTargetAuthorName ?? threadAuthorName}`,
        `Current reply target content: ${replyTargetContent ?? normalizeForumThreadBody(thread.content)}`,
      ].join('\n'),
    })
    messagesPayload.push({
      role: 'user',
      content: `Full thread conversation (chronological, speaker-labeled):\n${threadContext}`,
    })
    messagesPayload.push({
      role: 'user',
      content: `请生成一条论坛回复。回复目标：${replyTargetLabel ?? '主题帖'}。回复长度要求：保持中等篇幅，优先 120~280 字，内容完整自然，不要写成超长文章。${userPrompt ? `用户补充：${userPrompt}` : ''}`,
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
    max_tokens: task === 'reply' ? configuredMaxOutputTokens : FORUM_NEW_THREAD_MAX_TOKENS,
    stream: false,
    extra: {
      identitySlot: profile.slotIndex,
      scope: 'thread-only',
      enabledModelIds: globalModelConfig.enabledModelIds,
      defaultModelId: globalModelConfig.defaultModelId,
      contextTokenLimit,
    },
  }

  if (task === 'reply') {
    console.info('[Forum AI][reply] generation token settings', {
      configuredMaxOutputTokens,
      sentMaxTokens: requestBody.max_tokens,
      profileSlot: profile.slotIndex,
      model: resolvedModel,
    })
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
    console.info('[Forum AI][new-thread] raw content', {
      length: normalizedContent.length,
      preview: normalizedContent.slice(0, 1000),
    })
    const { draft, failureReasons } = normalizeForumAiNewThreadDraft(normalizedContent)
    console.info('[Forum AI][new-thread] parsed draft before insert', {
      parsedTitleLength: draft?.title.length ?? 0,
      parsedBodyLength: draft?.body.length ?? 0,
      failureReasons,
    })
    if (!draft) {
      console.error('[Forum AI][new-thread] parsing rejected output', {
        failureReasons,
        preview: normalizedContent.slice(0, 1200),
      })
      throw new Error(`AI 主题格式解析失败（${failureReasons.join(', ') || 'unknown_reason'}）`)
    }
    return draft
  }

  const replyBody = normalizeForumAiReplyBody(normalizedContent)
  const truncated = isLikelyTruncatedCompletion(payload)

  if (truncated) {
    console.warn('[Forum AI][reply] model completion likely truncated by token limit', {
      configuredMaxOutputTokens,
      sentMaxTokens: requestBody.max_tokens,
      parsedReplyLength: replyBody?.length ?? 0,
      payloadPreview: JSON.stringify(payload).slice(0, 1200),
    })
    if (!replyBody) {
      throw new Error('AI 回复疑似因长度限制被截断，请重试。')
    }
  }

  if (!replyBody) {
    throw new Error('AI 回复格式解析失败')
  }
  return replyBody
}
