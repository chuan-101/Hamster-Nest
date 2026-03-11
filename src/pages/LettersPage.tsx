import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase/client'
import type { LetterEntry } from '../types'
import { createLetter, deleteLetter, fetchAllMemoryEntries, fetchLetters, markLetterAsRead } from '../storage/supabaseSync'
import { ensureUserSettings } from '../storage/userSettings'
import './LettersPage.css'

const PREVIEW_LIMIT = 30
const LETTER_MEMORY_LIMIT = 20
const LETTER_HELPER_INSTRUCTION = 'Write a warm check-in letter in Chinese. Keep it concise, sincere, and personal.'

const formatTimestamp = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

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
    return letter.triggerReason
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

const LettersPage = () => {
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
    } catch (loadError) {
      console.warn('加载来信失败', loadError)
      setError('加载失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadLetters()
  }, [loadLetters])

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

  const handleOpenLetter = async (letter: LetterEntry) => {
    setActiveLetterId(letter.id)
    if (letter.isRead) {
      return
    }
    setLetters((current) =>
      current.map((item) => (item.id === letter.id ? { ...item, isRead: true } : item)),
    )
    try {
      await markLetterAsRead(letter.id)
    } catch (markError) {
      console.warn('标记已读失败', markError)
    }
  }

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
          messages: [
            ...(appSystemPrompt
              ? [{ role: 'system' as const, content: appSystemPrompt }]
              : []),
            {
              role: 'system',
              content: `Memory context (latest user memory entries):\n${memoryContext}`,
            },
            ...(letterReplyPrompt
              ? [{ role: 'system' as const, content: letterReplyPrompt }]
              : []),
            {
              role: 'system',
              content: LETTER_HELPER_INSTRUCTION,
            },
            {
              role: 'user',
              content: manualPrompt.trim() || 'Write a check-in style letter for today.',
            },
          ],
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
      setLetters((current) => [created, ...current])
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
      setLetters((current) => current.filter((letter) => letter.id !== activeLetter.id))
      setActiveLetterId(null)
    } catch (deleteActionError) {
      console.warn('删除来信失败', deleteActionError)
      setDeleteError('删除失败，请稍后重试。')
    } finally {
      setDeletingLetterId(null)
    }
  }

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
          </article>
        </div>
      ) : null}
    </main>
  )
}

export default LettersPage
