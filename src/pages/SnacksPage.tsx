import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'
import type { SnackPost } from '../types'
import { createSnackPost, fetchSnackPosts, softDeleteSnackPost } from '../storage/supabaseSync'
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

  useEffect(() => {
    void refreshPosts()
  }, [refreshPosts])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshPosts()
      }
    }
    const onFocus = () => {
      void refreshPosts()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [refreshPosts])

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
      const created = await createSnackPost(user.id, trimmed)
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
    if (!pendingDelete) {
      return
    }
    try {
      await softDeleteSnackPost(pendingDelete.id)
      setPosts((current) => current.filter((post) => post.id !== pendingDelete.id))
      setPendingDelete(null)
    } catch (deleteError) {
      console.warn('删除零食记录失败', deleteError)
      setError('删除失败，请稍后重试。')
      setPendingDelete(null)
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
        <h1>零食罐罐区</h1>
      </header>

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
        {error ? <p className="error">{error}</p> : null}
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
    </div>
  )
}

export default SnacksPage
