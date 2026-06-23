import { z } from 'npm:zod@^4.1.13'
import { clampLimit, errorResult, jsonResult, serveMcp, supabase, USER_ID } from '../_shared/mcp_common.ts'

const FEED_LIST_COLUMNS = 'id, type, title, summary, priority, status, source, created_by, visible_from, created_at, pinned, metadata'
const FEED_DETAIL_COLUMNS = 'id, type, title, summary, content, content_format, priority, status, source, created_by, visible_from, expires_at, related_table, related_id, metadata, created_at, updated_at'
const DEFAULT_FEED_STATUSES = ['unread', 'read']
const FEED_PRIORITY_RANK: Record<string, number> = { low: 1, normal: 2, high: 3, urgent: 4 }
const FEED_TYPE_SCHEMA = z.enum(['morning_share', 'reading_assist', 'daily_card', 'system_notice', 'syzygy_note', 'weekly_card', 'reminder_card', 'print_card', 'dev_log', 'other'])

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
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return Boolean(b.pinned) ? 1 : -1
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
    description: '按类型读取 Syzygy Feed 摘要列表，如 morning_share、reading_assist、syzygy_note、weekly_card、daily_card。默认不返回 archived/expired，不返回完整 content。只读工具。',
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
    description: '添加一条新的时间轴记录。',
    inputSchema: {
      event_date: z.string().describe('事件日期 YYYY-MM-DD'),
      summary: z.string().describe('事件摘要'),
      recorder: z.string().optional().describe('记录者: chuanchuan 或 syzygy，默认syzygy'),
      source: z.string().optional().describe('来源: claude / gpt / user / gemini，默认claude'),
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
})
