import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import { computeAgentFeedStats, fetchAgentFeedItems, type AgentFeedStats } from '../lib/agentFeed'
import './SyzygyFeedEntryCard.css'

type SyzygyFeedEntryCardProps = {
  user: User | null
}

const formatRelativeUpdated = (iso: string | null) => {
  if (!iso) {
    return '还没有新内容'
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return '还没有新内容'
  }
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return '刚刚更新'
  if (minutes < 60) return `${minutes} 分钟前更新`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前更新`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前更新`
  return `${date.getMonth() + 1}月${date.getDate()}日更新`
}

const SyzygyFeedEntryCard = ({ user }: SyzygyFeedEntryCardProps) => {
  const navigate = useNavigate()
  const [stats, setStats] = useState<AgentFeedStats | null>(null)
  const [loading, setLoading] = useState<boolean>(() => Boolean(user))
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!user) {
      return
    }
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(false)
      try {
        const items = await fetchAgentFeedItems(user.id)
        if (!cancelled) {
          setStats(computeAgentFeedStats(items))
        }
      } catch (loadError) {
        console.warn('加载 Syzygy Feed 摘要失败', loadError)
        if (!cancelled) {
          setError(true)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [user])

  const goToFeed = () => navigate('/feed')

  const unread = stats?.unread ?? 0
  const highPriority = stats?.highPriority ?? 0

  return (
    <button type="button" className="syzygy-feed-entry" onClick={goToFeed} aria-label="打开 Syzygy Feed">
      <div className="syzygy-feed-entry__glow" aria-hidden="true" />
      <div className="syzygy-feed-entry__top">
        <span className="syzygy-feed-entry__emoji" aria-hidden="true">📮</span>
        <div className="syzygy-feed-entry__heading">
          <strong>Syzygy Feed</strong>
          <p>晨间分享、状态卡、小纸条和周回顾都会放在这里。</p>
        </div>
        {unread > 0 ? <span className="syzygy-feed-entry__badge">{unread > 99 ? '99+' : unread}</span> : null}
      </div>

      <div className="syzygy-feed-entry__stats">
        {error ? (
          <span className="syzygy-feed-entry__hint">暂时读不到内容，点开看看。</span>
        ) : loading ? (
          <span className="syzygy-feed-entry__hint">正在翻找纸条…</span>
        ) : (
          <>
            <span className="syzygy-feed-entry__stat">
              <em>{unread}</em>
              <small>未读</small>
            </span>
            <span className={`syzygy-feed-entry__stat ${highPriority > 0 ? 'is-high' : ''}`}>
              <em>{highPriority}</em>
              <small>高优先级</small>
            </span>
            <span className="syzygy-feed-entry__stat syzygy-feed-entry__stat--time">
              <em>{formatRelativeUpdated(stats?.lastUpdated ?? null)}</em>
              <small>最近更新</small>
            </span>
          </>
        )}
      </div>
    </button>
  )
}

export default SyzygyFeedEntryCard
