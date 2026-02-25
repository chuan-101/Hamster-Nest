import { useCallback, useEffect, useMemo, useState } from 'react'
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
  const checkedToday = useMemo(() => recentDateKeys.includes(todayKey), [recentDateKeys, todayKey])
  const streakDays = useMemo(() => computeStreak(recentDateKeys, todayKey), [recentDateKeys, todayKey])
  const streakPercent = useMemo(() => Math.min(100, Math.round((streakDays / 30) * 100)), [streakDays])

  const loadCheckinData = useCallback(async () => {
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
  }, [user])

  useEffect(() => {
    void loadCheckinData()
  }, [loadCheckinData])

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
        <h1>打卡</h1>
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
          <h2>今日打卡</h2>
          <span>{todayDisplay}</span>
        </div>
        <div className="checkin-status-row">
          <span className={`checkin-status ${checkedToday ? 'done' : 'todo'}`}>
            {checkedToday ? '今日已打卡' : '今日未打卡'}
          </span>
          <button
            type="button"
            className="primary checkin-button"
            onClick={() => void handleCheckin()}
            disabled={!user || checkinSubmitting || checkedToday}
          >
            {checkedToday ? '已打卡' : checkinSubmitting ? '打卡中…' : '打卡'}
          </button>
        </div>
        <div className="checkin-widget" aria-label="打卡进度小组件">
          <div
            className="checkin-progress-ring"
            style={{
              background: `conic-gradient(var(--pink-primary) ${streakPercent}%, rgba(255, 214, 231, 0.25) ${streakPercent}% 100%)`,
            }}
          >
            <div className="checkin-progress-core">
              <strong>{streakDays}</strong>
              <span>连签天</span>
            </div>
          </div>
          <div className="checkin-stamp-grid" aria-hidden="true">
            {Array.from({ length: 9 }).map((_, index) => (
              <span key={index} className={index < Math.min(streakDays, 9) ? 'active' : ''}>🐾</span>
            ))}
          </div>
        </div>

        <div className="checkin-metrics">
          <p>连续打卡：<strong>{streakDays}</strong> 天</p>
          <p>累计打卡：<strong>{checkinTotal}</strong> 次</p>
        </div>

        <ul className="checkin-history">
          {recentCheckins.length === 0 ? <li>暂无打卡记录</li> : recentCheckins.map((entry) => <li key={entry.id}>{entry.checkinDate}</li>)}
        </ul>

        {checkinLoading ? <p className="checkin-tip">打卡数据加载中…</p> : null}
        {checkinNotice ? <p className="checkin-tip">{checkinNotice}</p> : null}
      </section>
    </div>
  )
}

export default CheckinPage
