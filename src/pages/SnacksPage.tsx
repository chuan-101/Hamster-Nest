import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'
import type { SnackPost, SnackReply } from '../types'
import {
  createSnackPost,
  createSnackReply,
  fetchDeletedSnackPosts,
  fetchSnackPosts,
  fetchSnackReplies,
  restoreSnackPost,
  softDeleteSnackPost,
  softDeleteSnackReply,
} from '../storage/supabaseSync'
import { supabase } from '../supabase/client'
import './SnacksPage.css'

type SnacksPageProps = {
  user: User | null
  snackAiConfig: {
    model: string
    reasoning: boolean
    temperature: number
    topP: number
    maxTokens: number
    systemPrompt: string
  }
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

const SnacksPage = ({ user, snackAiConfig }: SnacksPageProps) => {
  const navigate = useNavigate()
  const [draft, setDraft] = useState('')
  const [posts, setPosts] = useState<SnackPost[]>([])
  const [repliesByPost, setRepliesByPost] = useState<Record<string, SnackReply[]>>({})
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SnackPost | null>(null)
  const [pendingDeleteReply, setPendingDeleteReply] = useState<SnackReply | null>(null)
  const [showTrash, setShowTrash] = useState(false)
  const [trashPosts, setTrashPosts] = useState<SnackPost[]>([])
  const [trashLoading, setTrashLoading] = useState(false)
  const [restoringPostId, setRestoringPostId] = useState<string | null>(null)
  const [generatingPostId, setGeneratingPostId] = useState<string | null>(null)

  const refreshPosts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchSnackPosts()
      setPosts(list)
      const postIds = list.map((post) => post.id)
      const replies = await fetchSnackReplies(postIds)
      const nextReplies: Record<string, SnackReply[]> = {}
      replies.forEach((reply) => {
        if (!nextReplies[reply.postId]) {
          nextReplies[reply.postId] = []
        }
        nextReplies[reply.postId].push(reply)
      })
      setRepliesByPost(nextReplies)
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

  const handleDeleteReply = async () => {
    if (!pendingDeleteReply) {
      return
    }
    try {
      await softDeleteSnackReply(pendingDeleteReply.id)
      setRepliesByPost((current) => ({
        ...current,
        [pendingDeleteReply.postId]: (current[pendingDeleteReply.postId] ?? []).filter(
          (reply) => reply.id !== pendingDeleteReply.id,
        ),
      }))
      setPendingDeleteReply(null)
    } catch (deleteError) {
      console.warn('删除零食回复失败', deleteError)
      setError('删除回复失败，请稍后重试。')
      setPendingDeleteReply(null)
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

  const handleGenerateReply = async (post: SnackPost) => {
    if (!user || !supabase || generatingPostId) {
      return
    }
    setGeneratingPostId(post.id)
    setError(null)

    try {
      const { data } = await supabase.auth.getSession()
      const accessToken = data.session?.access_token
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
      if (!accessToken || !anonKey) {
        throw new Error('登录状态异常或环境变量未配置')
      }

      const messagesPayload = [] as Array<{ role: 'system' | 'user'; content: string }>
      const prompt = snackAiConfig.systemPrompt.trim()
      if (prompt) {
        messagesPayload.push({ role: 'system', content: prompt })
      }
      messagesPayload.push({ role: 'user', content: post.content })

      const requestBody: Record<string, unknown> = {
        model: snackAiConfig.model,
        messages: messagesPayload,
        temperature: snackAiConfig.temperature,
        top_p: snackAiConfig.topP,
        max_tokens: snackAiConfig.maxTokens,
        reasoning: snackAiConfig.reasoning,
        stream: false,
      }

      if (snackAiConfig.reasoning && /claude|anthropic/i.test(snackAiConfig.model)) {
        requestBody.thinking = {
          type: 'enabled',
          budget_tokens: Math.max(256, Math.min(1024, snackAiConfig.maxTokens)),
        }
      }

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/openrouter-chat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })
      if (!response.ok) {
        throw new Error(await response.text())
      }

      const payload = (await response.json()) as Record<string, unknown>
      const choice = (payload?.choices as unknown[] | undefined)?.[0] as
        | Record<string, unknown>
        | undefined
      const message = ((choice?.message as Record<string, unknown>) ?? choice ?? {}) as Record<
        string,
        unknown
      >

      const content =
        typeof message.content === 'string'
          ? message.content
          : typeof choice?.text === 'string'
            ? choice.text
            : ''

      const reasoningCandidates = [
        message.reasoning,
        message.thinking,
        message.reasoning_content,
        message.thinking_content,
        choice?.reasoning,
        choice?.thinking,
        payload.reasoning,
        payload.thinking,
      ]
      const reasoningText = reasoningCandidates
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join('')

      const reply = await createSnackReply(post.id, content || '（空回复）', {
        provider: 'openrouter',
        model: typeof payload.model === 'string' ? payload.model : snackAiConfig.model,
        reasoning_text: reasoningText || undefined,
      })
      setRepliesByPost((current) => ({
        ...current,
        [post.id]: [...(current[post.id] ?? []), reply],
      }))
    } catch (generateError) {
      console.warn('生成零食回复失败', generateError)
      setError('生成失败，请稍后重试。')
    } finally {
      setGeneratingPostId(null)
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
                  <div className="post-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void handleGenerateReply(post)}
                      disabled={generatingPostId !== null}
                      title="生成 AI 回复"
                    >
                      🐹
                    </button>
                    <button type="button" className="ghost danger" onClick={() => setPendingDelete(post)}>
                      删除
                    </button>
                  </div>
                </div>

                <div className="reply-list">
                  {(repliesByPost[post.id] ?? []).map((reply) => (
                    <div key={reply.id} className="reply-bubble">
                      <div>
                        <p>{reply.content}</p>
                        <span className="reply-time">{formatChineseTime(reply.createdAt)}</span>
                      </div>
                      <button type="button" className="ghost danger" onClick={() => setPendingDeleteReply(reply)}>
                        删除
                      </button>
                    </div>
                  ))}
                  {generatingPostId === post.id ? <div className="reply-bubble pending">生成中…</div> : null}
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
          <ConfirmDialog
            open={pendingDeleteReply !== null}
            title="确定删除这条回复吗？"
            confirmLabel="删除"
            cancelLabel="取消"
            onCancel={() => setPendingDeleteReply(null)}
            onConfirm={handleDeleteReply}
          />
        </>
      )}
    </div>
  )
}

export default SnacksPage
