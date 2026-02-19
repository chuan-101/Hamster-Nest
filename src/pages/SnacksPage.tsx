import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'
import type { SnackPost } from '../types'
import {
  createSnackPost,
  fetchDeletedSnackPosts,
  fetchSnackPosts,
  restoreSnackPost,
  softDeleteSnackPost,
} from '../storage/supabaseSync'
import './SnacksPage.css'

type SnacksPageProps = {
  user: User | null
}

const maxLength = 1000

const formatChineseTime = (timestamp: string) =>
  new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

const SnacksPage = ({ user }: SnacksPageProps) => {
  const navigate = useNavigate()
  const [draft, setDraft] = useState('')
  const [posts, setPosts] = useState<SnackPost[]>([])
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SnackPost | null>(null)
  const [showTrash, setShowTrash] = useState(false)
  const [trashPosts, setTrashPosts] = useState<SnackPost[]>([])
  const [trashLoading, setTrashLoading] = useState(false)
  const [restoringPostId, setRestoringPostId] = useState<string | null>(null)

  const refreshPosts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchSnackPosts()
      setPosts(list)
    } catch (loadError) {
      console.warn('加载零食记录失败', loadError)
      setError('加载失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshTrashPosts = useCallback(async () => {
    setTrashLoading(true)
    setError(null)
    try {
      const list = await fetchDeletedSnackPosts()
      setTrashPosts(list)
    } catch (loadError) {
      console.warn('加载回收站失败', loadError)
      setError('回收站加载失败，请稍后重试。')
    } finally {
      setTrashLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshPosts()
  }, [refreshPosts])

  useEffect(() => {
    if (showTrash) {
      void refreshTrashPosts()
    }
  }, [refreshTrashPosts, showTrash])

  useEffect(() => {
    const refreshCurrentView = () => {
      if (showTrash) {
        void refreshTrashPosts()
      } else {
        void refreshPosts()
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshCurrentView()
      }
    }
    const onFocus = () => {
      refreshCurrentView()
    }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [refreshPosts, refreshTrashPosts, showTrash])

  const trimmed = draft.trim()
  const draftTooLong = trimmed.length > maxLength
  const publishDisabled = !user || publishing || trimmed.length === 0 || draftTooLong
  const draftHint = useMemo(() => `${trimmed.length}/${maxLength}`, [trimmed.length])

  const handlePublish = async () => {
    if (!user || publishDisabled) {
      return
    }
    setPublishing(true)
    setError(null)
    try {
      const created = await createSnackPost(trimmed)
      setPosts((current) => [created, ...current])
      setDraft('')
    } catch (publishError) {
      console.warn('发布零食记录失败', publishError)
      setError('发布失败，请稍后重试。')
    } finally {
      setPublishing(false)
    }
  }

  const handleDelete = async () => {
    if (!pendingDelete || !user) {
      return
    }
    try {
      await softDeleteSnackPost(pendingDelete.id)
      setPosts((current) => current.filter((post) => post.id !== pendingDelete.id))
      setPendingDelete(null)
    } catch (deleteError) {
      console.warn('删除零食记录失败', deleteError)
      setError('删除失败，请重试；若仍失败请稍后再试。')
      setPendingDelete(null)
    }
  }

  const handleRestore = async (postId: string) => {
    setRestoringPostId(postId)
    setError(null)
    try {
      await restoreSnackPost(postId)
      setTrashPosts((current) => current.filter((post) => post.id !== postId))
      await refreshPosts()
    } catch (restoreError) {
      console.warn('恢复零食记录失败', restoreError)
      setError('恢复失败，请稍后重试。')
    } finally {
      setRestoringPostId(null)
    }
  }

  if (!user) {
    return null
  }

  return (
    <div className="snacks-page">
      <header className="snacks-header">
        <button type="button" className="ghost" onClick={() => navigate('/')}>
          返回聊天
        </button>
        <h1>{showTrash ? '零食回收站' : '零食罐罐区'}</h1>
        <button
          type="button"
          className="ghost compact-action"
          onClick={() => setShowTrash((current) => !current)}
        >
          {showTrash ? '返回列表' : '回收站'}
        </button>
      </header>

      {error ? <p className="error">{error}</p> : null}

      {showTrash ? (
        <main className="snacks-feed">
          {trashLoading ? <p className="tips">回收站加载中…</p> : null}
          {!trashLoading && trashPosts.length === 0 ? <p className="tips">回收站是空的。</p> : null}
          {trashPosts.map((post) => (
            <article key={post.id} className="post-card">
              <p className="post-content">{post.content}</p>
              <div className="post-footer">
                <span>{formatChineseTime(post.updatedAt || post.createdAt)}</span>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void handleRestore(post.id)}
                  disabled={restoringPostId === post.id}
                >
                  {restoringPostId === post.id ? '恢复中…' : '恢复'}
                </button>
              </div>
            </article>
          ))}
        </main>
      ) : (
        <>
          <section className="snacks-composer">
            <textarea
              rows={3}
              placeholder="写点今天的零食…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={maxLength + 10}
            />
            <div className="composer-footer">
              <span className={draftTooLong ? 'danger' : ''}>{draftHint}</span>
              <button type="button" className="primary" onClick={handlePublish} disabled={publishDisabled}>
                {publishing ? '发布中…' : '发布'}
              </button>
            </div>
            {draftTooLong ? <p className="error">内容不能超过 1000 字。</p> : null}
          </section>

          <main className="snacks-feed">
            {loading ? <p className="tips">加载中…</p> : null}
            {!loading && posts.length === 0 ? <p className="tips">还没有记录，来发布第一条吧。</p> : null}
            {posts.map((post) => (
              <article key={post.id} className="post-card">
                <p className="post-content">{post.content}</p>
                <div className="post-footer">
                  <span>{formatChineseTime(post.createdAt)}</span>
                  <button type="button" className="ghost danger" onClick={() => setPendingDelete(post)}>
                    删除
                  </button>
                </div>
              </article>
            ))}
          </main>

          <ConfirmDialog
            open={pendingDelete !== null}
            title="确定删除这条记录吗？"
            confirmLabel="删除"
            cancelLabel="取消"
            onCancel={() => setPendingDelete(null)}
            onConfirm={handleDelete}
          />
        </>
      )}
    </div>
  )
}

export default SnacksPage
