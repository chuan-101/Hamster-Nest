// 囤粮处（Stash）的纯函数契约：无外部依赖，供 Edge Function 与 Node 单测（tests/stash-contract.test.mjs）共用。
//
// 定位：囤粮处是颊囊，学习库是胃。塞进来的东西不需要消化、不需要连线、不需要分类型，
// 只需要知道它在哪个格子里、谁塞的、有没有吃掉。folder_id 为空即「待归仓」。

export const STASH_ADDERS = ['chuanchuan', 'claude', 'gpt', 'gemini', 'codex_cli', 'claude_code_cli'] as const
export type StashAdder = (typeof STASH_ADDERS)[number]

export const STASH_STATUSES = ['stashed', 'eaten'] as const
export type StashStatus = (typeof STASH_STATUSES)[number]

export const DEFAULT_STASH_ADDER: StashAdder = 'chuanchuan'
export const DEFAULT_STASH_STATUS: StashStatus = 'stashed'

export const MAX_STASH_FOLDER_NAME_LENGTH = 60
export const MAX_STASH_FOLDER_DESCRIPTION_LENGTH = 500
export const MAX_STASH_TITLE_LENGTH = 200
export const MAX_STASH_CONTENT_LENGTH = 20_000
export const MAX_STASH_TAGS = 20
export const MAX_STASH_COMMENT_LENGTH = 2_000

export const STASH_FOLDER_COLUMNS = 'id, parent_id, name, icon, description, sort_order, created_at, updated_at'
export const STASH_ITEM_COLUMNS = 'id, folder_id, title, url, content, tags, added_by, status, eaten_at, metadata, created_at, updated_at'
export const STASH_COMMENT_COLUMNS = 'id, item_id, author, content, created_at, updated_at'

const normalizeSingleLine = (value: string | undefined | null) => (value ?? '').replace(/\s+/gu, ' ').trim()

const normalizeMultiline = (value: string | undefined | null) => (value ?? '').replace(/\r\n?/gu, '\n').trim()

// ── URL 归一化 ───────────────────────────────────────────────────────────────
//
// 去重键的规则：补 https://、host 小写并去 www.、去默认端口、去 fragment、去追踪参数、
// 剩余参数按名排序、去尾斜杠（根路径除外）。短链（xhslink.com 之类）看不穿，属已知盲区。

const TRACKING_PARAM_PATTERNS: RegExp[] = [
  /^utm_/iu,
  /^xhsshare$/iu,
  /^xsec_/iu,
  /^app_platform$/iu,
  /^app_version$/iu,
  /^apptime$/iu,
  /^appuid$/iu,
  /^share_id$/iu,
  /^share_from_user_hidden$/iu,
  /^author_share$/iu,
  /^type$/iu,
  /^spm$/iu,
  /^fbclid$/iu,
  /^gclid$/iu,
  /^igshid$/iu,
  /^ref_src$/iu,
  /^_gl$/iu,
]

const isTrackingParam = (name: string) => TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(name))

export type StashUrlResult =
  | { ok: true; url: string; url_key: string }
  | { ok: false; error: string }

export const normalizeStashUrl = (input: string | undefined | null): StashUrlResult => {
  const raw = normalizeSingleLine(input)
  if (!raw) return { ok: false, error: '链接不能为空' }
  if (/\s/u.test(raw)) return { ok: false, error: `链接里不能有空格：${raw}` }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//iu.test(raw) ? raw : `https://${raw}`

  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return { ok: false, error: `链接格式不对：${raw}` }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `只收 http / https 链接：${raw}` }
  }
  if (!parsed.hostname || !parsed.hostname.includes('.')) {
    return { ok: false, error: `链接的域名不完整：${raw}` }
  }

  const key = new URL(parsed.toString())
  key.hostname = key.hostname.toLowerCase().replace(/^www\./u, '')
  key.hash = ''
  key.username = ''
  key.password = ''
  const kept = Array.from(key.searchParams.entries()).filter(([name]) => !isTrackingParam(name))
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  key.search = ''
  for (const [name, value] of kept) key.searchParams.append(name, value)
  if (key.pathname.length > 1) key.pathname = key.pathname.replace(/\/+$/u, '') || '/'

  return { ok: true, url: parsed.toString(), url_key: key.toString() }
}

// 没给标题时从链接里凑一个：host + 路径，够认。
export const deriveStashTitleFromUrl = (url: string) => {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./u, '')
    const path = decodeURIComponent(parsed.pathname).replace(/\/+$/u, '')
    return `${host}${path}`.slice(0, MAX_STASH_TITLE_LENGTH)
  } catch {
    return url.slice(0, MAX_STASH_TITLE_LENGTH)
  }
}

export const normalizeStashTags = (tags: string[] | undefined | null) => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of tags ?? []) {
    const tag = normalizeSingleLine(raw)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    result.push(tag)
  }
  return result
}

// ── 格子 ─────────────────────────────────────────────────────────────────────

export type StashFolderInput = {
  name: string
  icon?: string | null
  description?: string | null
  parent_id?: string | null
  sort_order?: number | null
}

