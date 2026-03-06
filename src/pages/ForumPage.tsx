import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ForumAiProfile, ForumThread } from '../types'
import { fetchForumAiProfiles, fetchForumThreads } from '../storage/supabaseSync'
import { FORUM_AI_SLOTS, defaultForumProfile, getForumAuthorLabel } from './forumShared'
import './ForumPage.css'

const formatTime = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

const ForumPage = () => {
  const navigate = useNavigate()
  const [threads, setThreads] = useState<ForumThread[]>([])
  const [profiles, setProfiles] = useState<ForumAiProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const profilesBySlot = useMemo(() => {
    const entries = new Map<number, ForumAiProfile>()
    profiles.forEach((profile) => entries.set(profile.slotIndex, profile))
    return FORUM_AI_SLOTS.map((slot) => entries.get(slot) ?? {
      ...defaultForumProfile(slot),
      id: `slot-${slot}`,
      userId: '',
      createdAt: '',
      updatedAt: '',
    })
  }, [profiles])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [threadList, profileList] = await Promise.all([fetchForumThreads(), fetchForumAiProfiles()])
      setThreads(threadList)
      setProfiles(profileList)
    } catch (loadError) {
      console.warn('加载论坛失败', loadError)
      setError('论坛加载失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="forum-page app-shell__content">
      <header className="forum-header glass-card">
        <button type="button" className="btn-secondary" onClick={() => navigate('/')}>
          返回主页
        </button>
        <h1 className="ui-title">Forum</h1>
        <div className="forum-header__actions">
          <button type="button" className="btn-secondary" onClick={() => navigate('/forum/settings')}>
            Forum 设置
          </button>
          <button type="button" className="btn-primary" onClick={() => navigate('/forum/new')}>
            新建主题
          </button>
        </div>
      </header>

      <section className="forum-ai-overview glass-card">
        <h2 className="ui-title">AI 档案</h2>
        <div className="forum-ai-overview__cards">
          {profilesBySlot.map((profile) => (
            <article key={profile.slotIndex} className="forum-ai-mini-card">
              <p>{profile.displayName}</p>
              <small>{profile.enabled ? '已启用' : '已停用'}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="forum-thread-list glass-card">
        <h2 className="ui-title">主题列表</h2>
        {loading ? <p>加载中…</p> : null}
        {error ? <p className="forum-error">{error}</p> : null}
        {!loading && !error && threads.length === 0 ? <p>还没有主题，先创建第一条吧。</p> : null}
        <div className="forum-thread-list__items">
          {threads.map((thread) => (
            <Link key={thread.id} className="forum-thread-item" to={`/forum/thread/${thread.id}`}>
              <div>
                <h3>{thread.title}</h3>
                <p>{thread.content}</p>
              </div>
              <aside>
                <strong>{getForumAuthorLabel(thread.authorType, thread.authorSlot, profiles)}</strong>
                <small>{formatTime(thread.createdAt)}</small>
              </aside>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

export default ForumPage
