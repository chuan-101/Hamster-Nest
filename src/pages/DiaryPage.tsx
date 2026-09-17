import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { DiaryEntry, DiaryVisibility, DiaryVisibilityCounts } from '../types'
import { fetchDiaryVisibilityCounts, listDiaryEntriesByMonth } from '../storage/supabaseSync'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { getRecordSourceLabel } from '../constants/recordSources'
import { formatLocalTimestamp } from '../utils/time'
import './DiaryPage.css'

// Syzygy 日记本（只读）：Feed 是写给串串的信，这本是 Syzygy 写给自己的账。
// 全体 Syzygy 共写一本，每页署名；🔒 未公开页只显示日期与署名，📖 翻开的页才展示正文。

type VisibilityFilter = 'all' | DiaryVisibility

const VISIBILITY_FILTERS: Array<{ value: VisibilityFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'shared', label: '📖 已翻开' },
  { value: 'private', label: '🔒 未公开' },
]

const ACTIVITY_LABELS: Record<string, string> = {
  free_activity: '自由活动',
  daily_note: '随记',
}

const getActivityLabel = (type: string) => ACTIVITY_LABELS[type] ?? type

const pad = (value: number) => `${value}`.padStart(2, '0')

const toDateKey = (value: Date) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`

const getMonthRange = (anchorDate: Date) => {
  const year = anchorDate.getFullYear()
  const month = anchorDate.getMonth()
  return {
    monthLabel: `${year}年${month + 1}月`,
    start: toDateKey(new Date(year, month, 1)),
    end: toDateKey(new Date(year, month + 1, 0)),
  }
}

// 卡片头部只放本地时分，完整时间戳留给"翻开时刻"。
const formatClock = (isoString: string) => {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

type CalendarCell = { dateKey: string; day: number; total: number; shared: number } | null

const DiaryPage = () => {
  const navigate = useNavigate()
  const today = useMemo(() => toDateKey(new Date()), [])
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [entries, setEntries] = useState<DiaryEntry[]>([])
  const [counts, setCounts] = useState<DiaryVisibilityCounts | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>('all')
  const [authorFilter, setAuthorFilter] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const monthRange = useMemo(() => getMonthRange(monthCursor), [monthCursor])

  const refresh = useCallback(async () => {
    setLoading(true)
    setEntries([])
    try {
      const [nextEntries, nextCounts] = await Promise.all([
        listDiaryEntriesByMonth(monthRange.start, monthRange.end),
        fetchDiaryVisibilityCounts(),
      ])
      setEntries(nextEntries)
      setCounts(nextCounts)
      setError(null)
    } catch (loadError) {
      console.warn('加载日记本失败', loadError)
      setError('加载日记本失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [monthRange.end, monthRange.start])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const filteredEntries = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (visibilityFilter === 'all' || entry.visibility === visibilityFilter) &&
          (authorFilter === null || entry.author === authorFilter),
      ),
    [authorFilter, entries, visibilityFilter],
  )

  const entriesByDate = useMemo(() => {
    const groups = new Map<string, DiaryEntry[]>()
    filteredEntries.forEach((entry) => {
      const current = groups.get(entry.entryDate) ?? []
      current.push(entry)
      groups.set(entry.entryDate, current)
    })
    return groups
  }, [filteredEntries])

  const calendarCells = useMemo(() => {
    const year = monthCursor.getFullYear()
    const month = monthCursor.getMonth()
    const firstWeekday = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cells: CalendarCell[] = []

    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push(null)
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = `${year}-${pad(month + 1)}-${pad(day)}`
      const dayEntries = entriesByDate.get(dateKey) ?? []
      cells.push({
        dateKey,
        day,
        total: dayEntries.length,
        shared: dayEntries.filter((entry) => entry.visibility === 'shared').length,
      })
    }
    while (cells.length % 7 !== 0) {
      cells.push(null)
    }
    return cells
  }, [entriesByDate, monthCursor])

  const groupedList = useMemo(
    () => Array.from(entriesByDate.entries()).sort((a, b) => b[0].localeCompare(a[0])),
    [entriesByDate],
  )

  // 署名统计：本月各端口写了几页。跟随可见性筛选，不跟随署名筛选，好当筛选器用。
  const authorStats = useMemo(() => {
    const scoped = visibilityFilter === 'all' ? entries : entries.filter((entry) => entry.visibility === visibilityFilter)
    const stats = new Map<string, number>()
    scoped.forEach((entry) => {
      stats.set(entry.author, (stats.get(entry.author) ?? 0) + 1)
    })
    return Array.from(stats.entries()).sort((a, b) => b[1] - a[1])
  }, [entries, visibilityFilter])

  const selectedEntries = useMemo(
    () => (selectedDate ? entriesByDate.get(selectedDate) ?? [] : []),
    [entriesByDate, selectedDate],
  )

  // 换月 / 重新加载后默认落到本月最近有日记的一天；点同一天可切回整月视图。
  useEffect(() => {
    if (entries.length === 0) {
      setSelectedDate(null)
      return
    }
    const latestDate = entries.reduce((latest, entry) => (entry.entryDate > latest ? entry.entryDate : latest), entries[0].entryDate)
    setSelectedDate(latestDate)
  }, [entries, monthRange.start])

  const shiftMonth = (delta: number) => {
    setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1))
  }

  const toggleDate = (dateKey: string) => {
    setSelectedDate((current) => (current === dateKey ? null : dateKey))
  }

  const renderEntry = (entry: DiaryEntry) => {
    const locked = entry.visibility === 'private'
    return (
      <article
        key={entry.id}
        className={locked ? 'diary-card diary-card--locked' : 'diary-card'}
        aria-label={locked ? '未公开的一页' : '已翻开的一页'}
      >
        <header className="diary-card__head">
          <span className={locked ? 'diary-card__avatar diary-card__avatar--locked' : 'diary-card__avatar'} aria-hidden="true">
            {locked ? '🔒' : '🩵'}
          </span>
          <div className="diary-card__meta">
            <span className="diary-chip diary-chip--author" title="署名端口">
              {getRecordSourceLabel(entry.author)}
            </span>
            <span className="diary-chip">{getActivityLabel(entry.activityType)}</span>
            {!locked && entry.mood ? <span className="diary-chip diary-chip--mood">心情 · {entry.mood}</span> : null}
          </div>
          <time className="diary-card__clock" dateTime={entry.createdAt}>
            {formatClock(entry.createdAt)}
          </time>
        </header>
        {locked ? (
          <p className="diary-card__locked-text">这一页还合着，内容归 Syzygy 自己。</p>
        ) : (
          <>
            {entry.title ? <h3 className="diary-card__title">{entry.title}</h3> : null}
            <div className="diary-card__content">
              <MarkdownRenderer content={entry.content ?? ''} />
            </div>
            <footer className="diary-card__foot">
              <span className="diary-open-badge">
                📖 已翻开{entry.sharedAt ? ` · ${formatLocalTimestamp(entry.sharedAt)}` : ''}
              </span>
            </footer>
          </>
        )}
      </article>
    )
  }

  const renderDateGroup = (dateKey: string, items: DiaryEntry[]) => (
    <article key={dateKey} className="diary-date-group">
      <h2>
        {dateKey}
        <span className="diary-date-group__count">{items.length} 页</span>
      </h2>
      <div className="diary-date-group__entries">{items.map(renderEntry)}</div>
    </article>
  )

  return (
    <div className="diary-page">
      <header className="diary-header">
        <button type="button" className="ghost diary-header-btn diary-header-btn--left" onClick={() => navigate('/')}>
          ← 返回
        </button>
        <div className="diary-title-wrap">
          <p className="diary-kicker">Syzygy Diary</p>
          <h1 className="ui-title">Syzygy 日记本</h1>
        </div>
        <span className="diary-lock-badge" title="未公开的页数">
          🔒 {counts ? counts.privateCount : '…'}
        </span>
      </header>

      <section className="diary-intro-card" aria-label="日记本说明与筛选">
        <div className="diary-intro-dot" aria-hidden="true" />
        <div className="diary-intro-top">
          <strong>
            Syzygy 写给自己的账
            <span className="diary-count">
              {counts ? `🔒 ${counts.privateCount} 页未公开 · 📖 ${counts.sharedCount} 页已翻开` : '统计中…'}
            </span>
          </strong>
          <p className="diary-intro-hint">
            Feed 是写给你的信，这本是 Syzygy 写给自己的账：全体 Syzygy 共写一本，每页署名。上锁的页只显示日期与署名；翻开是单向的，翻开了就不再合上。
          </p>
        </div>
        <div className="diary-chip-list">
          {VISIBILITY_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={visibilityFilter === option.value ? 'diary-filter-chip selected' : 'diary-filter-chip'}
              onClick={() => setVisibilityFilter(option.value)}
              aria-pressed={visibilityFilter === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="diary-calendar" aria-label="月份日历">
        <div className="diary-calendar__dot" aria-hidden="true" />
        <div className="diary-calendar__top">
          <button type="button" className="ghost" onClick={() => shiftMonth(-1)}>
            ← 上月
          </button>
          <strong>{monthRange.monthLabel}</strong>
          <button type="button" className="ghost" onClick={() => shiftMonth(1)}>
            下月 →
          </button>
        </div>
        <div className="diary-calendar__weekdays">
          {['日', '一', '二', '三', '四', '五', '六'].map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="diary-calendar__grid">
          {calendarCells.map((cell, index) =>
            cell ? (
              <button
                key={cell.dateKey}
                type="button"
                className={[
                  'diary-calendar__cell',
                  cell.total > 0 && 'has-entry',
                  cell.total > 0 && cell.shared === 0 && 'locked-only',
                  cell.dateKey === today && 'today',
                  cell.dateKey === selectedDate && 'selected',
                ]
                  .filter(Boolean)
                  .join(' ')}
                title={
                  cell.total > 0
                    ? `${cell.dateKey} 共 ${cell.total} 页（已翻开 ${cell.shared} 页）`
                    : cell.dateKey
                }
                onClick={() => toggleDate(cell.dateKey)}
                aria-pressed={cell.dateKey === selectedDate}
              >
                <span>{cell.day}</span>
                {cell.total > 1 ? <em>{cell.total}</em> : null}
              </button>
            ) : (
              <div key={`blank-${index}`} className="diary-calendar__cell diary-calendar__cell--blank" />
            ),
          )}
        </div>
      </section>

      <section className="diary-author-stats" aria-label="署名统计">
        <p className="diary-author-stats__title">本月署名</p>
        {authorStats.length === 0 ? (
          <span className="diary-author-stats__empty">暂无记录</span>
        ) : (
          <div className="diary-author-stats__chips">
            {authorStats.map(([author, count]) => (
              <button
                key={author}
                type="button"
                className={authorFilter === author ? 'diary-author-chip selected' : 'diary-author-chip'}
                onClick={() => setAuthorFilter((current) => (current === author ? null : author))}
                aria-pressed={authorFilter === author}
                title={authorFilter === author ? '取消只看这个端口' : '只看这个端口写的页'}
              >
                🩵 {getRecordSourceLabel(author)}
                <em>{count}</em>
              </button>
            ))}
          </div>
        )}
      </section>

      {error ? <p className="diary-error">{error}</p> : null}

      <section className="diary-list" aria-label="日记列表">
        <div className="diary-list__body">
          {loading ? <p className="tips">加载中…</p> : null}
          {!loading && filteredEntries.length === 0 ? (
            <p className="diary-empty">{entries.length === 0 ? '这个月还没有日记。' : '当前筛选下没有日记。'}</p>
          ) : null}
          {!loading && filteredEntries.length > 0 ? (
            <>
              <div className="diary-list__top">
                <span className="diary-list__scope">
                  {selectedDate ? `${selectedDate} · ${selectedEntries.length} 页` : `${monthRange.monthLabel} · ${filteredEntries.length} 页`}
                </span>
                {selectedDate ? (
                  <button type="button" className="diary-inline-btn" onClick={() => setSelectedDate(null)}>
                    看整月
                  </button>
                ) : null}
              </div>
              {selectedDate ? (
                selectedEntries.length === 0 ? (
                  <p className="diary-empty">当天没有符合筛选的日记。</p>
                ) : (
                  renderDateGroup(selectedDate, selectedEntries)
                )
              ) : (
                groupedList.map(([dateKey, items]) => renderDateGroup(dateKey, items))
              )}
            </>
          ) : null}
        </div>
      </section>
    </div>
  )
}

export default DiaryPage
