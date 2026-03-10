import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LetterEntry } from '../types'
import { fetchLetters, markLetterAsRead } from '../storage/supabaseSync'
import './LettersPage.css'

const PREVIEW_LIMIT = 30

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

const LettersPage = () => {
  const [letters, setLetters] = useState<LetterEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeLetterId, setActiveLetterId] = useState<string | null>(null)

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

  return (
    <main className="letters-page app-shell">
      <header className="letters-header app-shell__header">
        <h1 className="ui-title">Letters</h1>
      </header>

      <section className="letters-content app-shell__content" aria-label="letters list">
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
              <button type="button" className="letter-close" onClick={() => setActiveLetterId(null)}>
                关闭
              </button>
            </header>
            <p className="letter-sheet-content">{activeLetter.content}</p>
          </article>
        </div>
      ) : null}
    </main>
  )
}

export default LettersPage
