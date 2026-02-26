import { useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import type { CheckinEntry } from '../types'
import { createTodayCheckin, fetchCheckinTotalCount, fetchRecentCheckins } from '../storage/supabaseSync'
import './CheckinPage.css'

export type CheckinPageProps = {
  user: User | null
}

const formatDateKey = (date: Date) => {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

const shiftDateKey = (dateKey: string, daysDelta: number) => {
  const base = new Date(`${dateKey}T00:00:00`)
  base.setDate(base.getDate() + daysDelta)
  return formatDateKey(base)
}

const computeStreak = (dates: string[], todayKey: string) => {
  const uniqueDates = Array.from(new Set(dates)).sort((a, b) => b.localeCompare(a))
  const dateSet = new Set(uniqueDates)
  const startDate = dateSet.has(todayKey) ? todayKey : shiftDateKey(todayKey, -1)
  if (!dateSet.has(startDate)) {
    return 0
  }

  let streak = 0
  let cursor = startDate
  while (dateSet.has(cursor)) {
    streak += 1
    cursor = shiftDateKey(cursor, -1)
  }
  return streak
}

const getMonthCalendarCells = (monthDate: Date) => {
  const year = monthDate.getFullYear()
  const month = monthDate.getMonth()
  const firstDay = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const leadingBlankDays = firstDay.getDay()

  const cells: Array<{ dateKey: string; dayNumber: number } | null> = []
  for (let i = 0; i < leadingBlankDays; i += 1) {
    cells.push(null)
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day)
    cells.push({
      dateKey: formatDateKey(date),
      dayNumber: day,
    })
  }

  while (cells.length % 7 !== 0) {
    cells.push(null)
  }

  return cells
}

const CheckinPage = ({ user }: CheckinPageProps) => {
  const [recentCheckins, setRecentCheckins] = useState<CheckinEntry[]>([])
  const [checkinTotal, setCheckinTotal] = useState(0)
  const [checkinLoading, setCheckinLoading] = useState(false)
  const [checkinSubmitting, setCheckinSubmitting] = useState(false)
  const [checkinNotice, setCheckinNotice] = useState<string | null>(null)
  const navigate = useNavigate()

  const todayKey = useMemo(() => formatDateKey(new Date()), [])
  const todayDisplay = useMemo(
    () => new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }),
    [],
  )
  const recentDateKeys = useMemo(() => recentCheckins.map((entry) => entry.checkinDate), [recentCheckins])
  const checkedDateSet = useMemo(() => new Set(recentDateKeys), [recentDateKeys])
  const checkedToday = useMemo(() => recentDateKeys.includes(todayKey), [recentDateKeys, todayKey])
  const streakDays = useMemo(() => computeStreak(recentDateKeys, todayKey), [recentDateKeys, todayKey])
  const monthCells = useMemo(() => getMonthCalendarCells(new Date()), [])
  const monthTitle = useMemo(() => new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }), [])

  const loadCheckinData = async () => {
    if (!user) {
      return
    }
    setCheckinLoading(true)
    try {
      const [recent, total] = await Promise.all([fetchRecentCheckins(60), fetchCheckinTotalCount()])
      setRecentCheckins(recent)
      setCheckinTotal(total)
      setCheckinNotice(null)
    } catch (error) {
      console.warn('加载打卡记录失败', error)
      setCheckinNotice('加载打卡数据失败，请稍后重试。')
    } finally {
      setCheckinLoading(false)
    }
  }

  useEffect(() => {
    void loadCheckinData()
  }, [user])

  const handleCheckin = async () => {
    if (!user || checkinSubmitting) {
      return
    }
    setCheckinSubmitting(true)
    try {
      const result = await createTodayCheckin(todayKey)
      setCheckinNotice(result === 'created' ? '打卡成功！' : '今日已打卡')
      await loadCheckinData()
    } catch (error) {
      console.warn('打卡失败', error)
      setCheckinNotice('打卡失败，请稍后重试。')
    } finally {
      setCheckinSubmitting(false)
    }
  }

  return (
    <div className="checkin-page">
      <header className="checkin-page-header">
        <h1 className="ui-title">打卡</h1>
        <div className="checkin-nav-actions">
          <button type="button" className="ghost" onClick={() => navigate('/')}>
            聊天
          </button>
          <button type="button" className="ghost" onClick={() => navigate('/memory-vault')}>
            囤囤库
          </button>
          <button type="button" className="ghost" onClick={() => navigate('/snacks')}>
            零食罐罐
          </button>
          <button type="button" className="ghost" onClick={() => navigate('/syzygy')}>
            仓鼠饲养日志
          </button>
          <button type="button" className="ghost" onClick={() => navigate('/settings')}>
            设置
          </button>
          <button type="button" className="ghost" onClick={() => navigate('/export')}>
            数据导出
          </button>
        </div>
      </header>

      <section className="checkin-card standalone">
        <div className="checkin-header">
          <h2 className="ui-title">Syzygy & 串串的陪伴记录</h2>
          <span>{todayDisplay}</span>
        </div>
        <div className="checkin-metrics">
          <article className="metric-card">
            <p>连续打卡 Streak</p>
            <strong>{streakDays}</strong>
          </article>
          <article className="metric-card">
            <p>累计打卡 Total Days</p>
            <strong>{checkinTotal}</strong>
          </article>
        </div>
        <div className="checkin-status-row">
          <span className={`checkin-status ${checkedToday ? 'done' : 'todo'}`}>
            {checkedToday ? '今日已陪伴 / Accompanied Today' : '今天还没盖章喔'}
          </span>
          <button
            type="button"
            className={`primary checkin-button ${checkedToday ? 'checked' : 'unchecked'}`}
            onClick={() => void handleCheckin()}
            disabled={!user || checkinSubmitting || checkedToday}
          >
            {checkedToday ? '今日已陪伴 💖' : checkinSubmitting ? '盖章中…' : '点我打卡 / Check in'}
          </button>
        </div>

        <section className="calendar-panel" aria-label="打卡月历">
          <div className="calendar-tape tape-left" aria-hidden="true" />
          <div className="calendar-tape tape-right" aria-hidden="true" />
          <h3>{monthTitle} 陪伴月历</h3>
          <div className="calendar-weekdays" aria-hidden="true">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {monthCells.map((cell, index) => {
              if (!cell) {
                return <div key={`blank-${index}`} className="calendar-day blank" aria-hidden="true" />
              }
              const isChecked = checkedDateSet.has(cell.dateKey)
              return (
                <div
                  key={cell.dateKey}
                  className={`calendar-day ${isChecked ? 'checked' : 'unchecked'}`}
                  aria-label={`${cell.dateKey} ${isChecked ? '已打卡' : '未打卡'}`}
                >
                  <span className="day-number">{cell.dayNumber}</span>
                  <span className="day-stamp">{isChecked ? '💗' : ''}</span>
                </div>
              )
            })}
          </div>
        </section>

        {checkinLoading ? <p className="checkin-tip">打卡数据加载中…</p> : null}
        {checkinNotice ? <p className="checkin-tip">{checkinNotice}</p> : null}
      </section>
    </div>
  )
}

export default CheckinPage
