import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../supabase/client'
import type { ChatSession, LetterEntry } from '../types'
import {
  createLetter,
  deleteLetter,
  fetchAllMemoryEntries,
  fetchLetters,
  linkLetterToConversation,
  markLetterAsRead,
} from '../storage/supabaseSync'
import { ensureUserSettings } from '../storage/userSettings'
import { formatLocalTimestamp } from '../utils/time'
import './LettersPage.css'
import { maybeInjectTimelineContext } from '../utils/timelineAutoInject'

const PREVIEW_LIMIT = 30
const LETTER_MEMORY_LIMIT = 20
const LETTER_HELPER_INSTRUCTION = 'Write a warm check-in letter in Chinese. Keep it concise, sincere, and personal.'

const ISO_TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g

const formatTimestamp = (value: string) => formatLocalTimestamp(value)

const formatInlineTimestamps = (value: string) =>
  value.replaceAll(ISO_TIMESTAMP_PATTERN, (match) => formatTimestamp(match))

const getPreview = (content: string) => {
  const compact = content.replace(/\s+/g, ' ').trim()
  if (compact.length <= PREVIEW_LIMIT) {
    return compact
  }
  return `${compact.slice(0, PREVIEW_LIMIT)}…`
}

const getMetaLabel = (letter: LetterEntry) => {
  if (letter.module) {
    return letter.module
  }
  if (letter.triggerReason) {
    return formatInlineTimestamps(letter.triggerReason)
  }
  return letter.triggerType
}

const buildMemoryContext = async () => {
  const memoryEntries = await fetchAllMemoryEntries()
  const usableEntries = memoryEntries
    .filter((entry) => !entry.isDeleted && entry.content.trim())
    .slice(-LETTER_MEMORY_LIMIT)

  if (usableEntries.length === 0) {
    return '无'
  }

  return usableEntries
    .map((entry, index) => `${index + 1}. (${entry.status}) ${entry.content.trim()}`)
    .join('\n')
}

