import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { ForumAiProfile, ForumReply, ForumThread } from '../types'
import {
  createForumReply,
  fetchAllMemoryEntries,
  fetchForumAiProfiles,
  fetchForumRepliesByThread,
  fetchForumThreadById,
} from '../storage/supabaseSync'
import { FORUM_AI_SLOTS, defaultForumProfile, getForumAuthorLabel, requestForumAiContent } from './forumShared'
import './ForumPage.css'

const formatTime = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

const ForumThreadPage = () => {
  const navigate = useNavigate()
  const { id } = useParams()
  const [thread, setThread] = useState<ForumThread | null>(null)
  const [replies, setReplies] = useState<ForumReply[]>([])
  const [profiles, setProfiles] = useState<ForumAiProfile[]>([])
  const [replyContent, setReplyContent] = useState('')
  const [targetReplyId, setTargetReplyId] = useState<string>('thread-root')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [generatingSlot, setGeneratingSlot] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!id) {
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [threadData, replyData, profileData] = await Promise.all([
        fetchForumThreadById(id),
        fetchForumRepliesByThread(id),
        fetchForumAiProfiles(),
      ])
      setThread(threadData)
      setReplies(replyData)
      setProfiles(profileData)
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

  const profileMap = useMemo(() => {
    const map = new Map<number, ForumAiProfile>()
    profiles.forEach((item) => map.set(item.slotIndex, item))
    return map
  }, [profiles])

  const targetLabel = useMemo(() => {
    if (targetReplyId === 'thread-root') {
      return '主题帖'
    }
    const target = replies.find((reply) => reply.id === targetReplyId)
    if (!target) {
      return '主题帖'
    }
    return `${getForumAuthorLabel(target.authorType, target.authorSlot, profiles)} 的回复`
  }, [profiles, replies, targetReplyId])

  const handleSubmitReply = async () => {
    if (!thread || !replyContent.trim()) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const created = await createForumReply({
        threadId: thread.id,
        content: replyContent.trim(),
        authorType: 'user',
        replyToType: targetReplyId === 'thread-root' ? 'thread' : 'reply',
        replyToReplyId: targetReplyId === 'thread-root' ? null : targetReplyId,
      })
      setReplies((current) => [...current, created])
      setReplyContent('')
      setTargetReplyId('thread-root')
    } catch (submitError) {
      console.warn('发送回复失败', submitError)
      setError('发送失败，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  const handleGenerateAiReply = async (slot: number) => {
    if (!thread || generatingSlot) {
      return
    }
    const profile = profileMap.get(slot)
    if (!profile?.enabled) {
      setError('该 AI 档案未启用，请先到设置页开启。')
      return
    }
    setGeneratingSlot(slot)
    setError(null)
    try {
      const memoryEntries = await fetchAllMemoryEntries()
      const generated = await requestForumAiContent({
        profile,
        thread,
        replies,
        memoryEntries,
        task: 'reply',
        replyTargetLabel: targetLabel,
        userPrompt: replyContent.trim() || undefined,
      })
      const created = await createForumReply({
        threadId: thread.id,
        content: generated,
        authorType: 'ai',
        authorSlot: slot,
        replyToType: targetReplyId === 'thread-root' ? 'thread' : 'reply',
        replyToReplyId: targetReplyId === 'thread-root' ? null : targetReplyId,
      })
      setReplies((current) => [...current, created])
      setReplyContent('')
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
    <div className="forum-page app-shell__content">
      <header className="forum-header glass-card">
        <button type="button" className="btn-secondary" onClick={() => navigate('/forum')}>
          返回列表
        </button>
        <h1 className="ui-title">主题详情</h1>
      </header>

      <article className="glass-card forum-root-post">
        <h2>{thread.title}</h2>
        <p>{thread.content}</p>
        <footer>
          <strong>{getForumAuthorLabel(thread.authorType, thread.authorSlot, profiles)}</strong>
          <small>{formatTime(thread.createdAt)}</small>
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
                ? getForumAuthorLabel(thread.authorType, thread.authorSlot, profiles)
                : target
                  ? getForumAuthorLabel(target.authorType, target.authorSlot, profiles)
                  : '未知目标'
            return (
              <article className="forum-reply-item" key={reply.id}>
                <header>
                  <strong>{getForumAuthorLabel(reply.authorType, reply.authorSlot, profiles)}</strong>
                  <small>{formatTime(reply.createdAt)}</small>
                </header>
                <p>{reply.content}</p>
                <footer>
                  <span>#{index + 1}</span>
                  <span>回复给：{targetName}</span>
                </footer>
              </article>
            )
          })}
        </div>
      </section>

      <section className="glass-card forum-editor">
        <h3 className="ui-title">手动回复</h3>
        <label>
          回复目标
          <select
            className="input-glass"
            value={targetReplyId}
            onChange={(event) => setTargetReplyId(event.target.value)}
          >
            <option value="thread-root">主题帖</option>
            {replies.map((reply, index) => (
              <option key={reply.id} value={reply.id}>
                回复 #{index + 1}（{getForumAuthorLabel(reply.authorType, reply.authorSlot, profiles)}）
              </option>
            ))}
          </select>
        </label>
        <label>
          内容 / AI 指令
          <textarea
            className="textarea-glass"
            rows={5}
            value={replyContent}
            onChange={(event) => setReplyContent(event.target.value)}
            placeholder="输入手动回复；也可填写给 AI 的指令后点击下方按钮。"
          />
        </label>
        {error ? <p className="forum-error">{error}</p> : null}
        <div className="forum-editor__actions">
          <button type="button" className="btn-primary" disabled={submitting} onClick={handleSubmitReply}>
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
                disabled={Boolean(generatingSlot) || !profile.enabled}
                onClick={() => void handleGenerateAiReply(slot)}
              >
                {generatingSlot === slot ? '生成中…' : `${profile.displayName} 生成回复`}
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

export default ForumThreadPage
