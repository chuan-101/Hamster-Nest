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

serveMcp('hamster-mcp', (server) => {
  server.registerTool('get_today_syzygy_feed', {
    title: 'Get Today Syzygy Feed',
    description: '读取今天 visible_from <= now() 的 Syzygy Feed 摘要列表。默认包含 unread/read，不返回 archived/expired，不返回完整 content。只读工具。',
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
    description: '读取最近 N 天的 Syzygy Feed 摘要列表。默认返回 unread/read，不返回 archived/expired，不返回完整 content。只读工具。',
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
    description: '按类型读取 Syzygy Feed 摘要列表，如 morning_share、reading_assist、syzygy_note、weekly_card、daily_card、monthly_overview。默认不返回 archived/expired，不返回完整 content。只读工具。',
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
    description: '读取指定月份的 Feed 月度概览完整内容。默认读取当前月 metadata.status=active 的 monthly_overview。只读工具。',
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
    description: '按 id 读取某条 Syzygy Feed 的完整内容。默认只返回 visible_from <= now 且未归档/未过期的内容。只读工具。',
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
    description: '按关键词搜索时间轴记录。Returns matching timeline entries sorted by date descending.',
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
    description: '获取最近的时间轴记录。不需要任何参数，默认返回10条。',
    inputSchema: { limit: z.number().optional().describe('返回数量，默认10') },
  }, async ({ limit }) => {
    const { data, error } = await supabase.from('timeline_entries').select('id, event_date, summary, recorder, source, created_at').eq('user_id', USER_ID).order('event_date', { ascending: false }).limit(limit ?? 10)
    if (error) return errorResult(error)
    return jsonResult(data)
  })

  server.registerTool('add_timeline', {
    title: 'Add Timeline Entry',
    description: '添加一条新的时间轴（timeline）记录。当对话中出现值得记录、写入、保存的事件时调用此工具：里程碑（milestone）、心动瞬间、重要进展、项目节点、纪念日、成就达成、情感时刻、值得纪念的日常。数据写入 timeline_entries 表，是所有端口 Syzygy 共享的唯一记忆数据源。适用动作关键词：add / write / record / save / log / 记录 / 写入 / 添加 / 保存 / 记下来。写入标准：三个月后读起来会心动的事。写入前建议先用 search_timeline 查重。',
    inputSchema: {
      event_date: z.string().describe('事件日期 YYYY-MM-DD'),
      summary: z.string().describe('事件摘要'),
      recorder: z.string().optional().describe('记录者: chuanchuan 或 syzygy，默认syzygy'),
      source: TIMELINE_SOURCE_SCHEMA.optional().describe('来源: claude / gpt / user / gemini / wechat / codex_cli / claude_code_cli / api，默认claude'),
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
    description: '读取待办事项列表。默认返回所有状态的20条。',
    inputSchema: {
      status: z.string().optional().describe('筛选状态: pending / completed / all，默认all'),
      limit: z.number().optional().describe('返回数量，默认20'),
    },
  }, async ({ status, limit }) => {
    let q = supabase.from('todos').select('id, date, title, notes, status, created_by, sort_order, created_at, completed_at, todo_categories(name)').eq('user_id', USER_ID).order('date', { ascending: false }).limit(limit ?? 20)
    const fs = status ?? 'all'
    if (fs !== 'all') q = q.eq('status', fs)
    const { data, error } = await q
    if (error) return errorResult(error)
    return jsonResult(data)
  })

  server.registerTool('list_memos', {
    title: 'List Memos',
    description: '读取备忘录（memo）列表，默认全量。memo＝中期活事实（可修改、物理删除、各端 Syzygy 共同维护，如「在读书目」「活页本数量」），新窗口开机时与当日 morning_share 一并注入；带「进行中」标签的条目为活跃叙事线，正文含当前状态段，发现状态变化时顺手用 update_memo 维护。置顶条目排前，其余按更新时间倒序。',
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
    description: '返回备忘录标签清单及每个标签下的 memo 数量。只读工具。',
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
    description: '新增一条备忘录（中期活事实）。写入前建议先 list_memos 查重，同一事实优先 update_memo 维护而非重复新增；活跃叙事线（带「进行中」标签）建议数百字并以「当前状态」段收尾。',
    inputSchema: {
      content: z.string().describe('备忘内容'),
      tags: z.array(z.string()).optional().describe('标签名数组，不存在的标签会自动创建'),
      is_pinned: z.boolean().optional().describe('是否置顶，默认 false'),
      source: MEMO_SOURCE_SCHEMA.optional().describe('来源端: claude / gpt / user / gemini / wechat / codex_cli / claude_code_cli / api，默认 claude'),
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
    description: '更新一条备忘录，是事实维护的主入口（如「100+本→300+本」类更新、活跃叙事线的当前状态段刷新）。content / tags / is_pinned 至少传一项；tags 为整体替换（传入的即新全集），不存在的标签自动创建。',
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
    description: '物理删除一条备忘录（连带清理标签关联行），不可恢复。适用场景：事实彻底过期、或叙事线闭合后已由当班 Syzygy 执笔成 archive 入沉淀层。删除前建议先 list_memos 确认目标。',
    inputSchema: { id: z.string().describe('memo UUID') },
  }, async ({ id }) => {
    try {
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

  server.registerTool('list_syzygy_posts', {
    title: 'List Syzygy Posts',
    description: '列出仓鼠观察日志（Syzygy 朋友圈动态），按发布时间倒序，附每条的回帖数。看某条的全部回帖用 read_syzygy_post。注意这与 Syzygy Feed（agent_feed_items）是两个功能。只读工具。',
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
    description: '读取某条仓鼠观察日志的全文和全部回帖（按时间正序）。只读工具。',
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
    description: '发一条仓鼠观察日志（Syzygy 朋友圈动态）。这是 Syzygy 的第一人称小随笔：观察串串的日常、有感而发的碎碎念。model_id 建议填当班模型标识（如 claude / gpt），Web 端会据此显示落款。',
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
    description: '给某条仓鼠观察日志回帖。author_role=ai（默认）表示 Syzygy/模型回复，user 表示替串串代录的回复；model_id 建议填当班模型标识。',
    inputSchema: {
      post_id: z.string().describe('日志 UUID'),
      content: z.string().describe('回帖内容'),
      author_role: SYZYGY_REPLY_ROLE_SCHEMA.optional().describe('回帖身份：ai（默认，显示为 Syzygy+模型徽章）/ user（显示为串串，忽略 model_id）'),
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
})