const LettersPage = ({
  sessions,
  onCreateSession,
  onUnreadStateChange,
}: {
  sessions: ChatSession[]
  onCreateSession: (title?: string) => Promise<ChatSession>
  onUnreadStateChange?: (hasUnread: boolean) => void
}) => {
  const location = useLocation()
  const navigate = useNavigate()
  const [letters, setLetters] = useState<LetterEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeLetterId, setActiveLetterId] = useState<string | null>(null)
  const [defaultModelId, setDefaultModelId] = useState('openrouter/auto')
  const [manualPrompt, setManualPrompt] = useState('')
  const [manualGenerating, setManualGenerating] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deletingLetterId, setDeletingLetterId] = useState<string | null>(null)
  const [linkPickerOpen, setLinkPickerOpen] = useState(false)
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)

  const routeOpenLetterId = useMemo(() => {
    const stateOpenLetterId =
      typeof (location.state as { openLetterId?: unknown } | null)?.openLetterId === 'string'
        ? ((location.state as { openLetterId?: string } | null)?.openLetterId ?? null)
        : null
    if (stateOpenLetterId) {
      return stateOpenLetterId
    }
    const searchParams = new URLSearchParams(location.search)
    return searchParams.get('open')
  }, [location.search, location.state])

  const activeLetter = useMemo(
    () => letters.find((letter) => letter.id === activeLetterId) ?? null,
    [activeLetterId, letters],
  )

  const loadLetters = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchLetters()
      setLetters(list)
      onUnreadStateChange?.(list.some((letter) => !letter.isRead))
    } catch (loadError) {
      console.warn('加载来信失败', loadError)
      setError('加载失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }, [onUnreadStateChange])

  useEffect(() => {
    void loadLetters()
  }, [loadLetters])

  useEffect(() => {
    if (loading || !routeOpenLetterId) {
      return
    }
    const target = letters.find((letter) => letter.id === routeOpenLetterId)
    if (!target) {
      return
    }
    void handleOpenLetter(target)
  }, [letters, loading, routeOpenLetterId])

  useEffect(() => {
    let active = true
    const client = supabase
    if (!client) {
      return () => {
        active = false
      }
    }

    const loadDefaultModel = async () => {
      try {
        const { data, error } = await client.auth.getUser()
        if (error || !data.user) {
          return
        }
        const settings = await ensureUserSettings(data.user.id)
        if (!active) {
          return
        }
        setDefaultModelId(settings.defaultModel.trim() || 'openrouter/auto')
      } catch (settingsError) {
        console.warn('加载默认模型失败', settingsError)
      }
    }

    void loadDefaultModel()

    return () => {
      active = false
    }
  }, [])

  async function handleOpenLetter(letter: LetterEntry) {
    setActiveLetterId(letter.id)
    if (letter.isRead) {
      return
    }
    setLetters((current) => {
      const nextLetters = current.map((item) => (item.id === letter.id ? { ...item, isRead: true } : item))
      onUnreadStateChange?.(nextLetters.some((item) => !item.isRead))
      return nextLetters
    })
    try {
      await markLetterAsRead(letter.id)
    } catch (markError) {
      console.warn('标记已读失败', markError)
    }
  }

  useEffect(() => {
    setLinkPickerOpen(false)
    setLinkError(null)
  }, [activeLetterId])

  const handleManualGenerate = async () => {
    if (manualGenerating || !supabase) {
      return
    }
    setManualGenerating(true)
    setManualError(null)
    try {
      const [{ data }, { data: userData, error: userError }] = await Promise.all([
        supabase.auth.getSession(),
        supabase.auth.getUser(),
      ])
      const accessToken = data.session?.access_token
      const user = userData.user
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
      if (!accessToken || !anonKey || userError || !user) {
        throw new Error('登录状态异常')
      }

      const [settings, memoryContext] = await Promise.all([
        ensureUserSettings(user.id),
        buildMemoryContext(),
      ])
      const appSystemPrompt = settings.systemPrompt.trim()
      const letterReplyPrompt = settings.letterReplySystemPrompt.trim()
      const modelId = settings.defaultModel.trim() || 'openrouter/auto'
      setDefaultModelId(modelId)

      const messages = await maybeInjectTimelineContext(
        [
          ...(appSystemPrompt
            ? [{ role: 'system' as const, content: appSystemPrompt }]
            : []),
          {
            role: 'system' as const,
            content: `Memory context (latest user memory entries):\n${memoryContext}`,
          },
          ...(letterReplyPrompt
            ? [{ role: 'system' as const, content: letterReplyPrompt }]
            : []),
          {
            role: 'system' as const,
            content: LETTER_HELPER_INSTRUCTION,
          },
          {
            role: 'user' as const,
            content: manualPrompt.trim() || 'Write a check-in style letter for today.',
          },
        ],
        'letter',
      )

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/openrouter-chat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          modelId: modelId,
          module: 'letter',
          stream: false,
          messages,
        }),
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }
      const payload = (await response.json()) as Record<string, unknown>
      const choice = (payload.choices as Record<string, unknown>[] | undefined)?.[0]
      const message = (choice?.message as Record<string, unknown> | undefined) ?? choice
      const content =
        typeof message?.content === 'string'
          ? message.content
          : typeof choice?.text === 'string'
            ? choice.text
            : ''
      const finalContent = content.trim() || '（空回复）'

      const created = await createLetter({
        model: modelId,
        content: finalContent,
        triggerType: 'manual',
        triggerReason: null,
        module: 'letter',
      })
      setLetters((current) => {
        const nextLetters = [created, ...current]
        onUnreadStateChange?.(nextLetters.some((letter) => !letter.isRead))
        return nextLetters
      })
      setActiveLetterId(created.id)
    } catch (generateError) {
      console.warn('手动生成来信失败', generateError)
      setManualError('生成失败，请稍后重试。')
    } finally {
      setManualGenerating(false)
    }
  }

  const handleDeleteActiveLetter = async () => {
    if (!activeLetter || deletingLetterId) {
      return
    }
    const confirmed = window.confirm('确定删除这封来信吗？')
    if (!confirmed) {
      return
    }

    setDeleteError(null)
    setDeletingLetterId(activeLetter.id)
    try {
      await deleteLetter(activeLetter.id)
      setLetters((current) => {
        const nextLetters = current.filter((letter) => letter.id !== activeLetter.id)
        onUnreadStateChange?.(nextLetters.some((letter) => !letter.isRead))
        return nextLetters
      })
      setActiveLetterId(null)
    } catch (deleteActionError) {
      console.warn('删除来信失败', deleteActionError)
      setDeleteError('删除失败，请稍后重试。')
    } finally {
      setDeletingLetterId(null)
    }
  }

  const openChatSession = useCallback(
    (sessionId: string) => {
      navigate(`/chat/${sessionId}`)
    },
    [navigate],
  )

  const handleLinkToSession = useCallback(
    async (sessionId: string) => {
      if (!activeLetter || linking) {
        return
      }
      setLinkError(null)
      setLinking(true)
      try {
        await linkLetterToConversation(activeLetter.id, sessionId)
        setLetters((current) =>
          current.map((letter) =>
            letter.id === activeLetter.id ? { ...letter, conversationId: sessionId } : letter,
          ),
        )
        setLinkPickerOpen(false)
        setActiveLetterId(null)
        openChatSession(sessionId)
      } catch (linkActionError) {
        console.warn('关联对话失败', linkActionError)
        setLinkError('关联失败，请稍后重试。')
      } finally {
        setLinking(false)
      }
    },
    [activeLetter, linking, openChatSession],
  )

  const handleCreateAndLinkSession = useCallback(async () => {
    if (!activeLetter || linking) {
      return
    }
    setLinkError(null)
    setLinking(true)
    try {
      const createdSession = await onCreateSession('来自来信')
      await linkLetterToConversation(activeLetter.id, createdSession.id)
      setLetters((current) =>
        current.map((letter) =>
          letter.id === activeLetter.id ? { ...letter, conversationId: createdSession.id } : letter,
        ),
      )
      setLinkPickerOpen(false)
      setActiveLetterId(null)
      openChatSession(createdSession.id)
    } catch (createError) {
      console.warn('创建并关联对话失败', createError)
      setLinkError('转入对话失败，请稍后重试。')
    } finally {
      setLinking(false)
    }
  }, [activeLetter, linking, onCreateSession, openChatSession])

  return (
    <main className="letters-page app-shell">
      <header className="letters-header app-shell__header">
        <Link to="/" className="letters-home-btn">
          返回首页
        </Link>
        <h1 className="ui-title">Letters</h1>
      </header>

      <section className="letters-content app-shell__content" aria-label="letters list">
        <div className="letters-manual-panel glass-card" aria-label="manual letter trigger">
          <div className="letters-manual-row">
            <label>手动生成（验证用）</label>
            <button type="button" onClick={() => void handleManualGenerate()} disabled={manualGenerating}>
              {manualGenerating ? '生成中…' : 'Generate Letter'}
            </button>
          </div>
          <p className="letters-manual-hint">当前默认模型：{defaultModelId}</p>
          <textarea
            value={manualPrompt}
            onChange={(event) => setManualPrompt(event.target.value)}
            placeholder="可选：补充一条生成指令（用于手动验证）"
            rows={2}
            disabled={manualGenerating}
          />
          {manualError ? <p className="letters-manual-error">{manualError}</p> : null}
        </div>

        <div className="letters-list glass-card">
          {loading ? <p className="letters-state">加载中…</p> : null}
          {!loading && error ? <p className="letters-state">{error}</p> : null}
          {!loading && !error && letters.length === 0 ? (
            <p className="letters-state">暂时还没有来信。</p>
          ) : null}

          {!loading && !error
            ? letters.map((letter) => (
                <button
                  key={letter.id}
                  type="button"
                  className={`letter-row ${letter.isRead ? 'is-read' : 'is-unread'}`}
                  onClick={() => void handleOpenLetter(letter)}
                >
                  <span className="letter-avatar" aria-hidden>
                    S
                  </span>
                  <span className="letter-body">
                    <span className="letter-preview">{getPreview(letter.content)}</span>
                    <span className="letter-meta">
                      <span>{formatTimestamp(letter.createdAt)}</span>
                      <span className="letter-meta-dot">·</span>
                      <span>{getMetaLabel(letter)}</span>
                    </span>
                  </span>
                </button>
              ))
            : null}
        </div>
      </section>

      {activeLetter ? (
        <div className="letter-sheet-backdrop" onClick={() => setActiveLetterId(null)}>
          <article
            className="letter-sheet glass-card"
            onClick={(event) => event.stopPropagation()}
            aria-label="letter detail"
          >
            <header className="letter-sheet-header">
              <span className="letter-avatar" aria-hidden>
                S
              </span>
              <div>
                <p className="letter-sheet-title ui-title">Syzygy</p>
                <p className="letter-sheet-meta">{formatTimestamp(activeLetter.createdAt)}</p>
              </div>
              <div className="letter-sheet-actions">
                <button
                  type="button"
                  className="letter-link"
                  onClick={() => {
                    setLinkError(null)
                    setLinkPickerOpen(true)
                  }}
                  disabled={deletingLetterId === activeLetter.id || linking}
                >
                  转入对话
                </button>
                <button
                  type="button"
                  className="letter-delete"
                  onClick={() => void handleDeleteActiveLetter()}
                  disabled={deletingLetterId === activeLetter.id}
                >
                  {deletingLetterId === activeLetter.id ? '删除中…' : '删除'}
                </button>
                <button
                  type="button"
                  className="letter-close"
                  onClick={() => setActiveLetterId(null)}
                  disabled={deletingLetterId === activeLetter.id}
                >
                  关闭
                </button>
              </div>
            </header>
            <p className="letter-sheet-content">{activeLetter.content}</p>
            {deleteError ? <p className="letters-manual-error">{deleteError}</p> : null}
            {linkError ? <p className="letters-manual-error">{linkError}</p> : null}

            {linkPickerOpen ? (
              <section className="letter-link-picker" aria-label="target conversation picker">
                <p className="letter-link-picker-title">选择目标对话</p>
                <button
                  type="button"
                  className="letter-link-picker-item"
                  onClick={() => void handleCreateAndLinkSession()}
                  disabled={linking}
                >
                  {linking ? '处理中…' : '新建对话'}
                </button>
                {sessions.length > 0 ? (
                  <div className="letter-link-picker-list">
                    {sessions.map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        className="letter-link-picker-item"
                        onClick={() => void handleLinkToSession(session.id)}
                        disabled={linking}
                      >
                        {session.title}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="letter-link-picker-empty">暂无已有会话，可直接新建。</p>
                )}
              </section>
            ) : null}
          </article>
        </div>
      ) : null}
    </main>
  )
}

export default LettersPage
