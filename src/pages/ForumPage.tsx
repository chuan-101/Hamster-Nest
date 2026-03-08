import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ForumThread } from '../types'
import ConfirmDialog from '../components/ConfirmDialog'
import { deleteForumThread, fetchForumThreads } from '../storage/supabaseSync'
import { getForumAuthorLabel } from './forumShared'
import './ForumPage.css'

const formatTime = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

const ForumPage = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [threads, setThreads] = useState<ForumThread[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null)
  const [pendingDeleteThreadId, setPendingDeleteThreadId] = useState<string | null>(null)

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
    const initialSuccess = (location.state as { forumSuccessMessage?: string } | null)?.forumSuccessMessage
    if (initialSuccess) {
      setSuccessMessage(initialSuccess)
      navigate(location.pathname, { replace: true, state: null })
    }
    void refresh()
  }, [location.pathname, location.state, navigate, refresh])


  const handleOpenDeleteDialog = (threadId: string) => {
    setPendingDeleteThreadId(threadId)
  }

  const handleDeleteThread = async () => {
    if (!pendingDeleteThreadId) {
      return
    }
    setDeletingThreadId(pendingDeleteThreadId)
    setError(null)
    try {
      await deleteForumThread(pendingDeleteThreadId)
      setThreads((current) => current.filter((thread) => thread.id !== pendingDeleteThreadId))
      setSuccessMessage('主题已删除。')
      setPendingDeleteThreadId(null)
    } catch (deleteError) {
      console.warn('删除主题失败', deleteError)
      setError('删除失败，请稍后重试。')
    } finally {
      setDeletingThreadId(null)
    }
  }

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
        {successMessage ? <p className="forum-success">{successMessage}</p> : null}
        {!loading && !error && threads.length === 0 ? <p>还没有主题，先创建第一条吧。</p> : null}
        <div className="forum-thread-list__items">
          {threads.map((thread) => (
            <article key={thread.id} className="forum-thread-item">
              <button
                type="button"
                className="forum-thread-item__main"
                onClick={() => navigate(`/forum/thread/${thread.id}`)}
              >
                <div>
                  <h3>{thread.title}</h3>
                  <p>{thread.content}</p>
                </div>
                <aside>
                  <strong>{thread.authorName ?? getForumAuthorLabel(thread.authorType, thread.authorSlot, [])}</strong>
                  <small>{formatTime(thread.createdAt)}</small>
                </aside>
              </button>
              <div className="forum-thread-item__actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => handleOpenDeleteDialog(thread.id)}
                  disabled={deletingThreadId === thread.id}
                >
                  {deletingThreadId === thread.id ? '删除中…' : '删除'}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <ConfirmDialog
        open={pendingDeleteThreadId !== null}
        title="确定删除这个主题吗？"
        description="删除后将同时移除该主题下的全部回复。"
        confirmLabel="删除"
        cancelLabel="取消"
        confirmDisabled={deletingThreadId !== null}
        cancelDisabled={deletingThreadId !== null}
        onCancel={() => setPendingDeleteThreadId(null)}
        onConfirm={() => void handleDeleteThread()}
      />
    </div>
  )
}

export default ForumPage
