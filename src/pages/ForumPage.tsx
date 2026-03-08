import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ForumThread } from '../types'
import ConfirmDialog from '../components/ConfirmDialog'
import { deleteForumThread, fetchForumReplyCountMap, fetchForumThreads } from '../storage/supabaseSync'
import { getForumAuthorLabel, toForumPreviewText } from './forumShared'
import './ForumPage.css'

const formatTime = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

const THREAD_PREVIEW_MAX_LENGTH = 160

const buildThreadPreview = (content: string) => toForumPreviewText(content, THREAD_PREVIEW_MAX_LENGTH)

const ForumPage = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [threads, setThreads] = useState<ForumThread[]>([])
  const [replyCountMap, setReplyCountMap] = useState<Record<string, number>>({})
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
      const counts = await fetchForumReplyCountMap(threadList.map((thread) => thread.id))
      setReplyCountMap(counts)
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
      setReplyCountMap((current) => {
        const next = { ...current }
        delete next[pendingDeleteThreadId]
        return next
      })
      setSuccessMessage('主题已删除。')
      setPendingDeleteThreadId(null)
    } catch (deleteError) {
      console.warn('删除主题失败', deleteError)
      setError('删除失败，请稍后重试。')
    } finally {
      setDeletingThreadId(null)
    }
  }

  const threadCards = useMemo(
    () =>
      threads.map((thread) => ({
        ...thread,
        author: thread.authorName ?? getForumAuthorLabel(thread.authorType, thread.authorSlot, []),
        replies: replyCountMap[thread.id] ?? 0,
        preview: buildThreadPreview(thread.content),
      })),
    [threads, replyCountMap],
  )

  return (
    <div className="forum-page app-shell__content">
      <div className="forum-page__wrapper">
        <header className="forum-header forum-header--index">
          <button type="button" className="forum-pixel-btn" onClick={() => navigate('/')}>
            返回主页
          </button>
          <h1 className="ui-title">🎀 小窝论坛 🎀</h1>
          <div className="forum-header__actions">
            <button type="button" className="forum-pixel-btn" onClick={() => navigate('/forum/settings')}>
              Forum 设置
            </button>
            <button type="button" className="forum-pixel-btn forum-pixel-btn--primary" onClick={() => navigate('/forum/new')}>
              新建主题
            </button>
          </div>
        </header>

        <section className="forum-thread-list">
          <h2 className="ui-title forum-thread-list__title">主题列表</h2>
          {loading ? <p>加载中…</p> : null}
          {error ? <p className="forum-error">{error}</p> : null}
          {successMessage ? <p className="forum-success">{successMessage}</p> : null}
          {!loading && !error && threadCards.length === 0 ? <p>还没有主题，先创建第一条吧。</p> : null}
          <div className="forum-thread-list__items">
            {threadCards.map((thread) => (
              <article key={thread.id} className="forum-thread-item">
                <button
                  type="button"
                  className="forum-thread-item__main"
                  onClick={() => navigate(`/forum/thread/${thread.id}`)}
                >
                  <div className="forum-thread-item__content">
                    <h3>{thread.title}</h3>
                    <p className="forum-thread-item__preview">{thread.preview}</p>
                    <small>Author: {thread.author} | Date: {formatTime(thread.createdAt)}</small>
                  </div>
                </button>

                <div className="forum-thread-item__footer">
                  <div className="forum-thread-replies" aria-label={`点赞数 ${thread.replies}`}>
                    <span className="forum-heart-pixel" aria-hidden="true" />x{thread.replies}
                  </div>
                  <div className="forum-thread-status" aria-label="主题状态：开放">
                    <span className="forum-status-check" aria-hidden="true" />
                    <span>Open</span>
                  </div>
                  <button
                    type="button"
                    className="forum-pixel-btn forum-pixel-btn--subtle"
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
      </div>

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