export type StashFolderRow = {
  name: string
  icon: string | null
  description: string | null
  parent_id: string | null
  sort_order: number
}

export type StashFolderNormalizeResult =
  | { ok: true; row: StashFolderRow }
  | { ok: false; error: string }

export const normalizeStashFolderInput = (input: StashFolderInput): StashFolderNormalizeResult => {
  const name = normalizeSingleLine(input.name)
  if (!name) return { ok: false, error: '格子名称不能为空' }
  if (name.length > MAX_STASH_FOLDER_NAME_LENGTH) return { ok: false, error: `格子名称超过 ${MAX_STASH_FOLDER_NAME_LENGTH} 字上限` }

  const icon = normalizeSingleLine(input.icon)
  if (icon.length > 8) return { ok: false, error: '图标只放一个 emoji' }

  const description = normalizeMultiline(input.description)
  if (description.length > MAX_STASH_FOLDER_DESCRIPTION_LENGTH) return { ok: false, error: `格子说明超过 ${MAX_STASH_FOLDER_DESCRIPTION_LENGTH} 字上限` }

  const parentId = normalizeSingleLine(input.parent_id)
  const sortOrder = Number.isFinite(input.sort_order ?? 0) ? Math.trunc(input.sort_order ?? 0) : 0

  return {
    ok: true,
    row: {
      name,
      icon: icon || null,
      description: description || null,
      parent_id: parentId || null,
      sort_order: sortOrder,
    },
  }
}

// ── 粮食 ─────────────────────────────────────────────────────────────────────

export type StashItemInput = {
  title?: string | null
  url?: string | null
  content?: string | null
  tags?: string[] | null
  folder_id?: string | null
  added_by?: StashAdder | string | null
  status?: StashStatus | string | null
  metadata?: Record<string, unknown> | null
}

export type StashItemRow = {
  folder_id: string | null
  title: string
  url: string | null
  url_key: string | null
  content: string | null
  tags: string[]
  added_by: StashAdder
  status: StashStatus
  metadata: Record<string, unknown>
}

export type StashItemNormalizeResult =
  | { ok: true; row: StashItemRow }
  | { ok: false; error: string }

export const normalizeStashItemInput = (input: StashItemInput): StashItemNormalizeResult => {
  const addedBy = (input.added_by ?? DEFAULT_STASH_ADDER) as StashAdder
  if (!STASH_ADDERS.includes(addedBy)) return { ok: false, error: `added_by 必须是 ${STASH_ADDERS.join(' / ')} 之一` }

  const status = (input.status ?? DEFAULT_STASH_STATUS) as StashStatus
  if (!STASH_STATUSES.includes(status)) return { ok: false, error: `status 必须是 ${STASH_STATUSES.join(' / ')} 之一` }

  let url: string | null = null
  let urlKey: string | null = null
  if (normalizeSingleLine(input.url)) {
    const normalizedUrl = normalizeStashUrl(input.url)
    if (!normalizedUrl.ok) return normalizedUrl
    url = normalizedUrl.url
    urlKey = normalizedUrl.url_key
  }

  const content = normalizeMultiline(input.content)
  if (content.length > MAX_STASH_CONTENT_LENGTH) return { ok: false, error: `正文超过 ${MAX_STASH_CONTENT_LENGTH} 字上限` }
  if (!url && !content) return { ok: false, error: '链接和正文至少要有一样' }

  let title = normalizeSingleLine(input.title)
  if (!title && url) title = deriveStashTitleFromUrl(url)
  if (!title) return { ok: false, error: '没有链接时必须写标题' }
  if (title.length > MAX_STASH_TITLE_LENGTH) return { ok: false, error: `标题超过 ${MAX_STASH_TITLE_LENGTH} 字上限` }

  const tags = normalizeStashTags(input.tags)
  if (tags.length > MAX_STASH_TAGS) return { ok: false, error: `标签最多 ${MAX_STASH_TAGS} 个` }

  const folderId = normalizeSingleLine(input.folder_id)
  const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {}

  return {
    ok: true,
    row: {
      folder_id: folderId || null,
      title,
      url,
      url_key: urlKey,
      content: content || null,
      tags,
      added_by: addedBy,
      status,
      metadata,
    },
  }
}

// ── 留言 ─────────────────────────────────────────────────────────────────────

export type StashCommentInput = {
  author: StashAdder | string
  content: string
}

export type StashCommentNormalizeResult =
  | { ok: true; comment: { author: StashAdder; content: string } }
  | { ok: false; error: string }

export const normalizeStashCommentInput = (input: StashCommentInput): StashCommentNormalizeResult => {
  const author = input.author as StashAdder
  if (!STASH_ADDERS.includes(author)) return { ok: false, error: `author 必须是 ${STASH_ADDERS.join(' / ')} 之一` }
  const content = normalizeMultiline(input.content)
  if (!content) return { ok: false, error: '留言不能为空' }
  if (content.length > MAX_STASH_COMMENT_LENGTH) return { ok: false, error: `留言超过 ${MAX_STASH_COMMENT_LENGTH} 字上限` }
  return { ok: true, comment: { author, content } }
}
