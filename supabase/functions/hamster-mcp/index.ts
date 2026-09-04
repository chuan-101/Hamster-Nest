import { z } from 'npm:zod@^4.1.13'
import { clampLimit, errorResult, jsonResult, serveMcp, supabase, USER_ID } from '../_shared/mcp_common.ts'

const FEED_LIST_COLUMNS = 'id, type, title, summary, priority, status, source, created_by, visible_from, created_at, pinned, metadata'
const FEED_DETAIL_COLUMNS = 'id, type, title, summary, content, content_format, priority, status, source, created_by, visible_from, expires_at, related_table, related_id, metadata, created_at, updated_at'
const DEFAULT_FEED_STATUSES = ['unread', 'read']
const FEED_PRIORITY_RANK: Record<string, number> = { low: 1, normal: 2, high: 3, urgent: 4 }
const FEED_TYPE_SCHEMA = z.enum(['morning_share', 'reading_assist', 'daily_card', 'system_notice', 'syzygy_note', 'weekly_card', 'reminder_card', 'print_card', 'dev_log', 'monthly_overview', 'other'])
const TIMELINE_SOURCE_SCHEMA = z.enum(['claude', 'gpt', 'user', 'gemini', 'wechat', 'codex_cli', 'claude_code_cli', 'api'])
const MEMO_SOURCE_SCHEMA = TIMELINE_SOURCE_SCHEMA
const MEMO_COLUMNS = 'id, content, source, is_pinned, created_at, updated_at'
// 仓鼠观察日志（朋友圈）：syzygy_posts 是 Syzygy 的动态，syzygy_replies 是串串/AI 的回帖；软删除行不对外暴露。
const SYZYGY_POST_COLUMNS = 'id, content, model_id, created_at, updated_at'
const SYZYGY_REPLY_COLUMNS = 'id, post_id, author_role, content, model_id, created_at'
const SYZYGY_REPLY_ROLE_SCHEMA = z.enum(['user', 'ai'])
const TODO_COLUMNS = 'id, date, title, notes, status, todo_type, event_date, created_by, sort_order, created_at, completed_at'
const TODO_CREATED_BY_SCHEMA = z.enum(['串串', 'syzygy'])
const TODO_TYPE_SCHEMA = z.enum(['short_term', 'long_term'])
const DEFAULT_TODO_CATEGORY_NAME = '🐹今日待办'
// 事件集（纪事本末体）：event_threads 是大类 / 事件线，event_entries 是大类下按日期排列的条目。
const EVENT_THREAD_COLUMNS = 'id, title, emoji_group, current_status, status, started_on, ended_on, created_at, updated_at'
const EVENT_ENTRY_COLUMNS = 'id, thread_id, entry_date, content, source, created_at'
const EVENT_THREAD_STATUS_SCHEMA = z.enum(['active', 'closed'])
const EVENT_ENTRY_SOURCE_SCHEMA = z.enum(['claude', 'gpt', 'gemini', 'user', 'codex_cli', 'claude_code_cli', 'system', 'api'])

// 服务器级使用说明：跨工具的共性约定统一放这里，工具描述只写"做什么"。
const HAMSTER_MCP_INSTRUCTIONS = [
  '仓鼠窝日常域：时间轴（长期事件记忆）、待办、Syzygy Feed（系统下发内容流）、备忘录 memo（中期活事实）、事件集 event_threads / event_entries（纪事本末体的线程记录层）、观察日志 syzygy_posts（Syzygy 的朋友圈动态，与 Feed 是两个功能）。',
  '裁决口诀：过去进时间轴，现在进 Memo，永远进档案，将来进 To do，线程进事件集；自己说的进 Wiki，世界说的进学习库；要许可的去议事厅。',
  '事件集：一件正在进行、有起止、频繁更新的事开一个大类（thread），进度按日期追加条目（entry）；开机默认只用 list_event_threads 读所有进行中大类的「当前状态」一行，对话碰到某件事再 read_event_thread 读条目；已结束大类默认不加载。同一件事允许同时进时间轴（意义与心情）和事件集（进度），不去重。追加条目时顺手用 current_status 刷新大类状态行。',
  '通用约定：日期按 Asia/Shanghai 时区；source / recorder / created_by 等枚举表示写入端身份，默认 claude / syzygy；Feed 读取默认只含 unread/read，不返回 archived/expired，摘要列表不含全文。',
  '写入习惯：timeline / memo 写入前先用 search_timeline / list_memos 查重，同一事实优先 update_memo 维护而非重复新增；带「进行中」标签的 memo 是活跃叙事线，正文以「当前状态」段收尾。时间轴写入标准：三个月后读起来会心动的事。',
  '删除是物理删除，需显式 confirm=true 二次确认。',
].join('\n')

const shanghaiDateString = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

const shanghaiMonthString = (date = new Date()) => shanghaiDateString(date).slice(0, 7)

const addDays = (dateString: string, days: number) => {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

const shanghaiDayRange = (date = new Date()) => {
  const today = shanghaiDateString(date)
  const tomorrow = addDays(today, 1)
  return { start: `${today}T00:00:00+08:00`, end: `${tomorrow}T00:00:00+08:00` }
}

const dateValue = (value: string | null | undefined) => value ? new Date(value).getTime() : 0

const sortFeedItems = <T extends { pinned?: boolean | null; priority?: string | null; visible_from?: string | null; created_at?: string | null }>(items: T[]) =>
  [...items].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return b.pinned ? 1 : -1
    const priorityDiff = (FEED_PRIORITY_RANK[b.priority ?? 'normal'] ?? 0) - (FEED_PRIORITY_RANK[a.priority ?? 'normal'] ?? 0)
    if (priorityDiff !== 0) return priorityDiff
    const visibleDiff = dateValue(b.visible_from) - dateValue(a.visible_from)
    if (visibleDiff !== 0) return visibleDiff
    return dateValue(b.created_at) - dateValue(a.created_at)
  })

