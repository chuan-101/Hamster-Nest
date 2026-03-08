import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { ForumAiProfile, ForumReply, ForumThread } from '../types'
import {
  createForumReply,
  deleteForumReply,
  deleteForumThread,
  fetchAllMemoryEntries,
  fetchForumAiProfiles,
  fetchForumRepliesByThread,
  fetchForumThreadById,
} from '../storage/supabaseSync'
import ConfirmDialog from '../components/ConfirmDialog'
import { FORUM_AI_SLOTS, defaultForumProfile, getForumAuthorLabel, loadForumGlobalAiConfig, requestForumAiContent, type ForumGlobalAiConfig } from './forumShared'
import './ForumPage.css'

const formatTime = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

const ForumThreadPage = () => {
  const navigate = useNavigate()
  const { id } = useParams()
  const [thread, setThread] = useState<ForumThread | null>(null)
  const [replies, setReplies] = useState<ForumReply[]>([])
  const [profiles, setProfiles] = useState<ForumAiProfile[]>([])
  const [rootReplyContent, setRootReplyContent] = useState('')
  const [activeInlineReplyId, setActiveInlineReplyId] = useState<string | null>(null)
  const [inlineReplyContent, setInlineReplyContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [generatingSlot, setGeneratingSlot] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [pendingDeleteThread, setPendingDeleteThread] = useState(false)
  const [pendingDeleteReplyId, setPendingDeleteReplyId] = useState<string | null>(null)
  const [deletingThread, setDeletingThread] = useState(false)
  const [deletingReplyId, setDeletingReplyId] = useState<string | null>(null)
  const [globalAiConfig, setGlobalAiConfig] = useState<ForumGlobalAiConfig | null>(null)

  const refresh = useCallback(async () => {
    if (!id) {
      return
    }
    setLoading(true)
    setError(null)
    setSuccessMessage(null)
    try {
      const [threadData, replyData, profileData, globalConfig] = await Promise.all([
        fetchForumThreadById(id),
        fetchForumRepliesByThread(id),
        fetchForumAiProfiles(),
        loadForumGlobalAiConfig(),
      ])
      setThread(threadData)
      setReplies(replyData)
      setProfiles(profileData)
      setGlobalAiConfig(globalConfig)
    } catch (loadError) {
      console.warn('加载论坛主题失败', loadError)
      setError('加载失败，请刷新重试。')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void refresh()
  }, [refresh])


  const handleDeleteThread = async () => {
    if (!thread || deletingThread) {
      return
    }
    setDeletingThread(true)
    setError(null)
    setSuccessMessage(null)
    try {
      await deleteForumThread(thread.id)
      navigate('/forum', { replace: true, state: { forumSuccessMessage: '主题已删除。' } })
    } catch (deleteError) {
      console.warn('删除主题失败', deleteError)
      setError('删除主题失败，请稍后重试。')
    } finally {
      setDeletingThread(false)
      setPendingDeleteThread(false)
    }
  }

  const handleDeleteReply = async () => {
    if (!thread || !pendingDeleteReplyId) {
      return
    }
    setDeletingReplyId(pendingDeleteReplyId)
    setError(null)
    setSuccessMessage(null)
    try {
      await deleteForumReply(pendingDeleteReplyId, thread.id)
      setReplies((current) => current.filter((item) => item.id !== pendingDeleteReplyId))
      setActiveInlineReplyId((current) => (current === pendingDeleteReplyId ? null : current))
      setSuccessMessage('回复已删除。')
      setPendingDeleteReplyId(null)
    } catch (deleteError) {
      console.warn('删除回复失败', deleteError)
      setError('删除回复失败，请稍后重试。')
    } finally {
      setDeletingReplyId(null)
    }
  }

  const profileMap = useMemo(() => {
    const map = new Map<number, ForumAiProfile>()
    profiles.forEach((item) => map.set(item.slotIndex, item))
    return map
  }, [profiles])

  const getReplyTargetLabel = useCallback(
    (targetReplyId: string | null) => {
      if (!targetReplyId) {
        return '主题帖'
      }
      const target = replies.find((reply) => reply.id === targetReplyId)
      if (!target) {
        return '主题帖'
      }
      return `${getForumAuthorLabel(target.authorType, target.authorSlot, profiles, target.authorName)} 的回复`
    },
    [profiles, replies],
  )

  const rootTargetLabel = useMemo(() => {
    if (!thread) {
      return '主题帖'
    }
    return `${getForumAuthorLabel(thread.authorType, thread.authorSlot, profiles, thread.authorName)} 的主题帖`
  }, [profiles, thread])

  const handleSubmitReply = async (params: {
    content: string
    targetReplyId: string | null
    onSuccess: () => void
  }) => {
    if (!thread || !params.content.trim()) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const created = await createForumReply({
        threadId: thread.id,
        content: params.content.trim(),
        authorType: 'user',
        replyToType: params.targetReplyId ? 'reply' : 'thread',
        replyToReplyId: params.targetReplyId,
      })
      setReplies((current) => [...current, created])
      params.onSuccess()
    } catch (submitError) {
      console.warn('发送回复失败', submitError)
      setError('发送失败，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  const handleGenerateAiReply = async (params: {
    slot: number
    content: string
    targetReplyId: string | null
    onSuccess: () => void
  }) => {
    if (!thread || generatingSlot || !globalAiConfig) {
      return
    }
    const profile = profileMap.get(params.slot)
    if (!profile?.enabled) {
      setError('该 AI 档案未启用，请先到设置页开启。')
      return
    }
    setGeneratingSlot(params.slot)
    setError(null)
    try {
      const memoryEntries = await fetchAllMemoryEntries()
      const generated = await requestForumAiContent({
        profile,
        thread,
        replies,
        memoryEntries,
        globalModelConfig: globalAiConfig,
        task: 'reply',
        replyTargetLabel: getReplyTargetLabel(params.targetReplyId),
        userPrompt: params.content.trim() || undefined,
      })
      const created = await createForumReply({
        threadId: thread.id,
        content: generated,
        authorType: 'ai',
        authorSlot: params.slot,
        replyToType: params.targetReplyId ? 'reply' : 'thread',
        replyToReplyId: params.targetReplyId,
      })
      setReplies((current) => [...current, created])
      params.onSuccess()
    } catch (generateError) {
      console.warn('AI 回复失败', generateError)
      setError('AI 生成失败，请检查配置后重试。')
    } finally {
      setGeneratingSlot(null)
    }
  }

  if (loading) {
    return <div className="forum-page app-shell__content forum-loading">加载中…</div>
  }

  if (!thread) {
    return (
      <div className="forum-page app-shell__content forum-loading">
        <p>主题不存在或已被删除。</p>
        <button type="button" className="btn-secondary" onClick={() => navigate('/forum')}>
          返回论坛
        </button>
      </div>
    )
  }

  return (
    <div className="forum-page forum-thread-page app-shell__content">
      <header className="forum-header glass-card">
        <button type="button" className="btn-secondary" onClick={() => navigate('/forum')}>
          返回列表
        </button>
        <h1 className="ui-title">主题详情</h1>
      </header>

      <article className="glass-card forum-root-post forum-bbs-card">
        <header className="forum-bbs-card__author">
          <strong>{getForumAuthorLabel(thread.authorType, thread.authorSlot, profiles, thread.authorName)}</strong>
          <small>{formatTime(thread.createdAt)}</small>
          <span className="forum-floor-tag">#1</span>
        </header>
        <div className="forum-bbs-card__content">
          <h2>{thread.title}</h2>
          <p>{thread.content}</p>
        </div>
        <footer>
          <button type="button" className="btn-secondary" onClick={() => setPendingDeleteThread(true)}>
            删除主题
          </button>
        </footer>
      </article>

      <section className="glass-card forum-thread-list">
        <h3 className="ui-title">回复（按时间顺序）</h3>
        <div className="forum-thread-list__items">
          {replies.map((reply, index) => {
            const target =
              reply.replyToType === 'reply' ? replies.find((item) => item.id === reply.replyToReplyId) : null
            const targetName =
              reply.replyToType === 'thread'
                ? getForumAuthorLabel(thread.authorType, thread.authorSlot, profiles, thread.authorName)
                : target
                  ? getForumAuthorLabel(target.authorType, target.authorSlot, profiles, target.authorName)
                  : '未知目标'
            return (
              <article className="forum-reply-item" key={reply.id}>
                <header className="forum-bbs-card__author">
                  <strong>{getForumAuthorLabel(reply.authorType, reply.authorSlot, profiles, reply.authorName)}</strong>
                  <small>{formatTime(reply.createdAt)}</small>
                  <span className="forum-floor-tag">#{index + 2}</span>
                </header>
                <div className="forum-bbs-card__content">
                  <p>{reply.content}</p>
                </div>
                <footer className="forum-reply-item__footer">
                  <span>回复给：{targetName}</span>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setError(null)
                      setSuccessMessage(null)
                      setInlineReplyContent('')
                      setActiveInlineReplyId((current) => (current === reply.id ? null : reply.id))
                    }}
                  >
                    {activeInlineReplyId === reply.id ? '收起回复' : '回复'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setPendingDeleteReplyId(reply.id)}
                    disabled={deletingReplyId === reply.id}
                  >
                    {deletingReplyId === reply.id ? '删除中…' : '删除'}
                  </button>
                </footer>
                {activeInlineReplyId === reply.id ? (
                  <div className="forum-inline-editor">
                    <p className="forum-inline-editor__target">
                      回复给：{getForumAuthorLabel(reply.authorType, reply.authorSlot, profiles, reply.authorName)}
                    </p>
                    <label>
                      内容 / AI 指令
                      <div className="forum-terminal-field">
                        <textarea
                          className="textarea-glass"
                          rows={4}
                          value={inlineReplyContent}
                          onChange={(event) => setInlineReplyContent(event.target.value)}
                          placeholder="输入对该回复的内容；也可填写给 AI 的指令后点击下方按钮。"
                        />
                      </div>
                    </label>
                    <div className="forum-editor__actions">
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={submitting}
                        onClick={() =>
                          void handleSubmitReply({
                            content: inlineReplyContent,
                            targetReplyId: reply.id,
                            onSuccess: () => {
                              setInlineReplyContent('')
                              setActiveInlineReplyId(null)
                            },
                          })
                        }
                      >
                        发布用户回复
                      </button>
                      {FORUM_AI_SLOTS.map((slot) => {
                        const profile = profileMap.get(slot) ?? {
                          ...defaultForumProfile(slot),
                          id: `slot-${slot}`,
                          userId: '',
                          createdAt: '',
                          updatedAt: '',
                        }
                        return (
                          <button
                            key={`${reply.id}-${slot}`}
                            type="button"
                            className="btn-secondary"
                            disabled={Boolean(generatingSlot) || !profile.enabled || !globalAiConfig}
                            onClick={() =>
                              void handleGenerateAiReply({
                                slot,
                                content: inlineReplyContent,
                                targetReplyId: reply.id,
                                onSuccess: () => {
                                  setInlineReplyContent('')
                                  setActiveInlineReplyId(null)
                                },
                              })
                            }
                          >
                            {generatingSlot === slot ? '生成中…' : `${profile.displayName} 生成回复`}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      </section>

      <section className="glass-card forum-editor">
        <h3 className="ui-title">回复主题帖</h3>
        <p className="forum-editor__target">目标：{rootTargetLabel}</p>
        <label>
          内容 / AI 指令
          <div className="forum-terminal-field">
            <textarea
              className="textarea-glass"
              rows={5}
              value={rootReplyContent}
              onChange={(event) => setRootReplyContent(event.target.value)}
              placeholder="输入对主题帖的回复；也可填写给 AI 的指令后点击下方按钮。"
            />
          </div>
        </label>
        {error ? <p className="forum-error">{error}</p> : null}
        {successMessage ? <p className="forum-success">{successMessage}</p> : null}
        <div className="forum-editor__actions">
          <button
            type="button"
            className="btn-primary"
            disabled={submitting}
            onClick={() =>
              void handleSubmitReply({
                content: rootReplyContent,
                targetReplyId: null,
                onSuccess: () => setRootReplyContent(''),
              })
            }
          >
            发布用户回复
          </button>
          {FORUM_AI_SLOTS.map((slot) => {
            const profile = profileMap.get(slot) ?? {
              ...defaultForumProfile(slot),
              id: `slot-${slot}`,
              userId: '',
              createdAt: '',
              updatedAt: '',
            }
            return (
              <button
                key={slot}
                type="button"
                className="btn-secondary"
                disabled={Boolean(generatingSlot) || !profile.enabled || !globalAiConfig}
                onClick={() =>
                  void handleGenerateAiReply({
                    slot,
                    content: rootReplyContent,
                    targetReplyId: null,
                    onSuccess: () => setRootReplyContent(''),
                  })
                }
              >
                {generatingSlot === slot ? '生成中…' : `${profile.displayName} 生成回复`}
              </button>
            )
          })}
        </div>
      </section>

      <ConfirmDialog
        open={pendingDeleteThread}
        title="确定删除这个主题吗？"
        description="删除后将同时移除该主题下的全部回复。"
        confirmLabel="删除"
        cancelLabel="取消"
        confirmDisabled={deletingThread}
        cancelDisabled={deletingThread}
        onCancel={() => setPendingDeleteThread(false)}
        onConfirm={() => void handleDeleteThread()}
      />
      <ConfirmDialog
        open={pendingDeleteReplyId !== null}
        title="确定删除这条回复吗？"
        confirmLabel="删除"
        cancelLabel="取消"
        confirmDisabled={deletingReplyId !== null}
        cancelDisabled={deletingReplyId !== null}
        onCancel={() => setPendingDeleteReplyId(null)}
        onConfirm={() => void handleDeleteReply()}
      />
    </div>
  )
}

export default ForumThreadPage
