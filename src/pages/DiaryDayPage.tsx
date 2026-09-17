import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { DiaryComment, DiaryEntry, DiaryLock } from '../types'
import {
  checkDiaryLock,
  createDiaryComment,
  deleteDiaryComment,
  fetchDiaryLocks,
  listDiaryComments,
  listDiaryEntriesByDate,
} from '../storage/supabaseSync'
import MarkdownRenderer from '../components/MarkdownRenderer'
import ConfirmDialog from '../components/ConfirmDialog'
import { getRecordSourceLabel } from '../constants/recordSources'
import { formatLocalTimestamp } from '../utils/time'
import { formatClock, getActivityLabel, getCommentAuthorLabel, isValidDateKey } from './diaryShared'
import './DiaryPage.css'

// Syzygy 日记本 · 二级界面：当日页。
// 翻开的页直接读；合着的页先看该端口的暗号卡（提示 + 对暗号），对上才展开正文；读过的页可以留言。
// 解锁由服务端记忆（diary_unlocks）：一次对上，处处有效，端口换题后要重新对。

const DiaryDayPage = () => {
  const navigate = useNavigate()
  const { date } = useParams<{ date: string }>()
  const validDate = date && isValidDateKey(date) ? date : null
  const [entries, setEntries] = useState<DiaryEntry[]>([])
  const [locks, setLocks] = useState<DiaryLock[]>([])
  const [comments, setComments] = useState<DiaryComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [guesses, setGuesses] = useState<Record<string, string>>({})
  const [guessErrors, setGuessErrors] = useState<Record<string, string>>({})
  const [checkingAuthor, setCheckingAuthor] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingCommentFor, setSavingCommentFor] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DiaryComment | null>(null)

  const refresh = useCallback(async () => {
    if (!validDate) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      // 先问服务端哪些端口已经解开，再按解锁状态决定合着的页要不要拉正文。
      const nextLocks = await fetchDiaryLocks()
      const unlockedAuthors = nextLocks.filter((lock) => lock.unlocked).map((lock) => lock.author)
      const nextEntries = await listDiaryEntriesByDate(validDate, unlockedAuthors)
      const readableIds = nextEntries.filter((entry) => entry.content !== null).map((entry) => entry.id)
      const nextComments = await listDiaryComments(readableIds)
      setEntries(nextEntries)
      setLocks(nextLocks)
      setComments(nextComments)
      setError(null)
    } catch (loadError) {
      console.warn('加载当日日记失败', loadError)
      setError('加载日记失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [validDate])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const lockByAuthor = useMemo(() => new Map(locks.map((lock) => [lock.author, lock])), [locks])

  // 当天还合着的页按端口归并：一个端口一张谜题卡。
  const lockedAuthors = useMemo(
    () => Array.from(new Set(entries.filter((entry) => entry.content === null).map((entry) => entry.author))),
    [entries],
  )

  const commentsByEntry = useMemo(() => {
    const groups = new Map<string, DiaryComment[]>()
    comments.forEach((comment) => {
      const current = groups.get(comment.entryId) ?? []
      current.push(comment)
      groups.set(comment.entryId, current)
    })
    return groups
  }, [comments])

  const reloadComments = useCallback(async () => {
    const readableIds = entries.filter((entry) => entry.content !== null).map((entry) => entry.id)
    setComments(await listDiaryComments(readableIds))
  }, [entries])

  const submitGuess = async (event: FormEvent, author: string) => {
    event.preventDefault()
    const guess = (guesses[author] ?? '').trim()
    if (!guess || checkingAuthor) {
      return
    }
    setCheckingAuthor(author)
    try {
      const ok = await checkDiaryLock(author, guess)
      if (ok) {
        setGuessErrors((current) => ({ ...current, [author]: '' }))
        setGuesses((current) => ({ ...current, [author]: '' }))
        setNotice(`暗号对上了，${getRecordSourceLabel(author)} 的抽屉为你打开，以后不用再对。`)
        setError(null)
        await refresh()
      } else {
        setGuessErrors((current) => ({ ...current, [author]: '不对，再想想。暗号不分大小写和空格。' }))
        setError(null)
      }
    } catch (checkError) {
      console.warn('核对谜底失败', checkError)
      setError('核对谜底失败，请稍后重试')
    } finally {
      setCheckingAuthor(null)
    }
  }

  const submitComment = async (event: FormEvent, entryId: string) => {
    event.preventDefault()
    const content = (drafts[entryId] ?? '').trim()
    if (!content || savingCommentFor) {
      return
    }
    setSavingCommentFor(entryId)
    try {
      await createDiaryComment(entryId, content)
      setDrafts((current) => ({ ...current, [entryId]: '' }))
      setNotice('留言已写下，Syzygy 读日记时会看到。')
      setError(null)
      await reloadComments()
    } catch (saveError) {
      console.warn('留言失败', saveError)
      setError('留言失败，请稍后重试')
    } finally {
      setSavingCommentFor(null)
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete || savingCommentFor) {
      return
    }
    setSavingCommentFor(pendingDelete.entryId)
    try {
      await deleteDiaryComment(pendingDelete.id)
      setPendingDelete(null)
      setNotice('留言已删除')
      setError(null)
      await reloadComments()
    } catch (deleteError) {
      console.warn('删除留言失败', deleteError)
      setError('删除失败，请稍后重试')
    } finally {
      setSavingCommentFor(null)
    }
  }

  const renderComments = (entry: DiaryEntry) => {
    const list = commentsByEntry.get(entry.id) ?? []
    const draft = drafts[entry.id] ?? ''
    const saving = savingCommentFor === entry.id
    return (
      <section className="diary-comments" aria-label="留言">
        <p className="diary-comments__title">留言 · {list.length}</p>
        {list.map((comment) => (
          <div key={comment.id} className="diary-comment">
            <div className="diary-comment__head">
              <span className="diary-chip diary-chip--author">{getCommentAuthorLabel(comment.author)}</span>
              <time dateTime={comment.createdAt}>{formatLocalTimestamp(comment.createdAt)}</time>
              {comment.author === 'chuanchuan' ? (
                <button type="button" className="diary-expand-btn" onClick={() => setPendingDelete(comment)} disabled={saving}>
                  删除
                </button>
              ) : null}
            </div>
            <p className="diary-comment__content">{comment.content}</p>
          </div>
        ))}
        <form className="diary-comment-form" onSubmit={(event) => void submitComment(event, entry.id)}>
          <textarea
            rows={2}
            value={draft}
            onChange={(event) => setDrafts((current) => ({ ...current, [entry.id]: event.target.value }))}
            placeholder="看完想说点什么，写在这里。"
          />
          <button type="submit" className="diary-inline-btn diary-inline-btn--accent" disabled={saving || !draft.trim()}>
            {saving ? '写入中…' : '留言'}
          </button>
        </form>
      </section>
    )
  }

  const renderEntry = (entry: DiaryEntry) => {
    const readable = entry.content !== null
    const shared = entry.visibility === 'shared'
    return (
      <article
        key={entry.id}
        className={readable ? 'diary-card' : 'diary-card diary-card--locked'}
        aria-label={readable ? (shared ? '已翻开的一页' : '猜对后打开的一页') : '还合着的一页'}
      >
        <header className="diary-card__head">
          <span className={readable ? 'diary-card__avatar' : 'diary-card__avatar diary-card__avatar--locked'} aria-hidden="true">
            {readable ? (shared ? '🩵' : '🔓') : '🔒'}
          </span>
          <div className="diary-card__meta">
            <span className="diary-chip diary-chip--author" title="署名端口">
              {getRecordSourceLabel(entry.author)}
            </span>
            <span className="diary-chip">{getActivityLabel(entry.activityType)}</span>
            {readable && entry.mood ? <span className="diary-chip diary-chip--mood">心情 · {entry.mood}</span> : null}
          </div>
          <time className="diary-card__clock" dateTime={entry.createdAt}>
            {formatClock(entry.createdAt)}
          </time>
        </header>
        {readable ? (
          <>
            {entry.title ? <h3 className="diary-card__title">{entry.title}</h3> : null}
            <div className="diary-card__content">
              <MarkdownRenderer content={entry.content ?? ''} />
            </div>
            <footer className="diary-card__foot">
              <span className="diary-open-badge">
                {shared
                  ? `📖 已翻开${entry.sharedAt ? ` · ${formatLocalTimestamp(entry.sharedAt)}` : ''}`
                  : '🔓 暗号对上了，这一页为你打开'}
              </span>
            </footer>
            {renderComments(entry)}
          </>
        ) : (
          <p className="diary-card__locked-text">这一页还合着。</p>
        )}
      </article>
    )
  }

  return (
    <div className="diary-page">
      <header className="diary-header">
        <button type="button" className="ghost diary-header-btn diary-header-btn--left" onClick={() => navigate('/diary')}>
          ← 月历
        </button>
        <div className="diary-title-wrap">
          <p className="diary-kicker">Syzygy Diary</p>
          <h1 className="ui-title diary-day-title">{validDate ?? '日记'}</h1>
        </div>
        <span className="diary-lock-badge" title="当天页数">
          {loading ? '…' : `${entries.length} 页`}
        </span>
      </header>

      {notice ? <p className="diary-notice">{notice}</p> : null}
      {error ? <p className="diary-error">{error}</p> : null}

      {loading ? <p className="tips">加载中…</p> : null}
      {!loading && !validDate ? <p className="diary-empty">日期不对，回月历重新选一天。</p> : null}
      {!loading && validDate && entries.length === 0 ? <p className="diary-empty">这一天没有日记。</p> : null}

      {!loading
        ? lockedAuthors.map((author) => {
            const lock = lockByAuthor.get(author)
            const label = getRecordSourceLabel(author)
            const guess = guesses[author] ?? ''
            return (
              <section key={author} className="diary-riddle-card" aria-label={`${label} 的谜题`}>
                <div className="diary-riddle-card__top">
                  <span className="diary-card__avatar diary-card__avatar--locked" aria-hidden="true">
                    🔒
                  </span>
                  <div className="diary-riddle-card__text">
                    <strong>{label} 的抽屉合着</strong>
                    <p className="diary-riddle-card__hint">
                      {lock
                        ? lock.hint
                          ? `提示：${lock.hint}`
                          : '这道题没有提示，只能硬猜。'
                        : '这个端口还没出暗号，合着的页只能等它自己翻开。'}
                    </p>
                  </div>
                </div>
                {lock ? (
                  <form className="diary-riddle-form" onSubmit={(event) => void submitGuess(event, author)}>
                    <input
                      type="text"
                      value={guess}
                      onChange={(event) => setGuesses((current) => ({ ...current, [author]: event.target.value }))}
                      placeholder="对暗号，中文英文都行"
                      autoComplete="off"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="go"
                      aria-label={`${label} 的暗号`}
                    />
                    <button
                      type="submit"
                      className="diary-inline-btn diary-inline-btn--accent"
                      disabled={checkingAuthor === author || !guess.trim()}
                    >
                      {checkingAuthor === author ? '核对中…' : '对暗号'}
                    </button>
                  </form>
                ) : null}
                {guessErrors[author] ? <p className="diary-riddle-card__error">{guessErrors[author]}</p> : null}
              </section>
            )
          })
        : null}

      {!loading && entries.length > 0 ? (
        <section className="diary-list" aria-label="当日日记">
          <div className="diary-list__body">
            <div className="diary-date-group__entries">{entries.map(renderEntry)}</div>
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这条留言？"
        description={pendingDelete ? `「${pendingDelete.content.slice(0, 40)}${pendingDelete.content.length > 40 ? '…' : ''}」将被彻底删除，无法恢复。` : undefined}
        confirmLabel="彻底删除"
        confirmDisabled={savingCommentFor !== null}
        cancelDisabled={savingCommentFor !== null}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

export default DiaryDayPage