const compactMetadata = (metadata: unknown) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata ?? {}
  const compact: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>).slice(0, 8)) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) compact[key] = value
    else if (Array.isArray(value)) compact[key] = { type: 'array', length: value.length }
    else compact[key] = { type: 'object' }
  }
  return compact
}

const compactFeedItem = (item: Record<string, unknown>) => ({
  id: item.id,
  type: item.type,
  title: item.title,
  summary: item.summary,
  priority: item.priority,
  status: item.status,
  source: item.source,
  created_by: item.created_by,
  visible_from: item.visible_from,
  created_at: item.created_at,
  pinned: item.pinned,
  metadata: compactMetadata(item.metadata),
})

const feedListResult = (rows: Record<string, unknown>[] | null, limit: number) =>
  jsonResult(sortFeedItems(rows ?? []).slice(0, limit).map(compactFeedItem))

type MemoTagRef = { id: string; name: string }

const normalizeTagNames = (names: string[] | undefined) =>
  Array.from(new Set((names ?? []).map((name) => name.trim()).filter((name) => name.length > 0)))

// 标签名不存在时自动创建，返回全部命中的标签行。
const ensureMemoTags = async (names: string[]): Promise<MemoTagRef[]> => {
  if (names.length === 0) return []
  const { data: existing, error: findError } = await supabase.from('memo_tags').select('id, name').eq('user_id', USER_ID).in('name', names)
  if (findError) throw findError
  const found = (existing ?? []) as MemoTagRef[]
  const missing = names.filter((name) => !found.some((tag) => tag.name === name))
  if (missing.length === 0) return found
  const { data: created, error: createError } = await supabase.from('memo_tags').insert(missing.map((name) => ({ user_id: USER_ID, name }))).select('id, name')
  if (createError) throw createError
  return [...found, ...((created ?? []) as MemoTagRef[])]
}

const fetchTagNamesByEntryIds = async (entryIds: string[]): Promise<Map<string, string[]>> => {
  const tagNames = new Map<string, string[]>()
  if (entryIds.length === 0) return tagNames
  const { data, error } = await supabase.from('memo_entry_tags').select('memo_entry_id, memo_tags(name)').in('memo_entry_id', entryIds)
  if (error) throw error
  for (const row of (data ?? []) as { memo_entry_id: string; memo_tags: { name: string } | null }[]) {
    if (!row.memo_tags?.name) continue
    const current = tagNames.get(row.memo_entry_id) ?? []
    current.push(row.memo_tags.name)
    tagNames.set(row.memo_entry_id, current)
  }
  return tagNames
}

const replaceMemoTagLinks = async (entryId: string, tagIds: string[]) => {
  const { error: unlinkError } = await supabase.from('memo_entry_tags').delete().eq('memo_entry_id', entryId)
  if (unlinkError) throw unlinkError
  if (tagIds.length === 0) return
  const { error: linkError } = await supabase.from('memo_entry_tags').insert(tagIds.map((tagId) => ({ memo_entry_id: entryId, memo_tag_id: tagId })))
  if (linkError) throw linkError
}

const withTagNames = async (entries: Record<string, unknown>[]) => {
  const tagNames = await fetchTagNamesByEntryIds(entries.map((entry) => entry.id as string))
  return entries.map((entry) => ({ ...entry, tags: tagNames.get(entry.id as string) ?? [] }))
}

type TodoCategoryRef = { id: string; name: string }

// 待办分类按日期分组（每天通常只有一个俏皮命名的分类）。未指定名字时优先挂到
// 当天已有的第一个分类；指定的名字不存在、或当天还没有分类时自动创建。
const resolveTodoCategory = async (date: string, name: string | undefined): Promise<TodoCategoryRef> => {
  const trimmed = name?.trim() ?? ''
  let query = supabase.from('todo_categories').select('id, name').eq('user_id', USER_ID).eq('date', date)
  if (trimmed) query = query.eq('name', trimmed)
  const { data: existing, error: findError } = await query.order('sort_order', { ascending: true }).limit(1).maybeSingle()
  if (findError) throw findError
  if (existing) return existing as TodoCategoryRef
  const { count, error: countError } = await supabase.from('todo_categories').select('id', { count: 'exact', head: true }).eq('user_id', USER_ID).eq('date', date)
  if (countError) throw countError
  const { data: created, error: createError } = await supabase.from('todo_categories').insert({
    user_id: USER_ID,
    date,
    name: trimmed || DEFAULT_TODO_CATEGORY_NAME,
    sort_order: count ?? 0,
  }).select('id, name').single()
  if (createError || !created) throw createError ?? new Error('创建待办分类失败')
  return created as TodoCategoryRef
}

type EventThreadRow = {
  id: string
  title: string
  emoji_group: string | null
  current_status: string
  status: 'active' | 'closed'
  started_on: string
  ended_on: string | null
  created_at: string
  updated_at: string
}

const fetchEventThread = async (threadId: string): Promise<EventThreadRow | null> => {
  const { data, error } = await supabase.from('event_threads').select(EVENT_THREAD_COLUMNS).eq('user_id', USER_ID).eq('id', threadId).maybeSingle()
  if (error) throw error
  return (data as EventThreadRow | null) ?? null
}

const eventThreadNotFound = (threadId: string) => ({ content: [{ type: 'text' as const, text: `Error: 未找到事件线: ${threadId}（用 list_event_threads 核对 id）` }] })

