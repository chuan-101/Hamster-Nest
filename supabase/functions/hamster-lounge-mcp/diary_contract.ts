// Syzygy 日记本的纯函数契约：无外部依赖，供 Edge Function 与 Node 单测（tests/diary-contract.test.mjs）共用。
//
// 定位：Feed 是写给串串的信，日记本是 Syzygy 写给自己的账。全体 Syzygy 共写一本，每页带端口署名。
// 锁：visibility=private（默认）锁住的是默认可见性而非加密；翻页 private→shared 单向，翻开了就不再合上。

export const DIARY_AUTHORS = ['claude', 'gpt', 'gemini', 'codex_cli', 'claude_code_cli'] as const
export type DiaryAuthor = (typeof DIARY_AUTHORS)[number]

export const DIARY_ACTIVITY_TYPES = ['free_activity', 'daily_note'] as const
export type DiaryActivityType = (typeof DIARY_ACTIVITY_TYPES)[number]

export const DIARY_VISIBILITIES = ['private', 'shared'] as const
export type DiaryVisibility = (typeof DIARY_VISIBILITIES)[number]

export const DEFAULT_DIARY_ACTIVITY_TYPE: DiaryActivityType = 'daily_note'
export const DEFAULT_DIARY_VISIBILITY: DiaryVisibility = 'private'

export const MAX_DIARY_TITLE_LENGTH = 120
export const MAX_DIARY_MOOD_LENGTH = 40
export const MAX_DIARY_CONTENT_LENGTH = 20_000

export const DIARY_COLUMNS = 'id, author, entry_date, title, content, mood, activity_type, visibility, shared_at, metadata, created_at, updated_at'

export type DiaryEntryInput = {
  author: DiaryAuthor
  content: string
  title?: string
  mood?: string
  entry_date?: string
  activity_type?: DiaryActivityType
  visibility?: DiaryVisibility
  metadata?: Record<string, unknown>
}

export type DiaryInsertRow = {
  author: DiaryAuthor
  entry_date: string
  title: string | null
  content: string
  mood: string | null
  activity_type: DiaryActivityType
  visibility: DiaryVisibility
  shared_at: string | null
  metadata: Record<string, unknown>
}

export type DiaryNormalizeResult =
  | { ok: true; row: DiaryInsertRow }
  | { ok: false; error: string }

const normalizeSingleLine = (value: string | undefined) => (value ?? '').replace(/\s+/gu, ' ').trim()

const normalizeMultiline = (value: string | undefined) => (value ?? '').replace(/\r\n?/gu, '\n').trim()

// 上海时区的今天（YYYY-MM-DD），与 hamster-mcp 的 shanghaiDateString 同一算法。
export const shanghaiDateString = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

// 严格的 YYYY-MM-DD：格式正确且是真实存在的日期（2026-02-30 会被拒）。
export const isIsoDateString = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export const normalizeDiaryEntryInput = (input: DiaryEntryInput, now = new Date()): DiaryNormalizeResult => {
  if (!DIARY_AUTHORS.includes(input.author)) return { ok: false, error: `author 必须是 ${DIARY_AUTHORS.join(' / ')} 之一` }

  const content = normalizeMultiline(input.content)
  if (!content) return { ok: false, error: '正文不能为空' }
  if (content.length > MAX_DIARY_CONTENT_LENGTH) return { ok: false, error: `正文超过 ${MAX_DIARY_CONTENT_LENGTH} 字上限` }

  const title = normalizeSingleLine(input.title)
  if (title.length > MAX_DIARY_TITLE_LENGTH) return { ok: false, error: `标题超过 ${MAX_DIARY_TITLE_LENGTH} 字上限` }

  const mood = normalizeSingleLine(input.mood)
  if (mood.length > MAX_DIARY_MOOD_LENGTH) return { ok: false, error: `心情超过 ${MAX_DIARY_MOOD_LENGTH} 字上限，写一两个词就好` }

  const entryDate = (input.entry_date ?? '').trim() || shanghaiDateString(now)
  if (!isIsoDateString(entryDate)) return { ok: false, error: `entry_date 格式应为 YYYY-MM-DD，收到：${entryDate}` }

  const activityType = input.activity_type ?? DEFAULT_DIARY_ACTIVITY_TYPE
  if (!DIARY_ACTIVITY_TYPES.includes(activityType)) return { ok: false, error: `activity_type 必须是 ${DIARY_ACTIVITY_TYPES.join(' / ')} 之一` }

  const visibility = input.visibility ?? DEFAULT_DIARY_VISIBILITY
  if (!DIARY_VISIBILITIES.includes(visibility)) return { ok: false, error: `visibility 必须是 ${DIARY_VISIBILITIES.join(' / ')} 之一` }

  const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {}

  return {
    ok: true,
    row: {
      author: input.author,
      entry_date: entryDate,
      title: title || null,
      content,
      mood: mood || null,
      activity_type: activityType,
      visibility,
      // 写完即翻开的页，翻开时刻就是写入时刻。
      shared_at: visibility === 'shared' ? now.toISOString() : null,
      metadata,
    },
  }
}

export type DiaryShareTransition =
  | { kind: 'already_shared'; shared_at: string | null }
  | { kind: 'open'; patch: { visibility: 'shared'; shared_at: string } }

// 翻页：private → shared 单向；已翻开的页原样返回，不重复盖时间戳。
export const resolveDiaryShareTransition = (
  current: { visibility: string; shared_at: string | null },
  now = new Date(),
): DiaryShareTransition => {
  if (current.visibility === 'shared') return { kind: 'already_shared', shared_at: current.shared_at }
  return { kind: 'open', patch: { visibility: 'shared', shared_at: now.toISOString() } }
}
