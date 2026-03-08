import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ForumAiProfile } from '../types'
import { createForumThread, fetchAllMemoryEntries, fetchForumAiProfiles } from '../storage/supabaseSync'
import {
  FORUM_AI_SLOTS,
  defaultForumProfile,
  loadForumGlobalAiConfig,
  requestForumAiContent,
  type ForumGlobalAiConfig,
} from './forumShared'
import './ForumPage.css'

type AuthorDraft = 'user' | 'ai-1' | 'ai-2' | 'ai-3'

const resolveAuthorSlot = (draft: AuthorDraft): number | null => {
  if (draft === 'user') {
    return null
  }
  const [, slotText] = draft.split('-')
  const slot = Number(slotText)
  return Number.isInteger(slot) && FORUM_AI_SLOTS.includes(slot as (typeof FORUM_AI_SLOTS)[number]) ? slot : null
}

const ForumNewThreadPage = () => {
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState<ForumAiProfile[]>([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [authorDraft, setAuthorDraft] = useState<AuthorDraft>('user')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [globalAiConfig, setGlobalAiConfig] = useState<ForumGlobalAiConfig | null>(null)

  const selectedSlot = resolveAuthorSlot(authorDraft)
  const authorIsAi = selectedSlot !== null

  useEffect(() => {
    const loadProfiles = async () => {
      setLoading(true)
      try {
        const [list, config] = await Promise.all([fetchForumAiProfiles(), loadForumGlobalAiConfig()])
        setProfiles(list)
        setGlobalAiConfig(config)
      } catch (loadError) {
        console.warn('加载 AI 配置失败', loadError)
      } finally {
        setLoading(false)
      }
    }
    void loadProfiles()
  }, [])

  const profileLookup = useMemo(() => {
    const map = new Map<number, ForumAiProfile>()
    profiles.forEach((item) => map.set(item.slotIndex, item))
    return map
  }, [profiles])

  const selectedAiProfile = useMemo(() => {
    if (!selectedSlot) {
      return null
    }
    const existing = profileLookup.get(selectedSlot)
    if (existing) {
      return existing
    }
    return {
      ...defaultForumProfile(selectedSlot),
      id: `slot-${selectedSlot}`,
      userId: '',
      createdAt: '',
      updatedAt: '',
    }
  }, [profileLookup, selectedSlot])

  const createDirectThread = async (nextContent: string) => {
    if (!title.trim() || !nextContent.trim()) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const created = await createForumThread({
        title: title.trim(),
        content: nextContent.trim(),
        authorType: authorIsAi ? 'ai' : 'user',
        authorSlot: selectedSlot,
        authorName: authorIsAi ? selectedAiProfile?.displayName : undefined,
      })
      navigate(`/forum/thread/${created.id}`)
    } catch (submitError) {
      console.warn('创建主题失败', submitError)
      setError('创建主题失败，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreate = async () => {
    if (authorIsAi) {
      setError('已选择 AI 作者，请使用“生成 AI 主题”按钮。')
      return
    }
    await createDirectThread(content)
  }

  const handleGenerateAiThread = async () => {
    if (!authorIsAi || !selectedSlot) {
      setError('请先选择 AI 作者（AI Slot 1/2/3）后再生成。')
      return
    }
    if (!globalAiConfig) {
      setError('AI 模型配置尚未就绪，请稍后重试或前往设置页检查。')
      return
    }
    const profile = selectedAiProfile
    if (!profile?.enabled) {
      setError('该 AI 档案未启用，请先在 Forum 设置页启用。')
      return
    }
    setGenerating(true)
    setError(null)
    try {
      const memoryEntries = await fetchAllMemoryEntries()
      const generated = await requestForumAiContent({
        profile,
        memoryEntries,
        globalModelConfig: globalAiConfig,
        task: 'new-thread',
        thread: {
          id: 'draft-thread',
          userId: profile.userId,
          title: '（由 AI 自拟）',
          content: content.trim() || '（空草稿）',
          authorType: 'user',
          authorSlot: null,
          authorName: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        replies: [],
        userPrompt: content.trim() || undefined,
      })
      setTitle(generated.title)
      setContent(generated.body)
      setSubmitting(true)
      const created = await createForumThread({
        title: generated.title,
        content: generated.body,
        authorType: 'ai',
        authorSlot: selectedSlot,
        authorName: profile.displayName,
      })
      navigate(`/forum/thread/${created.id}`)
    } catch (generateError) {
      console.warn('生成 AI 主题失败', generateError)
      setError('生成失败，请检查模型配置后重试。')
    } finally {
      setSubmitting(false)
      setGenerating(false)
    }
  }

  return (
    <div className="forum-page app-shell__content">
      <header className="forum-header glass-card">
        <button type="button" className="btn-secondary" onClick={() => navigate('/forum')}>
          返回列表
        </button>
        <h1 className="ui-title">新建主题</h1>
      </header>

      <section className="glass-card forum-editor">
        {loading ? <p>加载 AI 档案中…</p> : null}
        {authorIsAi ? (
          <p className="forum-settings-summary">标题将由 AI 自动生成</p>
        ) : (
          <label>
            标题
            <input className="input-glass" value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
        )}
        <label>
          作者
          <select
            className="input-glass"
            value={authorDraft}
            onChange={(event) => setAuthorDraft(event.target.value as AuthorDraft)}
          >
            <option value="user">我（直接发布）</option>
            {FORUM_AI_SLOTS.map((slot) => {
              const profile = profileLookup.get(slot) ?? {
                ...defaultForumProfile(slot),
                id: `slot-${slot}`,
                userId: '',
                createdAt: '',
                updatedAt: '',
              }
              return (
                <option key={slot} value={`ai-${slot}`}>
                  {profile.displayName}（AI Slot {slot}）
                </option>
              )
            })}
          </select>
        </label>
        <label>
          {authorIsAi ? '写作方向（可选）' : '正文'}
          <textarea
            className="textarea-glass"
            rows={8}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={authorIsAi ? '可填写 AI 写作方向。' : '输入你要发的主题内容。'}
          />
        </label>
        {error ? <p className="forum-error">{error}</p> : null}
        <div className="forum-editor__actions">
          <button type="button" className="btn-primary" disabled={submitting || generating} onClick={handleCreate}>
            直接发布（用户）
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={submitting || generating}
            onClick={handleGenerateAiThread}
          >
            {generating ? 'AI 生成中…' : '生成 AI 主题'}
          </button>
        </div>
      </section>
    </div>
  )
}

export default ForumNewThreadPage
