import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ConfirmDialog from '../components/ConfirmDialog'
import type { SnackPost, SnackReply } from '../types'
import {
  createSnackPost,
  createSnackReply,
  fetchDeletedSnackPosts,
  fetchSnackPosts,
  fetchSnackReplies,
  fetchSnackRepliesByPost,
  restoreSnackPost,
  softDeleteSnackPost,
  softDeleteSnackReply,
} from '../storage/supabaseSync'
import { supabase } from '../supabase/client'
import { withTimePrefix } from '../utils/time'
import {
  DEFAULT_SYZYGY_POST_PROMPT,
  DEFAULT_SYZYGY_REPLY_PROMPT,
  resolveSyzygyPostPrompt,
  resolveSyzygyReplyPrompt,
} from '../constants/aiOverlays'
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
    snackSystemOverlay: string
    syzygyPostSystemPrompt: string
    syzygyReplySystemPrompt: string
  }
}

const maxLength = 1000
const createPendingReplyId = (postId: string) =>
  `pending-${postId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const formatChineseTime = (timestamp: string) =>
  new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

const getReplyPreview = (reply: SnackReply | undefined) => {
  if (!reply) {
    return '暂无回复'
  }
  return reply.content.length > 30 ? `${reply.content.slice(0, 30)}…` : reply.content
}

const SnacksPage = ({ user, snackAiConfig }: SnacksPageProps) => {
  const navigate = useNavigate()
  const [draft, setDraft] = useState('')
  const [posts, setPosts] = useState<SnackPost[]>([])
  const [repliesByPost, setRepliesByPost] = useState<Record<string, SnackReply[]>>({})
  const [expandedPostIds, setExpandedPostIds] = useState<Record<string, boolean>>({})
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [generatingPost, setGeneratingPost] = useState(false)
  const [submittingReplyPostId, setSubmittingReplyPostId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SnackPost | null>(null)
  const [pendingDeleteReply, setPendingDeleteReply] = useState<SnackReply | null>(null)
  const [showTrash, setShowTrash] = useState(false)
  const [trashPosts, setTrashPosts] = useState<SnackPost[]>([])
  const [trashLoading, setTrashLoading] = useState(false)
  const [restoringPostId, setRestoringPostId] = useState<string | null>(null)
  const [generatingPostId, setGeneratingPostId] = useState<string | null>(null)
  const replyInputRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})

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
  const publishDisabled = !user || publishing || generatingPost || trimmed.length === 0 || draftTooLong
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

  const toggleExpanded = (postId: string) => {
    setExpandedPostIds((current) => ({
      ...current,
      [postId]: !current[postId],
    }))
  }

  const expandAndFocusReply = (postId: string) => {
    setExpandedPostIds((current) => ({ ...current, [postId]: true }))
    setTimeout(() => {
      replyInputRefs.current[postId]?.focus()
    }, 0)
  }

  const handleReplyDraftChange = (postId: string, value: string) => {
    setReplyDrafts((current) => ({
      ...current,
      [postId]: value,
    }))
  }

  const handleSubmitReply = async (postId: string) => {
    const content = (replyDrafts[postId] ?? '').trim()
    if (!user || submittingReplyPostId || content.length === 0) {
      return
    }
    const pendingId = createPendingReplyId(postId)
    const pendingReply: SnackReply = {
      id: pendingId,
      postId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
      userId: user.id,
      isDeleted: false,
      meta: {},
    }

    setSubmittingReplyPostId(postId)
    setError(null)
    setRepliesByPost((current) => ({
      ...current,
      [postId]: [...(current[postId] ?? []), pendingReply],
    }))
    setReplyDrafts((current) => ({ ...current, [postId]: '' }))

    try {
      const reply = await createSnackReply(postId, 'user', content, {})
      setRepliesByPost((current) => ({
        ...current,
        [postId]: (current[postId] ?? []).map((item) => (item.id === pendingId ? reply : item)),
      }))
    } catch (submitError) {
      console.warn('提交追问失败', submitError)
      setRepliesByPost((current) => ({
        ...current,
        [postId]: (current[postId] ?? []).filter((item) => item.id !== pendingId),
      }))
      setError('发送失败，请稍后重试。')
    } finally {
      setSubmittingReplyPostId(null)
    }
  }


  const buildRequestBody = (messagesPayload: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => {
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

    return requestBody
  }

  const requestOpenRouter = async (messagesPayload: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => {
    if (!supabase) {
      throw new Error('Supabase 客户端未配置')
    }
    const { data } = await supabase.auth.getSession()
    const accessToken = data.session?.access_token
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
    if (!accessToken || !anonKey) {
      throw new Error('登录状态异常或环境变量未配置')
    }

    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/openrouter-chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildRequestBody(messagesPayload)),
    })

    if (!response.ok) {
      throw new Error(await response.text())
    }

    const payload = (await response.json()) as Record<string, unknown>
    const choice = (payload?.choices as unknown[] | undefined)?.[0] as
      | Record<string, unknown>
      | undefined
    const message = ((choice?.message as Record<string, unknown>) ?? choice ?? {}) as Record<string, unknown>
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

    return {
      content: content || '（空回复）',
      reasoningText: reasoningText || undefined,
      model: typeof payload.model === 'string' ? payload.model : snackAiConfig.model,
    }
  }

  const handleGeneratePost = async () => {
    if (!user || !supabase || generatingPost || publishing) {
      return
    }
    setGeneratingPost(true)
    setError(null)
    try {
      const basePrompt = snackAiConfig.systemPrompt.trim()
      const syzygyPostPrompt = resolveSyzygyPostPrompt(snackAiConfig.syzygyPostSystemPrompt)
      const now = new Date().toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      const messagesPayload: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
      if (basePrompt) {
        messagesPayload.push({ role: 'system', content: basePrompt })
      }
      messagesPayload.push({ role: 'system', content: syzygyPostPrompt || DEFAULT_SYZYGY_POST_PROMPT })
      messagesPayload.push({ role: 'user', content: `本地时间：${now}\nWrite a short post.` })

      const result = await requestOpenRouter(messagesPayload)
      const created = await createSnackPost(result.content)
      setPosts((current) => [created, ...current])
    } catch (generateError) {
      console.warn('生成观察日志失败', generateError)
      setError('生成失败，请稍后重试。')
    } finally {
      setGeneratingPost(false)
    }
  }

  const handleGenerateReply = async (post: SnackPost) => {
    if (!user || !supabase || generatingPostId) {
      return
    }
    setExpandedPostIds((current) => ({ ...current, [post.id]: true }))
    setGeneratingPostId(post.id)
    setError(null)
    const pendingAssistantId = createPendingReplyId(post.id)
    const pendingAssistantReply: SnackReply = {
      id: pendingAssistantId,
      postId: post.id,
      role: 'assistant',
      content: '生成中…',
      createdAt: new Date().toISOString(),
      userId: user.id,
      isDeleted: false,
      meta: {
        model: snackAiConfig.model,
      },
    }
    setRepliesByPost((current) => ({
      ...current,
      [post.id]: [...(current[post.id] ?? []), pendingAssistantReply],
    }))

    try {
      const messagesPayload = [] as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
      const basePrompt = snackAiConfig.systemPrompt.trim()
      if (basePrompt) {
        messagesPayload.push({ role: 'system', content: basePrompt })
      }
      const syzygyReplyPrompt = resolveSyzygyReplyPrompt(snackAiConfig.syzygyReplySystemPrompt)
      messagesPayload.push({ role: 'system', content: syzygyReplyPrompt || DEFAULT_SYZYGY_REPLY_PROMPT })
      messagesPayload.push({
        role: 'user',
        content: `原帖：${withTimePrefix(post.content, post.createdAt)}`,
      })

      const existingReplies = (repliesByPost[post.id] ?? []).filter(
        (reply) => reply.content && reply.content !== '生成中…',
      )
      const lastReplies = existingReplies.slice(-6)
      if (lastReplies.length > 0) {
        messagesPayload.push({
          role: 'user',
          content: `最近回复：\n${lastReplies
            .map((reply) => `${reply.role === 'assistant' ? 'Syzygy' : '串串'}：${reply.content}`)
            .join('\n')}`,
        })
      }
      const latestUserComment = [...existingReplies].reverse().find((reply) => reply.role === 'user')
      if (latestUserComment) {
        messagesPayload.push({ role: 'user', content: `串串最新留言：${latestUserComment.content}` })
      }

      const result = await requestOpenRouter(messagesPayload)

      setRepliesByPost((current) => ({
        ...current,
        [post.id]: (current[post.id] ?? []).map((item) =>
          item.id === pendingAssistantId ? { ...item, content: result.content } : item,
        ),
      }))

      await createSnackReply(post.id, 'assistant', result.content, {
        provider: 'openrouter',
        model: result.model,
        reasoning_text: result.reasoningText,
      })
      const latestReplies = await fetchSnackRepliesByPost(post.id)
      setRepliesByPost((current) => ({
        ...current,
        [post.id]: latestReplies,
      }))
    } catch (generateError) {
      console.warn('生成零食回复失败', generateError)
      setRepliesByPost((current) => ({
        ...current,
        [post.id]: (current[post.id] ?? []).filter((item) => item.id !== pendingAssistantId),
      }))
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
              <div className="post-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void handleGeneratePost()}
                  disabled={generatingPost || publishing}
                  title="生成观察日志"
                >
                  {generatingPost ? '🤖 生成中…' : '🤖'}
                </button>
                <button type="button" className="primary" onClick={handlePublish} disabled={publishDisabled}>
                  {publishing ? '发布中…' : '发布'}
                </button>
              </div>
            </div>
            {draftTooLong ? <p className="error">内容不能超过 1000 字。</p> : null}
          </section>

          <main className="snacks-feed">
            {loading ? <p className="tips">加载中…</p> : null}
            {!loading && posts.length === 0 ? <p className="tips">还没有记录，来发布第一条吧。</p> : null}
            {posts.map((post) => {
              const replies = repliesByPost[post.id] ?? []
              const isExpanded = expandedPostIds[post.id] ?? false
              const isGenerating = generatingPostId === post.id
              const latestReply = replies.at(-1)
              const replyDraft = replyDrafts[post.id] ?? ''
              return (
                <article key={post.id} className="post-card">
                  <p className="post-content">{post.content}</p>
                  <div className="post-footer">
                    <span>{formatChineseTime(post.createdAt)}</span>
                    <div className="post-actions">
                      <button type="button" className="ghost danger" onClick={() => setPendingDelete(post)}>
                        删除
                      </button>
                    </div>
                  </div>

                  <div className="reply-collapsed-row">
                    <button
                      type="button"
                      className="reply-toggle"
                      onClick={() => toggleExpanded(post.id)}
                      aria-expanded={isExpanded}
                    >
                      <span className="reply-toggle-main">回复（{replies.length}）</span>
                      <span className="reply-preview">{getReplyPreview(latestReply)}</span>
                      <span className="reply-chevron">{isExpanded ? '▾' : '▸'}</span>
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void handleGenerateReply(post)}
                      disabled={generatingPostId !== null}
                      title="生成 AI 回复"
                    >
                      🐹
                    </button>
                    <button type="button" className="ghost" onClick={() => expandAndFocusReply(post.id)}>
                      回复
                    </button>
                  </div>

                  {isExpanded ? (
                    <div className="reply-list">
                      {replies.map((reply) => (
                        <div key={reply.id} className={`reply-bubble ${reply.role === 'assistant' ? 'assistant' : 'user'}`}>
                          <div className="reply-content-wrap">
                            <div className="reply-role">
                              {reply.role === 'assistant' ? (
                                <>
                                  <span>Syzygy</span>
                                  <span className="reply-model-badge">{reply.meta?.model || '未知模型'}</span>
                                </>
                              ) : (
                                <span>串串</span>
                              )}
                            </div>
                            {reply.role === 'assistant' ? (
                              <div className="assistant-markdown">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{reply.content}</ReactMarkdown>
                              </div>
                            ) : (
                              <p>{reply.content}</p>
                            )}
                            <span className="reply-time">{formatChineseTime(reply.createdAt)}</span>
                          </div>
                          <button type="button" className="ghost danger" onClick={() => setPendingDeleteReply(reply)}>
                            删除
                          </button>
                        </div>
                      ))}
                      {isGenerating ? <div className="reply-bubble pending">生成中…</div> : null}

                      <div className="reply-composer">
                        <textarea
                          ref={(node) => {
                            replyInputRefs.current[post.id] = node
                          }}
                          rows={2}
                          placeholder="写下你的回复…"
                          value={replyDraft}
                          onChange={(event) => handleReplyDraftChange(post.id, event.target.value)}
                        />
                        <button
                          type="button"
                          className="primary"
                          onClick={() => void handleSubmitReply(post.id)}
                          disabled={submittingReplyPostId === post.id || replyDraft.trim().length === 0}
                        >
                          {submittingReplyPostId === post.id ? '发送中…' : '发送'}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              )
            })}
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
