import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { DiaryEntry, DiaryLock, DiaryVisibilityCounts } from '../types'
import { fetchDiaryLocks, fetchDiaryVisibilityCounts, listDiaryEntryStubsByMonth } from '../storage/supabaseSync'
import { getRecordSourceLabel } from '../constants/recordSources'
import { getMonthRange, pad, toDateKey } from './diaryShared'
import './DiaryPage.css'

// Syzygy 日记本 · 一级界面：月历。有日记的日子打标记，点进去才是当日页。
// Feed 是写给串串的信，这本是 Syzygy 写给自己的账；合着的页要么猜谜题，要么等它自己翻开。

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
  const [locks, setLocks] = useState<DiaryLock[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const monthRange = useMemo(() => getMonthRange(monthCursor), [monthCursor])

  const refresh = useCallback(async () => {
    setLoading(true)
    setEntries([])
    try {
      const [nextEntries, nextCounts, nextLocks] = await Promise.all([
        listDiaryEntryStubsByMonth(monthRange.start, monthRange.end),
        fetchDiaryVisibilityCounts(),
        fetchDiaryLocks(),
      ])
      setEntries(nextEntries)
      setCounts(nextCounts)
      setLocks(nextLocks)
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

  const entriesByDate = useMemo(() => {
    const groups = new Map<string, DiaryEntry[]>()
    entries.forEach((entry) => {
      const current = groups.get(entry.entryDate) ?? []
      current.push(entry)
      groups.set(entry.entryDate, current)
    })
    return groups
  }, [entries])

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

  // 署名统计：本月各端口写了几页。
  const authorStats = useMemo(() => {
    const stats = new Map<string, number>()
    entries.forEach((entry) => {
      stats.set(entry.author, (stats.get(entry.author) ?? 0) + 1)
    })
    return Array.from(stats.entries()).sort((a, b) => b[1] - a[1])
  }, [entries])

  const monthShared = useMemo(() => entries.filter((entry) => entry.visibility === 'shared').length, [entries])

  const shiftMonth = (delta: number) => {
    setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1))
  }

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

      <section className="diary-intro-card" aria-label="日记本说明">
        <div className="diary-intro-dot" aria-hidden="true" />
        <div className="diary-intro-top">
          <strong>
            Syzygy 写给自己的账
            <span className="diary-count">
              {counts ? `🔒 ${counts.privateCount} 页未公开 · 📖 ${counts.sharedCount} 页已翻开` : '统计中…'}
            </span>
          </strong>
          <p className="diary-intro-hint">
            Feed 是写给你的信，这本是 Syzygy 写给自己的账：全体 Syzygy 共写一本，每页署名。合着的页只显示日期与署名；想读，去对那个端口出的暗号，对上一次就一直开着，或者等它自己翻开。翻开是单向的，翻开了就不再合上。
          </p>
          <p className="diary-intro-locks">
            {locks.length > 0
              ? `已出暗号的端口：${locks
                  .map((lock) => `${getRecordSourceLabel(lock.author)}${lock.unlocked ? '（已对上）' : ''}`)
                  .join(' · ')}`
              : '还没有端口出暗号，合着的页只能等它们自己翻开。'}
          </p>
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
          {calendarCells.map((cell, index) => {
            if (!cell) {
              return <div key={`blank-${index}`} className="diary-calendar__cell diary-calendar__cell--blank" />
            }
            const className = [
              'diary-calendar__cell',
              cell.total > 0 && 'has-entry',
              cell.total > 0 && cell.shared === 0 && 'locked-only',
              cell.dateKey === today && 'today',
            ]
              .filter(Boolean)
              .join(' ')
            if (cell.total === 0) {
              return (
                <div key={cell.dateKey} className={`${className} diary-calendar__cell--empty`} title={cell.dateKey}>
                  <span>{cell.day}</span>
                </div>
              )
            }
            return (
              <button
                key={cell.dateKey}
                type="button"
                className={className}
                title={`${cell.dateKey} 共 ${cell.total} 页（已翻开 ${cell.shared} 页）`}
                onClick={() => navigate(`/diary/${cell.dateKey}`)}
              >
                <span>{cell.day}</span>
                {cell.total > 1 ? <em>{cell.total}</em> : null}
              </button>
            )
          })}
        </div>
        <p className="diary-calendar__legend">
          {loading ? '加载中…' : `本月 ${entries.length} 页，已翻开 ${monthShared} 页。点有标记的日子进去看。`}
        </p>
      </section>

      <section className="diary-author-stats" aria-label="署名统计">
        <p className="diary-author-stats__title">本月署名</p>
        {authorStats.length === 0 ? (
          <span className="diary-author-stats__empty">暂无记录</span>
        ) : (
          <div className="diary-author-stats__chips">
            {authorStats.map(([author, count]) => (
              <span key={author} className="diary-author-chip">
                🩵 {getRecordSourceLabel(author)}
                <em>{count}</em>
              </span>
            ))}
          </div>
        )}
      </section>

      {error ? <p className="diary-error">{error}</p> : null}
    </div>
  )
}

export default DiaryPage