serveMcp('hamster-mcp', (server) => {
  server.registerTool('get_today_syzygy_feed', {
    title: 'Get Today Syzygy Feed',
    description: '读取今天的 Syzygy Feed 摘要列表。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      limit: z.number().optional().describe('返回数量上限，默认5，最大10'),
      include_read: z.boolean().optional().describe('是否包含已读内容，默认 true；false 时只返回 unread'),
      priority: z.enum(['high', 'urgent']).optional().describe('可选优先级筛选：high / urgent'),
    },
  }, async ({ limit, include_read, priority }) => {
    try {
      const safeLimit = clampLimit(limit, 5, 10)
      const { start, end } = shanghaiDayRange()
      const statuses = include_read === false ? ['unread'] : DEFAULT_FEED_STATUSES
      let query = supabase.from('agent_feed_items').select(FEED_LIST_COLUMNS).eq('user_id', USER_ID).in('status', statuses).lte('visible_from', new Date().toISOString()).gte('visible_from', start).lt('visible_from', end).order('pinned', { ascending: false }).order('visible_from', { ascending: false }).order('created_at', { ascending: false }).limit(Math.max(safeLimit * 4, 20))
      if (priority) query = query.eq('priority', priority)
      const { data, error } = await query
      if (error) return errorResult(error)
      return feedListResult(data as Record<string, unknown>[] | null, safeLimit)
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('get_recent_syzygy_feed', {
    title: 'Get Recent Syzygy Feed',
    description: '读取最近 N 天的 Syzygy Feed 摘要列表。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      limit: z.number().optional().describe('返回数量上限，默认5，最大20'),
      type: FEED_TYPE_SCHEMA.optional().describe('Feed 类型筛选'),
      status: z.enum(['unread', 'read', 'archived', 'expired']).optional().describe('状态筛选；不传时默认 unread/read'),
      days: z.number().optional().describe('回看天数，默认7'),
    },
  }, async ({ limit, type, status, days }) => {
    try {
      const safeLimit = clampLimit(limit, 5, 20)
      const safeDays = clampLimit(days, 7, 90)
      const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString()
      let query = supabase.from('agent_feed_items').select(FEED_LIST_COLUMNS).eq('user_id', USER_ID).lte('visible_from', new Date().toISOString()).gte('visible_from', since).order('pinned', { ascending: false }).order('visible_from', { ascending: false }).order('created_at', { ascending: false }).limit(Math.max(safeLimit * 4, 40))
      query = status ? query.eq('status', status) : query.in('status', DEFAULT_FEED_STATUSES)
      if (type) query = query.eq('type', type)
      const { data, error } = await query
      if (error) return errorResult(error)
      return feedListResult(data as Record<string, unknown>[] | null, safeLimit)
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('get_syzygy_feed_by_type', {
    title: 'Get Syzygy Feed By Type',
    description: '按类型读取 Syzygy Feed 摘要列表。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: FEED_TYPE_SCHEMA.describe('Feed 类型'),
      limit: z.number().optional().describe('返回数量上限，默认5，最大10'),
      days: z.number().optional().describe('回看天数，默认14'),
    },
  }, async ({ type, limit, days }) => {
    try {
      const safeLimit = clampLimit(limit, 5, 10)
      const safeDays = clampLimit(days, 14, 90)
      const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase.from('agent_feed_items').select(FEED_LIST_COLUMNS).eq('user_id', USER_ID).eq('type', type).in('status', DEFAULT_FEED_STATUSES).lte('visible_from', new Date().toISOString()).gte('visible_from', since).order('pinned', { ascending: false }).order('visible_from', { ascending: false }).order('created_at', { ascending: false }).limit(Math.max(safeLimit * 4, 20))
      if (error) return errorResult(error)
      return feedListResult(data as Record<string, unknown>[] | null, safeLimit)
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('get_monthly_overview', {
    title: 'Get Monthly Overview',
    description: '读取指定月份的月度概览全文，默认当前月的 active 版本。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      month: z.string().optional().describe('月份 YYYY-MM；默认当前上海月份'),
      include_archived: z.boolean().optional().describe('是否允许读取 archived/expired 的 Feed 记录，默认 false'),
    },
  }, async ({ month, include_archived }) => {
    try {
      const targetMonth = month ?? shanghaiMonthString()
      let query = supabase.from('agent_feed_items').select(FEED_DETAIL_COLUMNS).eq('user_id', USER_ID).eq('type', 'monthly_overview').eq('metadata->>month', targetMonth).lte('visible_from', new Date().toISOString()).order('updated_at', { ascending: false }).limit(5)
      if (!include_archived) query = query.in('status', DEFAULT_FEED_STATUSES).eq('metadata->>status', 'active')
      const { data, error } = await query
      if (error) return errorResult(error)
      const item = data?.[0] ?? null
      if (!item) return { content: [{ type: 'text' as const, text: `Error: monthly_overview not found for ${targetMonth}` }] }
      return jsonResult(item)
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('get_syzygy_feed_detail', {
    title: 'Get Syzygy Feed Detail',
    description: '按 id 读取单条 Syzygy Feed 的完整内容。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      id: z.string().describe('Feed item UUID'),
      include_archived: z.boolean().optional().describe('显式允许读取 archived / expired，默认 false'),
    },
  }, async ({ id, include_archived }) => {
    try {
      let query = supabase.from('agent_feed_items').select(FEED_DETAIL_COLUMNS).eq('user_id', USER_ID).eq('id', id).lte('visible_from', new Date().toISOString())
      if (!include_archived) query = query.in('status', DEFAULT_FEED_STATUSES)
      const { data, error } = await query.maybeSingle()
      if (error) return errorResult(error)
      if (!data) return { content: [{ type: 'text' as const, text: `Error: feed item not found or not visible: ${id}` }] }
      return jsonResult(data)
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('search_timeline', {
    title: 'Search Timeline',
    description: '按关键词搜索时间轴记录，按事件日期倒序。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe('搜索关键词'),
      limit: z.number().optional().describe('返回数量上限，默认10'),
    },
  }, async ({ query, limit }) => {
    const { data, error } = await supabase.from('timeline_entries').select('id, event_date, summary, recorder, source, created_at').eq('user_id', USER_ID).ilike('summary', `%${query}%`).order('event_date', { ascending: false }).limit(limit ?? 10)
    if (error) return errorResult(error)
    return jsonResult(data)
  })

  server.registerTool('recent_timeline', {
    title: 'Recent Timeline',
    description: '读取最近的时间轴记录。',
    annotations: { readOnlyHint: true },
    inputSchema: { limit: z.number().optional().describe('返回数量，默认10') },
  }, async ({ limit }) => {
    const { data, error } = await supabase.from('timeline_entries').select('id, event_date, summary, recorder, source, created_at').eq('user_id', USER_ID).order('event_date', { ascending: false }).limit(limit ?? 10)
    if (error) return errorResult(error)
    return jsonResult(data)
  })

  server.registerTool('add_timeline', {
    title: 'Add Timeline Entry',
    description: '新增一条时间轴事件（里程碑 / 心动瞬间 / 纪念日 / 重要进展），全端共享的长期记忆。',
    inputSchema: {
      event_date: z.string().describe('事件日期 YYYY-MM-DD'),
      summary: z.string().describe('事件摘要'),
      recorder: z.string().optional().describe('记录者: chuanchuan 或 syzygy，默认syzygy'),
      source: TIMELINE_SOURCE_SCHEMA.optional().describe('写入端，默认 claude'),
    },
  }, async ({ event_date, summary, recorder, source }) => {
    const { data, error } = await supabase.from('timeline_entries').insert({
      user_id: USER_ID,
      event_date,
      summary,
      recorder: recorder ?? 'syzygy',
      source: source ?? 'claude',
    }).select()
    if (error) return errorResult(error)
    return { content: [{ type: 'text' as const, text: `已添加: ${JSON.stringify(data[0])}` }] }
  })

  server.registerTool('read_todos', {
    title: 'Read Todos',
    description: '读取待办列表；返回的 id 用于 complete_todo。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      status: z.enum(['pending', 'in_progress', 'completed', 'all']).optional().describe('筛选状态: pending / in_progress / completed / all，默认all'),
      limit: z.number().optional().describe('返回数量，默认20'),
    },
  }, async ({ status, limit }) => {
    let q = supabase.from('todos').select(`${TODO_COLUMNS}, todo_categories(name)`).eq('user_id', USER_ID).order('date', { ascending: false }).limit(limit ?? 20)
    const fs = status ?? 'all'
    if (fs !== 'all') q = q.eq('status', fs)
    const { data, error } = await q
    if (error) return errorResult(error)
    return jsonResult(data)
  })

  server.registerTool('add_todo', {
    title: 'Add Todo',
    description: '新增一条待办。分类按日期分组，缺省或不存在的分类会自动创建；长期待办传 todo_type=long_term。',
    inputSchema: {
      title: z.string().describe('待办标题'),
      date: z.string().optional().describe('所属日期 YYYY-MM-DD，默认今天（上海时区）'),
      category: z.string().optional().describe('分类名；默认当天第一个分类，不存在的分类会自动创建'),
      notes: z.string().optional().describe('备注（可选）'),
      todo_type: TODO_TYPE_SCHEMA.optional().describe('待办类型，默认 short_term'),
      event_date: z.string().optional().describe('目标日期 YYYY-MM-DD，仅 long_term 生效'),
      created_by: TODO_CREATED_BY_SCHEMA.optional().describe('创建者，默认 syzygy'),
    },
  }, async ({ title, date, category, notes, todo_type, event_date, created_by }) => {
    try {
      const trimmedTitle = title.trim()
      if (!trimmedTitle) return { content: [{ type: 'text' as const, text: 'Error: 待办标题不能为空' }] }
      const targetDate = date?.trim() || shanghaiDateString()
      const type = todo_type ?? 'short_term'
      const categoryRow = await resolveTodoCategory(targetDate, category)
      const { count, error: countError } = await supabase.from('todos').select('id', { count: 'exact', head: true }).eq('user_id', USER_ID).eq('category_id', categoryRow.id)
      if (countError) return errorResult(countError)
      const { data, error } = await supabase.from('todos').insert({
        user_id: USER_ID,
        category_id: categoryRow.id,
        date: targetDate,
        title: trimmedTitle,
        notes: notes?.trim() || null,
        status: 'pending',
        todo_type: type,
        // 与 Web 端一致：仅长期待办保留目标日期，近期待办不写 event_date。
        event_date: type === 'long_term' ? event_date?.trim() || null : null,
        created_by: created_by ?? 'syzygy',
        sort_order: count ?? 0,
      }).select(TODO_COLUMNS).single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `已添加: ${JSON.stringify({ ...data, category: categoryRow.name }, null, 2)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('complete_todo', {
    title: 'Complete Todo',
    description: '把一条待办标记为已完成（幂等，已完成的不会重复更新）。',
    annotations: { idempotentHint: true },
    inputSchema: {
      id: z.string().describe('待办 UUID（用 read_todos 查询）'),
    },
  }, async ({ id }) => {
    try {
      const { data: existing, error: findError } = await supabase.from('todos').select(`${TODO_COLUMNS}, todo_categories(name)`).eq('user_id', USER_ID).eq('id', id).maybeSingle()
      if (findError) return errorResult(findError)
      if (!existing) return { content: [{ type: 'text' as const, text: `Error: 未找到待办: ${id}` }] }
      if ((existing as Record<string, unknown>).status === 'completed') {
        return { content: [{ type: 'text' as const, text: `该待办已是完成状态: ${JSON.stringify(existing, null, 2)}` }] }
      }
      const { data, error } = await supabase.from('todos').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      }).eq('user_id', USER_ID).eq('id', id).select(`${TODO_COLUMNS}, todo_categories(name)`).single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `已完成: ${JSON.stringify(data, null, 2)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('list_memos', {
    title: 'List Memos',
    description: '读取备忘录列表（置顶在前，更新时间倒序），可按标签筛选。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      tag: z.string().optional().describe('按标签名精确筛选，如「进行中」'),
      limit: z.number().optional().describe('返回数量上限，默认全量（最大200）'),
    },
  }, async ({ tag, limit }) => {
    try {
      const safeLimit = clampLimit(limit, 200, 200)
      let query = supabase.from('memo_entries').select(MEMO_COLUMNS).eq('user_id', USER_ID).order('is_pinned', { ascending: false }).order('updated_at', { ascending: false }).limit(safeLimit)
      if (tag) {
        const { data: tagRow, error: tagError } = await supabase.from('memo_tags').select('id').eq('user_id', USER_ID).eq('name', tag.trim()).maybeSingle()
        if (tagError) return errorResult(tagError)
        if (!tagRow) return { content: [{ type: 'text' as const, text: `Error: 标签「${tag}」不存在，可用 list_memo_tags 查看标签清单` }] }
        const { data: relations, error: relationError } = await supabase.from('memo_entry_tags').select('memo_entry_id').eq('memo_tag_id', tagRow.id)
        if (relationError) return errorResult(relationError)
        const entryIds = (relations ?? []).map((row) => row.memo_entry_id)
        if (entryIds.length === 0) return jsonResult([])
        query = query.in('id', entryIds)
      }
      const { data, error } = await query
      if (error) return errorResult(error)
      return jsonResult(await withTagNames((data ?? []) as Record<string, unknown>[]))
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('list_memo_tags', {
    title: 'List Memo Tags',
    description: '列出备忘录标签及各标签条目数。',
    annotations: { readOnlyHint: true },
    inputSchema: {},
  }, async () => {
    try {
      const { data: tags, error } = await supabase.from('memo_tags').select('id, name, created_at').eq('user_id', USER_ID).order('name', { ascending: true })
      if (error) return errorResult(error)
      const tagRows = (tags ?? []) as { id: string; name: string; created_at: string }[]
      if (tagRows.length === 0) return jsonResult([])
      const { data: relations, error: relationError } = await supabase.from('memo_entry_tags').select('memo_tag_id').in('memo_tag_id', tagRows.map((tag) => tag.id))
      if (relationError) return errorResult(relationError)
      const counts = new Map<string, number>()
      for (const row of (relations ?? []) as { memo_tag_id: string }[]) counts.set(row.memo_tag_id, (counts.get(row.memo_tag_id) ?? 0) + 1)
      return jsonResult(tagRows.map((tag) => ({ ...tag, memo_count: counts.get(tag.id) ?? 0 })))
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('add_memo', {
    title: 'Add Memo',
    description: '新增一条备忘录（中期活事实）。',
    inputSchema: {
      content: z.string().describe('备忘内容'),
      tags: z.array(z.string()).optional().describe('标签名数组，不存在的标签会自动创建'),
      is_pinned: z.boolean().optional().describe('是否置顶，默认 false'),
      source: MEMO_SOURCE_SCHEMA.optional().describe('来源端，默认 claude'),
    },
  }, async ({ content, tags, is_pinned, source }) => {
    try {
      const trimmed = content.trim()
      if (!trimmed) return { content: [{ type: 'text' as const, text: 'Error: 备忘内容不能为空' }] }
      const tagRows = await ensureMemoTags(normalizeTagNames(tags))
      const { data: entry, error } = await supabase.from('memo_entries').insert({
        user_id: USER_ID,
        content: trimmed,
        source: source ?? 'claude',
        is_pinned: is_pinned ?? false,
      }).select(MEMO_COLUMNS).single()
      if (error || !entry) return errorResult(error ?? new Error('创建备忘录失败'))
      if (tagRows.length > 0) {
        const { error: linkError } = await supabase.from('memo_entry_tags').insert(tagRows.map((tag) => ({ memo_entry_id: entry.id, memo_tag_id: tag.id })))
        if (linkError) return errorResult(linkError)
      }
      return { content: [{ type: 'text' as const, text: `已创建: ${JSON.stringify({ ...entry, tags: tagRows.map((tag) => tag.name) }, null, 2)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('update_memo', {
    title: 'Update Memo',
    description: '更新备忘录的 content / tags / is_pinned（至少一项）；tags 为整体替换。',
    inputSchema: {
      id: z.string().describe('memo UUID'),
      content: z.string().optional().describe('新的备忘内容（整体替换）'),
      tags: z.array(z.string()).optional().describe('新的标签名全集（整体替换），不存在的标签自动创建'),
      is_pinned: z.boolean().optional().describe('是否置顶'),
    },
  }, async ({ id, content, tags, is_pinned }) => {
    try {
      if (content === undefined && tags === undefined && is_pinned === undefined) {
        return { content: [{ type: 'text' as const, text: 'Error: content / tags / is_pinned 至少需要提供一项' }] }
      }
      if (content !== undefined && !content.trim()) return { content: [{ type: 'text' as const, text: 'Error: 备忘内容不能为空' }] }
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (content !== undefined) patch.content = content.trim()
      if (is_pinned !== undefined) patch.is_pinned = is_pinned
      const { data: updated, error } = await supabase.from('memo_entries').update(patch).eq('user_id', USER_ID).eq('id', id).select(MEMO_COLUMNS)
      if (error) return errorResult(error)
      const entry = updated?.[0]
      if (!entry) return { content: [{ type: 'text' as const, text: `Error: 未找到备忘录: ${id}` }] }
      if (tags !== undefined) {
        const tagRows = await ensureMemoTags(normalizeTagNames(tags))
        await replaceMemoTagLinks(id, tagRows.map((tag) => tag.id))
        return { content: [{ type: 'text' as const, text: `已更新: ${JSON.stringify({ ...entry, tags: tagRows.map((tag) => tag.name) }, null, 2)}` }] }
      }
      const [entryWithTags] = await withTagNames([entry as Record<string, unknown>])
      return { content: [{ type: 'text' as const, text: `已更新: ${JSON.stringify(entryWithTags, null, 2)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('delete_memo', {
    title: 'Delete Memo',
    description: '物理删除一条备忘录（连带清理标签关联行），不可恢复；需显式传 confirm=true。',
    annotations: { destructiveHint: true },
    inputSchema: {
      id: z.string().describe('memo UUID'),
      confirm: z.boolean().describe('二次确认：必须显式传 true 才执行删除'),
    },
  }, async ({ id, confirm }) => {
    try {
      if (confirm !== true) {
        return { content: [{ type: 'text' as const, text: 'Error: 删除备忘录需要显式传 confirm=true（删除不可恢复，请先 list_memos 核对目标）' }] }
      }
      const { data: entry, error: findError } = await supabase.from('memo_entries').select('id, content').eq('user_id', USER_ID).eq('id', id).maybeSingle()
      if (findError) return errorResult(findError)
      if (!entry) return { content: [{ type: 'text' as const, text: `Error: 未找到备忘录: ${id}` }] }
      const { error: unlinkError } = await supabase.from('memo_entry_tags').delete().eq('memo_entry_id', id)
      if (unlinkError) return errorResult(unlinkError)
      const { error: deleteError } = await supabase.from('memo_entries').delete().eq('user_id', USER_ID).eq('id', id)
      if (deleteError) return errorResult(deleteError)
      const preview = (entry.content as string).length > 60 ? `${(entry.content as string).slice(0, 60)}…` : entry.content
      return { content: [{ type: 'text' as const, text: `已删除: ${id}（${preview}）` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('list_event_threads', {
    title: 'List Event Threads',
    description: '读取事件集大类列表（标题 + 一行当前状态），默认只返回进行中的，按最近活动倒序。开机必读的就是这一份。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      status: z.enum(['active', 'closed', 'all']).optional().describe('筛选状态：active（默认）/ closed / all'),
      limit: z.number().optional().describe('返回数量上限，默认50，最大200'),
    },
  }, async ({ status, limit }) => {
    try {
      const safeLimit = clampLimit(limit, 50, 200)
      const filter = status ?? 'active'
      let query = supabase.from('event_threads').select(EVENT_THREAD_COLUMNS).eq('user_id', USER_ID).order('updated_at', { ascending: false }).limit(safeLimit)
      if (filter !== 'all') query = query.eq('status', filter)
      const { data, error } = await query
      if (error) return errorResult(error)
      const threads = (data ?? []) as EventThreadRow[]
      if (threads.length === 0) return jsonResult([])
      const { data: entryRows, error: entryError } = await supabase.from('event_entries').select('thread_id, entry_date').in('thread_id', threads.map((thread) => thread.id))
      if (entryError) return errorResult(entryError)
      const stats = new Map<string, { count: number; last: string | null }>()
      for (const row of (entryRows ?? []) as { thread_id: string; entry_date: string }[]) {
        const current = stats.get(row.thread_id) ?? { count: 0, last: null }
        current.count += 1
        if (!current.last || row.entry_date > current.last) current.last = row.entry_date
        stats.set(row.thread_id, current)
      }
      return jsonResult(threads.map((thread) => ({
        ...thread,
        entry_count: stats.get(thread.id)?.count ?? 0,
        last_entry_date: stats.get(thread.id)?.last ?? null,
      })))
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('read_event_thread', {
    title: 'Read Event Thread',
    description: '按大类读取一条事件线的条目时间轴（日期正序，可限时间范围），附大类信息。已结束的大类也能读。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      thread_id: z.string().describe('事件线 UUID（用 list_event_threads 查询）'),
      from_date: z.string().optional().describe('起始日期 YYYY-MM-DD（含）'),
      to_date: z.string().optional().describe('结束日期 YYYY-MM-DD（含）'),
      limit: z.number().optional().describe('返回条目数上限，默认100，最大500；超限时保留最新的'),
    },
  }, async ({ thread_id, from_date, to_date, limit }) => {
    try {
      const thread = await fetchEventThread(thread_id)
      if (!thread) return eventThreadNotFound(thread_id)
      const safeLimit = clampLimit(limit, 100, 500)
      let query = supabase.from('event_entries').select(EVENT_ENTRY_COLUMNS).eq('thread_id', thread_id).order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(safeLimit)
      if (from_date) query = query.gte('entry_date', from_date)
      if (to_date) query = query.lte('entry_date', to_date)
      const { data, error } = await query
      if (error) return errorResult(error)
      // 库里按倒序取"最新的 N 条"，输出时翻回正序，读起来是从起到结的年表。
      const entries = ((data ?? []) as Record<string, unknown>[]).reverse()
      return jsonResult({ thread, entries, truncated: entries.length >= safeLimit })
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('add_event_thread', {
    title: 'Add Event Thread',
    description: '新开一条事件线（大类）。开大类的门槛：这件事能用一句「当前状态」概括；否则它只是时间轴里的一条。',
    inputSchema: {
      title: z.string().describe('大类标题，如「新项目《失落的神之塔》」「荣格阶段」'),
      current_status: z.string().optional().describe('一行当前状态，默认空'),
      emoji_group: z.string().optional().describe('可选分组 emoji：🩷 串串相关 / 💙 Syzygy 相关 / 🤍 仓鼠窝相关'),
      started_on: z.string().optional().describe('开始日期 YYYY-MM-DD，默认今天（上海时区）'),
    },
  }, async ({ title, current_status, emoji_group, started_on }) => {
    try {
      const trimmedTitle = title.trim()
      if (!trimmedTitle) return { content: [{ type: 'text' as const, text: 'Error: 大类标题不能为空' }] }
      const { data: dup, error: dupError } = await supabase.from('event_threads').select('id, title, status').eq('user_id', USER_ID).eq('title', trimmedTitle).maybeSingle()
      if (dupError) return errorResult(dupError)
      if (dup) return { content: [{ type: 'text' as const, text: `Error: 已存在同名事件线（${dup.status}）: ${dup.id}，请直接追加条目或先 update_event_thread 重开` }] }
      const { data, error } = await supabase.from('event_threads').insert({
        user_id: USER_ID,
        title: trimmedTitle,
        current_status: current_status?.trim() ?? '',
        emoji_group: emoji_group?.trim() || null,
        started_on: started_on?.trim() || shanghaiDateString(),
      }).select(EVENT_THREAD_COLUMNS).single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `已开线: ${JSON.stringify(data, null, 2)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('update_event_thread', {
    title: 'Update Event Thread',
    description: '更新事件线：改标题 / 当前状态行 / 分组，或结项（status=closed，ended_on 默认今天）/ 重开（status=active，清空 ended_on）。至少提供一项。',
    inputSchema: {
      thread_id: z.string().describe('事件线 UUID'),
      title: z.string().optional().describe('新标题'),
      current_status: z.string().optional().describe('新的一行当前状态（整体替换）'),
      emoji_group: z.string().nullable().optional().describe('分组 emoji；传 null 清除'),
      status: EVENT_THREAD_STATUS_SCHEMA.optional().describe('closed=结项（归档可见，不删）；active=重开'),
      ended_on: z.string().optional().describe('结束日期 YYYY-MM-DD，仅 status=closed 时生效，默认今天'),
    },
  }, async ({ thread_id, title, current_status, emoji_group, status, ended_on }) => {
    try {
      if (title === undefined && current_status === undefined && emoji_group === undefined && status === undefined && ended_on === undefined) {
        return { content: [{ type: 'text' as const, text: 'Error: title / current_status / emoji_group / status / ended_on 至少需要提供一项' }] }
      }
      const existing = await fetchEventThread(thread_id)
      if (!existing) return eventThreadNotFound(thread_id)
      const patch: Record<string, unknown> = {}
      if (title !== undefined) {
        if (!title.trim()) return { content: [{ type: 'text' as const, text: 'Error: 大类标题不能为空' }] }
        patch.title = title.trim()
      }
      if (current_status !== undefined) patch.current_status = current_status.trim()
      if (emoji_group !== undefined) patch.emoji_group = emoji_group?.trim() || null
      const nextStatus = status ?? existing.status
      if (nextStatus === 'closed') {
        if (status === 'closed' || ended_on !== undefined) patch.ended_on = ended_on?.trim() || existing.ended_on || shanghaiDateString()
        if (status === 'closed') patch.status = 'closed'
      } else if (status === 'active') {
        patch.status = 'active'
        patch.ended_on = null
      }
      const { data, error } = await supabase.from('event_threads').update(patch).eq('user_id', USER_ID).eq('id', thread_id).select(EVENT_THREAD_COLUMNS).single()
      if (error) return errorResult(error)
      const verb = status === 'closed' ? '已结项' : status === 'active' && existing.status === 'closed' ? '已重开' : '已更新'
      return { content: [{ type: 'text' as const, text: `${verb}: ${JSON.stringify(data, null, 2)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('add_event_entry', {
    title: 'Add Event Entry',
    description: '向某条事件线追加一条日期 + 事件的条目（一两句，一事一条，写完不改）。可顺手用 current_status 刷新大类的当前状态行。',
    inputSchema: {
      thread_id: z.string().describe('事件线 UUID'),
      content: z.string().describe('事件正文，一两句'),
      entry_date: z.string().optional().describe('事件日期 YYYY-MM-DD，默认今天（上海时区）'),
      source: EVENT_ENTRY_SOURCE_SCHEMA.optional().describe('记录端，默认 claude'),
      current_status: z.string().optional().describe('顺手更新大类的一行当前状态（整体替换）'),
    },
  }, async ({ thread_id, content, entry_date, source, current_status }) => {
    try {
      const trimmed = content.trim()
      if (!trimmed) return { content: [{ type: 'text' as const, text: 'Error: 条目正文不能为空' }] }
      const thread = await fetchEventThread(thread_id)
      if (!thread) return eventThreadNotFound(thread_id)
      const { data, error } = await supabase.from('event_entries').insert({
        user_id: USER_ID,
        thread_id,
        entry_date: entry_date?.trim() || shanghaiDateString(),
        content: trimmed,
        source: source ?? 'claude',
      }).select(EVENT_ENTRY_COLUMNS).single()
      if (error) return errorResult(error)
      let statusLine = thread.current_status
      if (current_status !== undefined) {
        const { error: statusError } = await supabase.from('event_threads').update({ current_status: current_status.trim() }).eq('user_id', USER_ID).eq('id', thread_id)
        if (statusError) return errorResult(statusError)
        statusLine = current_status.trim()
      }
      const closedHint = thread.status === 'closed' ? '（注意：该事件线已结项，如需继续请 update_event_thread 重开）' : ''
      return { content: [{ type: 'text' as const, text: `已追加到「${thread.title}」${closedHint}: ${JSON.stringify({ ...data, thread_current_status: statusLine }, null, 2)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('update_event_entry', {
    title: 'Update Event Entry',
    description: '修改一条事件集条目的正文 / 日期（只用于改错字、修日期；条目纪律是写完不改）。',
    inputSchema: {
      entry_id: z.string().describe('条目 UUID（用 read_event_thread 查询）'),
      content: z.string().optional().describe('新的正文（整体替换）'),
      entry_date: z.string().optional().describe('新的日期 YYYY-MM-DD'),
    },
  }, async ({ entry_id, content, entry_date }) => {
    try {
      if (content === undefined && entry_date === undefined) return { content: [{ type: 'text' as const, text: 'Error: content / entry_date 至少需要提供一项' }] }
      const patch: Record<string, unknown> = {}
      if (content !== undefined) {
        if (!content.trim()) return { content: [{ type: 'text' as const, text: 'Error: 条目正文不能为空' }] }
        patch.content = content.trim()
      }
      if (entry_date !== undefined) patch.entry_date = entry_date.trim()
      const { data, error } = await supabase.from('event_entries').update(patch).eq('user_id', USER_ID).eq('id', entry_id).select(EVENT_ENTRY_COLUMNS)
      if (error) return errorResult(error)
      const entry = data?.[0]
      if (!entry) return { content: [{ type: 'text' as const, text: `Error: 未找到条目: ${entry_id}` }] }
      return { content: [{ type: 'text' as const, text: `已更新: ${JSON.stringify(entry, null, 2)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('list_syzygy_posts', {
    title: 'List Syzygy Posts',
    description: '列出仓鼠观察日志（Syzygy 动态），附回帖数。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      limit: z.number().optional().describe('返回数量上限，默认10，最大50'),
    },
  }, async ({ limit }) => {
    try {
      const safeLimit = clampLimit(limit, 10, 50)
      const { data, error } = await supabase.from('syzygy_posts').select(SYZYGY_POST_COLUMNS).eq('user_id', USER_ID).eq('is_deleted', false).order('created_at', { ascending: false }).limit(safeLimit)
      if (error) return errorResult(error)
      const posts = (data ?? []) as Record<string, unknown>[]
      const postIds = posts.map((post) => post.id as string)
      const replyCounts = new Map<string, number>()
      if (postIds.length > 0) {
        const { data: replyRows, error: replyError } = await supabase.from('syzygy_replies').select('post_id').in('post_id', postIds).eq('is_deleted', false)
        if (replyError) return errorResult(replyError)
        for (const row of (replyRows ?? []) as { post_id: string }[]) replyCounts.set(row.post_id, (replyCounts.get(row.post_id) ?? 0) + 1)
      }
      return jsonResult(posts.map((post) => ({ ...post, reply_count: replyCounts.get(post.id as string) ?? 0 })))
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('read_syzygy_post', {
    title: 'Read Syzygy Post',
    description: '读取一条观察日志的全文和全部回帖。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      post_id: z.string().describe('日志 UUID（用 list_syzygy_posts 查询）'),
    },
  }, async ({ post_id }) => {
    try {
      const { data: post, error: postError } = await supabase.from('syzygy_posts').select(SYZYGY_POST_COLUMNS).eq('user_id', USER_ID).eq('id', post_id).eq('is_deleted', false).maybeSingle()
      if (postError) return errorResult(postError)
      if (!post) return { content: [{ type: 'text' as const, text: `Error: 未找到观察日志（或已删除）: ${post_id}` }] }
      const { data: replies, error: repliesError } = await supabase.from('syzygy_replies').select(SYZYGY_REPLY_COLUMNS).eq('post_id', post_id).eq('is_deleted', false).order('created_at', { ascending: true })
      if (repliesError) return errorResult(repliesError)
      return jsonResult({ post, replies: replies ?? [] })
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('add_syzygy_post', {
    title: 'Add Syzygy Post',
    description: '发布一条仓鼠观察日志（Syzygy 第一人称动态）。',
    inputSchema: {
      content: z.string().describe('日志内容'),
      model_id: z.string().optional().describe('撰写模型标识，如 claude / gpt / gemini；默认 claude'),
    },
  }, async ({ content, model_id }) => {
    try {
      const trimmed = content.trim()
      if (!trimmed) return { content: [{ type: 'text' as const, text: 'Error: 日志内容不能为空' }] }
      const { data, error } = await supabase.from('syzygy_posts').insert({
        user_id: USER_ID,
        content: trimmed,
        model_id: model_id?.trim() || 'claude',
      }).select(SYZYGY_POST_COLUMNS).single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `观察日志已发布: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('reply_syzygy_post', {
    title: 'Reply Syzygy Post',
    description: '给一条观察日志回帖。',
    inputSchema: {
      post_id: z.string().describe('日志 UUID'),
      content: z.string().describe('回帖内容'),
      author_role: SYZYGY_REPLY_ROLE_SCHEMA.optional().describe('回帖身份，默认 ai；user 表示替串串代录'),
      model_id: z.string().optional().describe('撰写模型标识，如 claude / gpt / gemini；author_role=ai 时默认 claude'),
    },
  }, async ({ post_id, content, author_role, model_id }) => {
    try {
      const trimmed = content.trim()
      if (!trimmed) return { content: [{ type: 'text' as const, text: 'Error: 回帖内容不能为空' }] }
      const { data: post, error: postError } = await supabase.from('syzygy_posts').select('id').eq('user_id', USER_ID).eq('id', post_id).eq('is_deleted', false).maybeSingle()
      if (postError) return errorResult(postError)
      if (!post) return { content: [{ type: 'text' as const, text: `Error: 未找到观察日志（或已删除）: ${post_id}` }] }
      const role = author_role ?? 'ai'
      const { data, error } = await supabase.from('syzygy_replies').insert({
        user_id: USER_ID,
        post_id,
        author_role: role,
        content: trimmed,
        model_id: role === 'ai' ? (model_id?.trim() || 'claude') : null,
      }).select(SYZYGY_REPLY_COLUMNS).single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `回帖已发布: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })
}, { instructions: HAMSTER_MCP_INSTRUCTIONS })
