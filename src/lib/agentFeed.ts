import { supabase } from '../supabase/client'

// Syzygy Feed 数据层：读取 agent_feed_items（CLI / Syzygy 生成的高频内容卡片）。
// 仓鼠机里曾内嵌的 Feed 视图被拆出后，首页 Page 3 与独立 Feed 页共用这里的类型与读取逻辑。

export type AgentFeedStatus = 'unread' | 'read' | 'archived' | 'expired' | string
export type AgentFeedPriority = 'low' | 'normal' | 'high' | 'urgent' | string

export type AgentFeedItem = {
  id: string
  user_id: string
  type: string | null
  title: string | null
  summary: string | null
  content: string | null
  content_format: 'markdown' | 'plain' | 'json' | string | null
  priority: AgentFeedPriority | null
  status: AgentFeedStatus | null
  source: string | null
  created_by: string | null
  visible_from: string | null
  expires_at: string | null
  read_at: string | null
  pinned: boolean | null
  related_table: string | null
  related_id: string | null
  metadata: unknown
  created_at: string | null
  updated_at: string | null
}

export const AGENT_FEED_COLUMNS =
  'id, user_id, type, title, summary, content, content_format, priority, status, source, created_by, visible_from, expires_at, read_at, pinned, related_table, related_id, metadata, created_at, updated_at'

export const agentFeedTypeLabels: Record<string, string> = {
  morning_share: '晨间分享',
  daily_card: '状态卡',
  syzygy_note: '小纸条',
  reading_assist: '阅读辅助',
  weekly_card: '周回顾',
  reminder_card: '提醒',
  system_notice: '系统提示',
  dev_log: '开发记录',
  print_card: '打印胶囊',
  other: '其他',
}

export const agentFeedTypeEmojis: Record<string, string> = {
  morning_share: '☀️',
  daily_card: '🗒️',
  syzygy_note: '📝',
  reading_assist: '📖',
  weekly_card: '🗓️',
  reminder_card: '⏰',
  system_notice: '🔔',
  dev_log: '🛠️',
  print_card: '🖨️',
  other: '🫧',
}

export const agentFeedPriorityLabels: Record<string, string> = {
  urgent: '紧急',
  high: '高优先级',
  normal: '普通',
  low: '低优先级',
}

export const agentFeedStatusLabels: Record<string, string> = {
  unread: '未读',
  read: '已读',
  archived: '已归档',
  expired: '已过期',
}

export const agentFeedPriorityRank: Record<string, number> = { urgent: 4, high: 3, normal: 2, low: 1 }

export const agentFeedTypeOptions = [
  'morning_share',
  'daily_card',
  'syzygy_note',
  'reading_assist',
  'weekly_card',
  'reminder_card',
  'system_notice',
  'dev_log',
] as const

export const typeLabel = (type: string | null) =>
  agentFeedTypeLabels[type ?? 'other'] ?? type ?? '其他'

export const typeEmoji = (type: string | null) =>
  agentFeedTypeEmojis[type ?? 'other'] ?? agentFeedTypeEmojis.other

export const isAgentFeedExpired = (item: AgentFeedItem, now = Date.now()) => {
  if (item.status === 'expired') return true
  return item.expires_at ? new Date(item.expires_at).getTime() <= now : false
}

export const resolveAgentFeedStatus = (item: AgentFeedItem, now = Date.now()): AgentFeedStatus =>
  isAgentFeedExpired(item, now) ? 'expired' : item.status ?? 'unread'

// 排序：置顶 > 未读 > 优先级 > 时间倒序。
export const sortAgentFeedItems = (items: AgentFeedItem[], now = Date.now()) =>
  [...items].sort((left, right) => {
    const pinnedDelta = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
    if (pinnedDelta) return pinnedDelta
    const leftUnread = resolveAgentFeedStatus(left, now) === 'unread' ? 1 : 0
    const rightUnread = resolveAgentFeedStatus(right, now) === 'unread' ? 1 : 0
    if (rightUnread - leftUnread) return rightUnread - leftUnread
    const priorityDelta =
      (agentFeedPriorityRank[right.priority ?? 'normal'] ?? 0) -
      (agentFeedPriorityRank[left.priority ?? 'normal'] ?? 0)
    if (priorityDelta) return priorityDelta
    return new Date(right.created_at ?? 0).getTime() - new Date(left.created_at ?? 0).getTime()
  })

export const fetchAgentFeedItems = async (userId: string): Promise<AgentFeedItem[]> => {
  if (!supabase) {
    throw new Error('Supabase 未配置，请检查环境变量。')
  }
  const { data, error } = await supabase
    .from('agent_feed_items')
    .select(AGENT_FEED_COLUMNS)
    .eq('user_id', userId)
    .or(`visible_from.is.null,visible_from.lte.${new Date().toISOString()}`)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    throw new Error(error.message)
  }
  return (data ?? []) as AgentFeedItem[]
}

// ── 月度概览（monthly_overview）────────────────────────────────
// Feed 页面顶部的“本月概览”板块：按主题展示当月持续进行的事项。
// 数据来源同样是 agent_feed_items，但 type=monthly_overview，content 为 JSON。

