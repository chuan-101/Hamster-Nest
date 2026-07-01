import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import MarkdownRenderer from '../components/MarkdownRenderer'
import MonthlyOverview from '../components/MonthlyOverview'
import {
  agentFeedPriorityLabels,
  agentFeedStatusLabels,
  agentFeedTypeOptions,
  computeAgentFeedStats,
  fetchAgentFeedItems,
  fetchMonthlyOverviews,
  isAgentFeedExpired,
  isPageLevelFeedType,
  resolveAgentFeedStatus,
  sortAgentFeedItems,
  toLocalDateKey,
  typeEmoji,
  typeLabel,
  updateAgentFeedStatus,
  type AgentFeedItem,
  type MonthlyOverviewContent,
} from '../lib/agentFeed'
import './AgentFeedPage.css'

type AgentFeedPageProps = {
  user: User | null
}

const getTodayKey = () => toLocalDateKey(new Date().toISOString()) as string

const formatTime = (value: string | null) => {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date)
}

const formatUpdatedLabel = (iso: string | null) => {
  if (!iso) return '暂无更新'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '暂无更新'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const getMonthRange = (anchor: Date) => {
  const year = anchor.getFullYear()
  const month = anchor.getMonth()
  return {
    monthKey: `${year}-${`${month + 1}`.padStart(2, '0')}`,
    monthLabel: `${year}年${month + 1}月`,
  }
}

const AgentFeedPage = ({ user }: AgentFeedPageProps) => {
  const navigate = useNavigate()
  const today = useMemo(() => getTodayKey(), [])
  const [items, setItems] = useState<AgentFeedItem[]>([])
  // 所有月份的「本月概览」一次读入，按 YYYY-MM 归桶，随日历游标切换即时展示。
  const [overviews, setOverviews] = useState<Map<string, MonthlyOverviewContent>>(() => new Map())
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    setNowMs(Date.now())
    setOverviewLoading(true)
    try {
      const data = await fetchAgentFeedItems(user.id)
      // 页面级类型（如 monthly_overview）有专门的展示区域，不混入普通 Feed 列表 /
      // 日期分组 / 日历计数 / 类型筛选。
      setItems(data.filter((item) => !isPageLevelFeedType(item.type)))
    } catch (loadError) {
      console.warn('加载 Syzygy Feed 失败', loadError)
      setError('暂时读不到 Syzygy Feed，请检查登录状态后重试。')
    } finally {
      setLoading(false)
    }
    // 月度概览单独读取，失败时静默降级为空状态，不影响其它 Feed 卡片。
    try {
      const overviewMap = await fetchMonthlyOverviews(user.id)
      setOverviews(overviewMap)
    } catch (overviewError) {
      console.warn('加载月度概览失败', overviewError)
      setOverviews(new Map())
    } finally {
      setOverviewLoading(false)
    }
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refresh()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  const stats = useMemo(() => computeAgentFeedStats(items, nowMs), [items, nowMs])

  // 按本地日期归桶，便于日历浏览。
  const itemsByDate = useMemo(() => {
    const groups = new Map<string, AgentFeedItem[]>()
    items.forEach((item) => {
      const key = toLocalDateKey(item.created_at)
      if (!key) return
      const current = groups.get(key) ?? []
      current.push(item)
      groups.set(key, current)
    })
    return groups
  }, [items])

  const calendarCells = useMemo(() => {
    const year = monthCursor.getFullYear()
    const month = monthCursor.getMonth()
    const firstWeekday = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cells: Array<{ dateKey: string; day: number; count: number; hasUnread: boolean } | null> = []
    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push(null)
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = `${year}-${`${month + 1}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`
      const dayItems = itemsByDate.get(dateKey) ?? []
      const hasUnread = dayItems.some((item) => resolveAgentFeedStatus(item, nowMs) === 'unread')
      cells.push({ dateKey, day, count: dayItems.length, hasUnread })
    }
    while (cells.length % 7 !== 0) {
      cells.push(null)
    }
    return cells
  }, [itemsByDate, monthCursor, nowMs])

  // 默认选中：今天（若有内容）否则最近有内容的一天。
  useEffect(() => {
    if (items.length === 0) {
      setSelectedDate(null)
      return
    }
    setSelectedDate((current) => {
      if (current && itemsByDate.has(current)) {
        return current
      }
      if (itemsByDate.has(today)) {
        return today
      }
      const latest = Array.from(itemsByDate.keys()).sort((a, b) => b.localeCompare(a))[0]
      return latest ?? null
    })
  }, [items, itemsByDate, today])

  const selectedItems = useMemo(() => {
    if (!selectedDate) return []
    const dayItems = itemsByDate.get(selectedDate) ?? []
    const filtered = typeFilter === 'all' ? dayItems : dayItems.filter((item) => (item.type ?? 'other') === typeFilter)
    return sortAgentFeedItems(filtered, nowMs)
  }, [itemsByDate, nowMs, selectedDate, typeFilter])

  const shiftMonth = (delta: number) => {
    setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1))
  }

  const goToToday = () => {
    const now = new Date()
    setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1))
    setSelectedDate(today)
  }

  const handleUpdateStatus = async (item: AgentFeedItem, status: 'read' | 'archived') => {
    if (!user) return
    setUpdatingId(item.id)
    setActionError(null)
    try {
      const patch = await updateAgentFeedStatus(user.id, item.id, status)
      setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, ...patch } : entry)))
    } catch (updateError) {
      console.warn('更新 Syzygy Feed 状态失败', updateError)
      setActionError('状态更新失败，已降级为只读展示。')
    } finally {
      setUpdatingId(null)
    }
  }

  if (!user) {
    return null
  }

  const monthRange = getMonthRange(monthCursor)
  // 「本月概览」跟随日历游标：切到哪个月就展示哪个月，查不到则由子组件显示空状态。
  const overview = overviews.get(monthRange.monthKey) ?? null

  return (
    <div className="feed-page">
      <header className="feed-page__header">
        <button type="button" className="feed-page__back" onClick={() => navigate('/')}>
          ← 返回小窝
        </button>
        <div className="feed-page__title-wrap">
          <p className="feed-page__kicker">SYZYGY FEED</p>
          <h1 className="ui-title">Syzygy Feed</h1>
        </div>
        <button type="button" className="feed-page__today" onClick={goToToday}>
          今天
        </button>
      </header>

      <section className="feed-hero" aria-label="Syzygy Feed 概览">
        <div className="feed-hero__glow" aria-hidden="true" />
        <p className="feed-hero__subtitle">晨间分享、状态卡、小纸条和周回顾都会放在这里。</p>
        <div className="feed-hero__stats">
          <span className="feed-hero__stat">
            <em>{stats.unread}</em>
            <small>未读</small>
          </span>
          <span className={`feed-hero__stat ${stats.highPriority > 0 ? 'is-high' : ''}`}>
            <em>{stats.highPriority}</em>
            <small>高优先级</small>
          </span>
          <span className="feed-hero__stat feed-hero__stat--time">
            <em>{formatUpdatedLabel(stats.lastUpdated)}</em>
            <small>最近更新</small>
          </span>
        </div>
      </section>

      {error ? <p className="feed-alert">{error}</p> : null}
      {actionError ? <p className="feed-alert feed-alert--soft">{actionError}</p> : null}

      <MonthlyOverview data={overview} loading={overviewLoading} monthLabel={monthRange.monthLabel} />

      <section className="feed-calendar" aria-label="按日期浏览">
        <div className="feed-calendar__dot" aria-hidden="true" />
        <div className="feed-calendar__top">
          <button type="button" className="ghost" onClick={() => shiftMonth(-1)}>
            ← 上月
          </button>
          <strong>{monthRange.monthLabel}</strong>
          <button type="button" className="ghost" onClick={() => shiftMonth(1)}>
            下月 →
          </button>
        </div>
        <div className="feed-calendar__weekdays">
          {['日', '一', '二', '三', '四', '五', '六'].map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="feed-calendar__grid">
          {calendarCells.map((cell, index) =>
            cell ? (
              <button
                key={cell.dateKey}
                type="button"
                className={[
                  'feed-calendar__cell',
                  cell.count > 0 && 'has-entry',
                  cell.hasUnread && 'has-unread',
                  cell.dateKey === today && 'today',
                  cell.dateKey === selectedDate && 'selected',
                ]
                  .filter(Boolean)
                  .join(' ')}
                title={cell.count > 0 ? `${cell.dateKey} 有 ${cell.count} 条记录` : cell.dateKey}
                onClick={() => setSelectedDate(cell.dateKey)}
                aria-pressed={cell.dateKey === selectedDate}
              >
                <span>{cell.day}</span>
                {cell.count > 0 ? <em>{cell.count}</em> : null}
              </button>
            ) : (
              <div key={`blank-${index}`} className="feed-calendar__cell feed-calendar__cell--blank" />
            ),
          )}
        </div>
      </section>

      <section className="feed-type-filter" aria-label="按类型筛选">
        <button
          type="button"
          className={`feed-chip ${typeFilter === 'all' ? 'active' : ''}`}
          onClick={() => setTypeFilter('all')}
        >
          全部
        </button>
        {agentFeedTypeOptions.map((type) => (
          <button
            key={type}
            type="button"
            className={`feed-chip ${typeFilter === type ? 'active' : ''}`}
            onClick={() => setTypeFilter(type)}
          >
            <span aria-hidden="true">{typeEmoji(type)}</span>
            {typeLabel(type)}
          </button>
        ))}
      </section>

      <section className="feed-list" aria-label="当日记录">
        {loading ? <p className="feed-tips">正在翻找小窝里的纸条…</p> : null}
        {!loading && items.length === 0 && !error ? (
          <p className="feed-empty">小窝里还没有新纸条，等 Syzygy 给你写一张吧。</p>
        ) : null}
        {!loading && items.length > 0 && !selectedDate ? (
          <p className="feed-empty">点一个日期，看看那天的纸条。</p>
        ) : null}
        {!loading && selectedDate ? (
          <article className="feed-date-group">
            <h2>
              {selectedDate}
              {selectedDate === today ? <span className="feed-date-group__today">今天</span> : null}
            </h2>
            {selectedItems.length === 0 ? (
              <p className="feed-empty">这一天{typeFilter === 'all' ? '' : '的这一类'}还没有纸条。</p>
            ) : (
              <div className="feed-date-group__items">
                {selectedItems.map((item) => {
                  const status = resolveAgentFeedStatus(item, nowMs)
                  const priority = item.priority ?? 'normal'
                  const expired = isAgentFeedExpired(item, nowMs)
                  const expanded = Boolean(expandedIds[item.id])
                  const muted = status === 'read' || status === 'archived' || status === 'expired'
                  return (
                    <article
                      key={item.id}
                      className={[
                        'feed-card',
                        `priority-${priority}`,
                        `status-${status}`,
                        item.pinned && 'pinned',
                        muted && 'muted',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <button
                        type="button"
                        className="feed-card__header"
                        onClick={() =>
                          setExpandedIds((current) => ({ ...current, [item.id]: !expanded }))
                        }
                        aria-expanded={expanded}
                      >
                        <span className="feed-card__emoji" aria-hidden="true">
                          {typeEmoji(item.type)}
                        </span>
                        <span className="feed-card__title-block">
                          <span className="feed-card__title-row">
                            <strong>{item.title ?? '(无标题纸条)'}</strong>
                            {item.pinned ? <span className="feed-pill pinned">置顶</span> : null}
                          </span>
                          {item.summary ? <span className="feed-card__summary">{item.summary}</span> : null}
                          <span className="feed-card__meta">
                            <span className="feed-pill type">{typeLabel(item.type)}</span>
                            {priority === 'high' || priority === 'urgent' ? (
                              <span className={`feed-pill priority ${priority}`}>
                                {agentFeedPriorityLabels[priority] ?? priority}
                              </span>
                            ) : null}
                            {status !== 'unread' ? (
                              <span className={`feed-pill status ${status}`}>
                                {agentFeedStatusLabels[status] ?? status}
                              </span>
                            ) : null}
                            <span className="feed-card__time">{formatTime(item.created_at)}</span>
                          </span>
                        </span>
                        <span className="feed-card__chevron" aria-hidden="true">
                          {expanded ? '▾' : '▸'}
                        </span>
                      </button>

                      {expanded ? (
                        <div className="feed-card__body">
                          <div className="feed-card__content">
                            {item.content_format === 'markdown' ? (
                              <MarkdownRenderer content={item.content ?? '暂无正文。'} />
                            ) : item.content_format === 'json' ? (
                              <pre>{item.content ?? '暂无正文。'}</pre>
                            ) : (
                              <p>{item.content ?? '暂无正文。'}</p>
                            )}
                          </div>
                          <div className="feed-card__footer">
                            <span className="feed-card__source">
                              {item.created_by ?? item.source ?? 'Syzygy'}
                            </span>
                            <div className="feed-card__actions">
                              {status === 'unread' && !expired ? (
                                <button
                                  type="button"
                                  className="feed-action primary"
                                  onClick={() => void handleUpdateStatus(item, 'read')}
                                  disabled={updatingId === item.id}
                                >
                                  {updatingId === item.id ? '更新中…' : '已读'}
                                </button>
                              ) : null}
                              {item.status !== 'archived' ? (
                                <button
                                  type="button"
                                  className="feed-action ghost"
                                  onClick={() => void handleUpdateStatus(item, 'archived')}
                                  disabled={updatingId === item.id}
                                >
                                  {updatingId === item.id ? '更新中…' : '收起'}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            )}
          </article>
        ) : null}
      </section>
    </div>
  )
}

export default AgentFeedPage
