import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ForumThread } from '../types'
import { fetchForumThreads } from '../storage/supabaseSync'
import { getForumAuthorLabel } from './forumShared'
import './ForumPage.css'

const formatTime = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

const ForumPage = () => {
  const navigate = useNavigate()
  const [threads, setThreads] = useState<ForumThread[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const threadList = await fetchForumThreads()
      setThreads(threadList)
    } catch {
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
                <strong>{thread.authorName ?? getForumAuthorLabel(thread.authorType, thread.authorSlot, [])}</strong>
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
