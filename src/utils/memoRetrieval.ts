import type { MemoSource } from '../types'
import { supabase } from '../supabase/client'

type MemoEntryRow = {
  id: string
  user_id: string
  content: string
  source: MemoSource
  is_pinned: boolean | null
  created_at: string
  updated_at: string
  is_deleted: boolean
}

type MatchedMemoEntry = {
  id: string
  content: string
  isPinned: boolean
  updatedAt: string
}

type MemoTagRow = {
  id: string
  name: string
}

type MemoEntryTagRow = {
  memo_entry_id: string
  memo_tag_id: string
}

const MEMO_TRIGGER_TOKEN = '备忘录'
const CONNECTOR_SPLIT_REGEX = /[，。！？!?,、；;\s]+|(?:以及|还有|和|跟|或|或者)/g
const STOPWORD_REGEX = /(看看|看下|看一下|查下|查一下|查询|检索|调一下|调下|提取|读取|关于|相关|内容|设定|有没有|有无|里|里面|中的|一下|帮我|帮忙|请|从|去|把|给我|的)/g

const normalizeKeyword = (keyword: string) => keyword.trim().replace(/^['"“”‘’]+|['"“”‘’]+$/g, '')

const extractQuotedKeywords = (input: string) => {
  const keywords: string[] = []
  const pattern = /["“]([^"”]+)["”]|[']([^']+)[']/g
  let match: RegExpExecArray | null = pattern.exec(input)
  while (match) {
    const captured = normalizeKeyword(match[1] ?? match[2] ?? '')
    if (captured.length > 0) {
      keywords.push(captured)
    }
    match = pattern.exec(input)
  }
  return keywords
}

export const detectMemoRetrievalIntent = (message: string) => {
  const trimmed = message.trim()
  if (!trimmed.includes(MEMO_TRIGGER_TOKEN)) {
    return { shouldRetrieve: false, keywords: [] as string[] }
  }

  const quotedKeywords = extractQuotedKeywords(trimmed)
  const afterMemoToken = trimmed.split(MEMO_TRIGGER_TOKEN).slice(1).join(' ')
  const sourceForParsing = (afterMemoToken || trimmed)
    .replace(STOPWORD_REGEX, ' ')
    .replace(/\b(?:memo|memoes)\b/gi, ' ')

  const segmentedKeywords = sourceForParsing
    .split(CONNECTOR_SPLIT_REGEX)
    .map((segment) => normalizeKeyword(segment.replace(MEMO_TRIGGER_TOKEN, '')))
    .filter((segment) => segment.length > 0 && segment !== MEMO_TRIGGER_TOKEN)

  const uniqueKeywords = Array.from(
    new Set(
      [...quotedKeywords, ...segmentedKeywords].filter((keyword) => keyword.length > 0 && keyword !== MEMO_TRIGGER_TOKEN),
    ),
  )

  if (uniqueKeywords.length === 0) {
    return { shouldRetrieve: false, keywords: [] as string[] }
  }

  return { shouldRetrieve: true, keywords: uniqueKeywords }
}

const escapeForIlike = (value: string) => value.replace(/[%_]/g, '')

export const fetchMemoEntriesByTagKeywords = async (keywords: string[]): Promise<MatchedMemoEntry[]> => {
  if (!supabase || keywords.length === 0) {
    return []
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) {
    throw userError
  }

  if (!user) {
    return []
  }

  const validKeywords = Array.from(new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean)))
  if (validKeywords.length === 0) {
    return []
  }

  const orFilters = validKeywords
    .map((keyword) => `name.ilike.%${escapeForIlike(keyword)}%`)
    .join(',')

  const { data: tags, error: tagError } = await supabase
    .from('memo_tags')
    .select('id,name')
    .eq('user_id', user.id)
    .or(orFilters)

  if (tagError) {
    throw tagError
  }

  const matchedTags = (tags ?? []) as MemoTagRow[]
  if (matchedTags.length === 0) {
    return []
  }

  const tagIds = Array.from(new Set(matchedTags.map((tag) => tag.id)))
  const { data: relations, error: relationError } = await supabase
    .from('memo_entry_tags')
    .select('memo_entry_id,memo_tag_id')
    .in('memo_tag_id', tagIds)

  if (relationError) {
    throw relationError
  }

  const entryIds = Array.from(new Set(((relations ?? []) as MemoEntryTagRow[]).map((item) => item.memo_entry_id)))
  if (entryIds.length === 0) {
    return []
  }

  const { data: entries, error: entryError } = await supabase
    .from('memo_entries')
    .select('id,user_id,content,source,is_pinned,created_at,updated_at,is_deleted')
    .eq('user_id', user.id)
    .eq('is_deleted', false)
    .in('id', entryIds)

  if (entryError) {
    throw entryError
  }

  const deduped = new Map<string, MatchedMemoEntry>()
  ;((entries ?? []) as MemoEntryRow[]).forEach((entry) => {
    if (!deduped.has(entry.id)) {
      deduped.set(entry.id, {
        id: entry.id,
        content: entry.content,
        isPinned: entry.is_pinned ?? false,
        updatedAt: entry.updated_at,
      })
    }
  })

  return Array.from(deduped.values()).sort((a, b) => {
    if (a.isPinned !== b.isPinned) {
      return a.isPinned ? -1 : 1
    }
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })
}

export const formatMemoInjectionBlock = (keywords: string[], entries: MatchedMemoEntry[]): string | null => {
  if (keywords.length === 0 || entries.length === 0) {
    return null
  }

  const header = `【Memo Retrieval | Keywords: ${keywords.join('，')}】`
  const lines = entries.map((entry) => `- ${entry.isPinned ? '[Pinned] ' : ''}${entry.content.trim()}`)
  return [header, ...lines].join('\n')
}

export const buildMemoInjectionBlock = async (message: string): Promise<string | null> => {
  const detection = detectMemoRetrievalIntent(message)
  if (!detection.shouldRetrieve) {
    return null
  }

  try {
    const entries = await fetchMemoEntriesByTagKeywords(detection.keywords)
    if (entries.length === 0) {
      return null
    }
    return formatMemoInjectionBlock(detection.keywords, entries)
  } catch (error) {
    console.warn('[memo-retrieval] Failed to retrieve memo entries:', error)
    return null
  }
}