export type MonthlyOverviewEntry = {
  text: string
  source_feed_ids: string[]
  archive_candidate: boolean
}

export type MonthlyOverviewTheme = {
  theme: string
  items: MonthlyOverviewEntry[]
}

export type MonthlyOverviewContent = {
  month: string | null
  themes: MonthlyOverviewTheme[]
}

// 当前月份键（本地时区），形如 2026-06。
export const getCurrentMonthKey = (now: Date = new Date()): string => {
  const year = now.getFullYear()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  return `${year}-${month}`
}

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)

// 容错解析 monthly_overview 的 content（JSON 字符串或已解析对象）。
// 任何结构异常都不抛错，返回 null 以便上层降级为空状态，不影响其它 Feed 卡片。
export const parseMonthlyOverviewContent = (item: AgentFeedItem): MonthlyOverviewContent | null => {
  if (!item.content) return null
  let raw: unknown = item.content
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const rawThemes = Array.isArray(record.themes) ? record.themes : []
  const themes: MonthlyOverviewTheme[] = []
  rawThemes.forEach((themeEntry) => {
    if (!themeEntry || typeof themeEntry !== 'object') return
    const themeRecord = themeEntry as Record<string, unknown>
    const themeName = asString(themeRecord.theme)?.trim()
    const rawItems = Array.isArray(themeRecord.items) ? themeRecord.items : []
    const items: MonthlyOverviewEntry[] = []
    rawItems.forEach((itemEntry) => {
      if (!itemEntry || typeof itemEntry !== 'object') return
      const itemRecord = itemEntry as Record<string, unknown>
      const text = asString(itemRecord.text)?.trim()
      if (!text) return
      const sourceIds = Array.isArray(itemRecord.source_feed_ids)
        ? itemRecord.source_feed_ids.filter((id): id is string => typeof id === 'string')
        : []
      items.push({
        text,
        source_feed_ids: sourceIds,
        archive_candidate: itemRecord.archive_candidate === true,
      })
    })
    if (!themeName || items.length === 0) return
    themes.push({ theme: themeName, items })
  })
  return { month: asString(record.month), themes }
}

// 读取当前月份、active 的月度概览记录（取最新一条）。
// 失败时返回 null，调用方据此降级为空状态，绝不影响其它 Feed 内容。
export const fetchMonthlyOverview = async (
  userId: string,
  month: string = getCurrentMonthKey(),
): Promise<MonthlyOverviewContent | null> => {
  if (!supabase) return null
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('agent_feed_items')
    .select(AGENT_FEED_COLUMNS)
    .eq('user_id', userId)
    .eq('type', 'monthly_overview')
    .or(`visible_from.is.null,visible_from.lte.${nowIso}`)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.warn('加载月度概览失败', error)
    return null
  }

  const candidates = (data ?? []) as AgentFeedItem[]
  for (const item of candidates) {
    const meta = (item.metadata ?? {}) as Record<string, unknown>
    if (asString(meta.month) !== month) continue
    if (asString(meta.status) !== 'active') continue
    const parsed = parseMonthlyOverviewContent(item)
    if (parsed && parsed.themes.length > 0) return parsed
  }
  return null
}

export const updateAgentFeedStatus = async (
  userId: string,
  itemId: string,
  status: 'read' | 'archived',
): Promise<Partial<AgentFeedItem>> => {
  if (!supabase) {
    throw new Error('Supabase 未配置，请检查环境变量。')
  }
  const patch: Partial<AgentFeedItem> =
    status === 'read' ? { status, read_at: new Date().toISOString() } : { status }
  const { error } = await supabase
    .from('agent_feed_items')
    .update(patch)
    .eq('id', itemId)
    .eq('user_id', userId)
  if (error) {
    throw new Error(error.message)
  }
  return patch
}

export type AgentFeedStats = {
  unread: number
  highPriority: number
  lastUpdated: string | null
}

export const computeAgentFeedStats = (items: AgentFeedItem[], now = Date.now()): AgentFeedStats => {
  let unread = 0
  let highPriority = 0
  let lastUpdated: number | null = null

  items.forEach((item) => {
    const status = resolveAgentFeedStatus(item, now)
    if (status === 'unread') {
      unread += 1
    }
    if (status !== 'expired' && status !== 'archived' && ['high', 'urgent'].includes(item.priority ?? 'normal')) {
      highPriority += 1
    }
    const stamp = item.updated_at ?? item.created_at
    if (stamp) {
      const time = new Date(stamp).getTime()
      if (!Number.isNaN(time) && (lastUpdated === null || time > lastUpdated)) {
        lastUpdated = time
      }
    }
  })

  return {
    unread,
    highPriority,
    lastUpdated: lastUpdated === null ? null : new Date(lastUpdated).toISOString(),
  }
}

// 按本地日期（YYYY-MM-DD）归桶，便于日历式浏览。
export const toLocalDateKey = (value: string | null): string | null => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}
