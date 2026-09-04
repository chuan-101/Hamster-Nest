import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { EventEntry, EventThread } from '../types'
import {
  createEventEntry,
  deleteEventEntry,
  deleteEventThread,
  fetchEventThread,
  listEventEntries,
  updateEventEntry,
  updateEventThread,
} from '../storage/supabaseSync'
import ConfirmDialog from '../components/ConfirmDialog'
import { RECORD_SOURCE_OPTIONS, getRecordSourceLabel } from '../constants/recordSources'
import {
  EVENT_GROUP_OPTIONS,
  formatDateRange,
  getTodayDateKey,
  isLongText,
  readStoredEntryOrder,
  storeEntryOrder,
  type EntryOrder,
} from './eventCollectionShared'
import './EventCollection.css'

type EntryEditorState = {
  mode: 'create' | 'edit'
  entryId?: string
  entryDate: string
  content: string
  source: string
}

type ThreadEditorState = {
  title: string
  currentStatus: string
  emojiGroup: string | null
  startedOn: string
  endedOn: string
}

const DEFAULT_SOURCE = 'frontend'

const buildEntryEditor = (entry?: EventEntry): EntryEditorState => ({
  mode: entry ? 'edit' : 'create',
  entryId: entry?.id,
  entryDate: entry?.entryDate ?? getTodayDateKey(),
  content: entry?.content ?? '',
  source: entry?.source ?? DEFAULT_SOURCE,
})

const buildThreadEditor = (thread: EventThread): ThreadEditorState => ({
  title: thread.title,
  currentStatus: thread.currentStatus,
  emojiGroup: thread.emojiGroup,
  startedOn: thread.startedOn,
  endedOn: thread.endedOn ?? '',
})

type PendingDelete = { kind: 'entry'; entry: EventEntry } | { kind: 'thread' } | null

const EventThreadPage = () => {
  const navigate = useNavigate()
  const { threadId } = useParams<{ threadId: string }>()
  const [thread, setThread] = useState<EventThread | null>(null)
  const [entries, setEntries] = useState<EventEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [order, setOrder] = useState<EntryOrder>(() => readStoredEntryOrder())
  const [statusExpanded, setStatusExpanded] = useState(false)
  const [expandedEntryIds, setExpandedEntryIds] = useState<string[]>([])
  const [entryEditor, setEntryEditor] = useState<EntryEditorState | null>(null)
  const [threadEditor, setThreadEditor] = useState<ThreadEditorState | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null)

  const refresh = useCallback(async () => {
    if (!threadId) {
      setMissing(true)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [nextThread, nextEntries] = await Promise.all([fetchEventThread(threadId), listEventEntries(threadId)])
      if (!nextThread) {
        setMissing(true)
        setThread(null)
        setEntries([])
      } else {
        setMissing(false)
        setThread(nextThread)
        setEntries(nextEntries)
      }
      setError(null)
    } catch (loadError) {
      console.warn('加载事件线失败', loadError)
      setError('加载事件线失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [threadId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const orderedEntries = useMemo(() => (order === 'asc' ? entries : [...entries].reverse()), [entries, order])

  const changeOrder = (next: EntryOrder) => {
    setOrder(next)
    storeEntryOrder(next)
  }

  const toggleEntryExpanded = (entryId: string) => {
    setExpandedEntryIds((current) =>
      current.includes(entryId) ? current.filter((id) => id !== entryId) : [...current, entryId],
    )
  }

  const handleSaveEntry = async (event: FormEvent) => {
    event.preventDefault()
    if (!entryEditor || !threadId) {
      return
    }
    const content = entryEditor.content.trim()
    if (!entryEditor.entryDate) {
      setError('请选择日期')
      return
    }
    if (!content) {
      setError('事件正文不能为空')
      return
    }
    setSaving(true)
    try {
      if (entryEditor.mode === 'create') {
        await createEventEntry({
          threadId,
          entryDate: entryEditor.entryDate,
          content,
          source: entryEditor.source,
        })
        setNotice('条目已追加')
      } else if (entryEditor.entryId) {
        await updateEventEntry(entryEditor.entryId, {
          entryDate: entryEditor.entryDate,
          content,
          source: entryEditor.source,
        })
        setNotice('条目已更新')
      }
      setEntryEditor(null)
      setError(null)
      await refresh()
    } catch (saveError) {
      console.warn('保存条目失败', saveError)
      setError('保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveThread = async (event: FormEvent) => {
    event.preventDefault()
    if (!threadEditor || !thread) {
      return
    }
    const title = threadEditor.title.trim()
    if (!title) {
      setError('标题不能为空')
      return
    }
    setSaving(true)
    try {
      await updateEventThread(thread.id, {
        title,
        currentStatus: threadEditor.currentStatus.trim(),
        emojiGroup: threadEditor.emojiGroup,
        startedOn: threadEditor.startedOn,
        endedOn: thread.status === 'closed' ? threadEditor.endedOn || getTodayDateKey() : null,
      })
      setThreadEditor(null)
      setNotice('事件线已更新')
      setError(null)
      await refresh()
    } catch (saveError) {
      console.warn('保存事件线失败', saveError)
      setError('保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const toggleClosed = async () => {
    if (!thread || saving) {
      return
    }
    setSaving(true)
    try {
      if (thread.status === 'closed') {
        await updateEventThread(thread.id, { status: 'active', endedOn: null })
        setNotice('事件线已重开')
      } else {
        await updateEventThread(thread.id, { status: 'closed', endedOn: getTodayDateKey() })
        setNotice('事件线已结项，归档可见')
      }
      setError(null)
      await refresh()
    } catch (toggleError) {
      console.warn('切换事件线状态失败', toggleError)
      setError('操作失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete || !thread || saving) {
      return
    }
    setSaving(true)
    try {
      if (pendingDelete.kind === 'entry') {
        await deleteEventEntry(pendingDelete.entry.id)
        setPendingDelete(null)
        setEntryEditor(null)
        setNotice('条目已删除')
        setError(null)
        await refresh()
      } else {
        await deleteEventThread(thread.id)
        setPendingDelete(null)
        navigate('/events', { replace: true })
      }
    } catch (deleteError) {
      console.warn('删除失败', deleteError)
      setError('删除失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const closed = thread?.status === 'closed'
  const statusText = thread?.currentStatus.trim() ?? ''
  const statusClampable = statusText.length > 0 && isLongText(statusText)

  return (
    <div className="event-page">
      <header className="event-header">
        <button type="button" className="ghost event-header-btn event-header-btn--left" onClick={() => navigate('/events')}>
          ← 事件集
        </button>
        <div className="event-title-wrap">
          <p className="event-kicker">Event Thread</p>
          <h1 className="ui-title event-detail-title">
            {thread?.emojiGroup ? <span className="event-thread-card__emoji">{thread.emojiGroup}</span> : null}
            {thread?.title ?? (loading ? '加载中…' : '事件线')}
          </h1>
        </div>
        {thread ? (
          <button type="button" className="event-create-btn" onClick={() => setEntryEditor(buildEntryEditor())}>
            + 记一条
          </button>
        ) : null}
      </header>

      {notice ? <p className="event-notice">{notice}</p> : null}
      {error ? <p className="event-error">{error}</p> : null}

      {loading ? <p className="tips">加载中…</p> : null}
      {!loading && missing ? <p className="tips event-empty">找不到这条事件线，可能已被删除。</p> : null}

      {thread ? (
        <section className={closed ? 'event-summary-card event-summary-card--closed' : 'event-summary-card'} aria-label="事件线概览">
          <div className="event-summary-card__top">
            <span className={closed ? 'event-status-badge event-status-badge--closed' : 'event-status-badge'}>
              {closed ? '已结束' : '进行中'}
            </span>
            <span className="event-summary-card__range">{formatDateRange(thread)}</span>
            <span className="event-summary-card__count">{entries.length} 条</span>
          </div>
          <div className="event-thread-card__status-wrap">
            <span className="event-thread-card__status-label">当前状态</span>
            <p className={statusClampable && !statusExpanded ? 'event-thread-card__status clamped' : 'event-thread-card__status'}>
              {statusText || '（还没写当前状态，点「编辑」补一行）'}
            </p>
            {statusClampable ? (
              <button type="button" className="event-expand-btn" onClick={() => setStatusExpanded((current) => !current)}>
                {statusExpanded ? '收起 ▲' : '展开全文 ▼'}
              </button>
            ) : null}
          </div>
          <div className="event-summary-card__actions">
            <button type="button" className="event-inline-btn" onClick={() => setThreadEditor(buildThreadEditor(thread))} disabled={saving}>
              编辑
            </button>
            <button type="button" className="event-inline-btn event-inline-btn--accent" onClick={() => void toggleClosed()} disabled={saving}>
              {closed ? '重开' : '结项'}
            </button>
            <button type="button" className="event-inline-btn event-inline-btn--danger" onClick={() => setPendingDelete({ kind: 'thread' })} disabled={saving}>
              删除
            </button>
          </div>
        </section>
      ) : null}

      {thread ? (
        <section className="event-entry-list" aria-label="条目时间轴">
          <div className="event-entry-list__top">
            <h2 className="event-section-title">条目</h2>
            <div className="event-order-toggle" role="group" aria-label="排序">
              <button type="button" className={order === 'asc' ? 'active' : ''} onClick={() => changeOrder('asc')}>
                从起到结
              </button>
              <button type="button" className={order === 'desc' ? 'active' : ''} onClick={() => changeOrder('desc')}>
                最新在上
              </button>
            </div>
          </div>
          {entries.length === 0 ? (
            <p className="tips event-empty">还没有条目，点右上角「记一条」写下第一笔。</p>
          ) : (
            <ol className="event-rail">
              {orderedEntries.map((entry, index) => {
                const previous = orderedEntries[index - 1]
                const sameDateAsPrevious = previous?.entryDate === entry.entryDate
                const expanded = expandedEntryIds.includes(entry.id)
                const clampable = isLongText(entry.content)
                return (
                  <li key={entry.id} className="event-rail__item">
                    <div className={sameDateAsPrevious ? 'event-rail__date event-rail__date--muted' : 'event-rail__date'}>
                      <span className="event-rail__dot" aria-hidden="true" />
                      <time dateTime={entry.entryDate}>{sameDateAsPrevious ? '同日' : entry.entryDate}</time>
                    </div>
                    <article className="event-entry-card">
                      <p className={clampable && !expanded ? 'event-entry-card__content clamped' : 'event-entry-card__content'}>
                        {entry.content}
                      </p>
                      <div className="event-entry-card__foot">
                        {clampable ? (
                          <button type="button" className="event-expand-btn" onClick={() => toggleEntryExpanded(entry.id)}>
                            {expanded ? '收起 ▲' : '展开全文 ▼'}
                          </button>
                        ) : (
                          <span />
                        )}
                        <span className="event-entry-card__meta">
                          <span className="event-source-chip" title={`记录端：${getRecordSourceLabel(entry.source)}`}>
                            {getRecordSourceLabel(entry.source)}
                          </span>
                          <button type="button" className="event-inline-btn" onClick={() => setEntryEditor(buildEntryEditor(entry))}>
                            编辑
                          </button>
                        </span>
                      </div>
                    </article>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      ) : null}

      {entryEditor ? (
        <div className="event-editor-backdrop" role="dialog" aria-modal="true" aria-label="条目编辑">
          <form className="event-editor" onSubmit={handleSaveEntry}>
            <h2>{entryEditor.mode === 'create' ? '记一条' : '编辑条目'}</h2>
            <label>
              日期
              <input
                type="date"
                value={entryEditor.entryDate}
                onChange={(event) => setEntryEditor({ ...entryEditor, entryDate: event.target.value })}
                required
              />
            </label>
            <label>
              事件
              <textarea
                rows={5}
                value={entryEditor.content}
                onChange={(event) => setEntryEditor({ ...entryEditor, content: event.target.value })}
                placeholder="一两句，一事一条，写完不改"
                required
              />
            </label>
            <label>
              记录端
              <select
                value={entryEditor.source}
                onChange={(event) => setEntryEditor({ ...entryEditor, source: event.target.value })}
              >
                {!RECORD_SOURCE_OPTIONS.includes(entryEditor.source) ? (
                  <option value={entryEditor.source}>{getRecordSourceLabel(entryEditor.source)}</option>
                ) : null}
                {RECORD_SOURCE_OPTIONS.map((source) => (
                  <option key={source} value={source}>
                    {getRecordSourceLabel(source)}
                  </option>
                ))}
              </select>
            </label>
            <div className="event-editor__actions">
              <button type="button" className="secondary" onClick={() => setEntryEditor(null)} disabled={saving}>
                取消
              </button>
              {entryEditor.mode === 'edit' ? (
                <button
                  type="button"
                  className="danger"
                  disabled={saving}
                  onClick={() => {
                    const target = entries.find((entry) => entry.id === entryEditor.entryId)
                    if (target) {
                      setPendingDelete({ kind: 'entry', entry: target })
                    }
                  }}
                >
                  删除
                </button>
              ) : null}
              <button type="submit" className="primary" disabled={saving || !entryEditor.content.trim()}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {threadEditor && thread ? (
        <div className="event-editor-backdrop" role="dialog" aria-modal="true" aria-label="事件线编辑">
          <form className="event-editor" onSubmit={handleSaveThread}>
            <h2>编辑事件线</h2>
            <label>
              标题
              <input
                type="text"
                value={threadEditor.title}
                onChange={(event) => setThreadEditor({ ...threadEditor, title: event.target.value })}
                required
              />
            </label>
            <label>
              当前状态（一行）
              <textarea
                rows={3}
                value={threadEditor.currentStatus}
                onChange={(event) => setThreadEditor({ ...threadEditor, currentStatus: event.target.value })}
                placeholder="各端开机只读这一行，写成能一眼看懂的现状"
              />
            </label>
            <div className="event-editor__group">
              <strong>分组</strong>
              <div className="event-chip-list">
                <button
                  type="button"
                  className={threadEditor.emojiGroup === null ? 'event-chip selected' : 'event-chip'}
                  onClick={() => setThreadEditor({ ...threadEditor, emojiGroup: null })}
                >
                  无
                </button>
                {EVENT_GROUP_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={threadEditor.emojiGroup === option.value ? 'event-chip selected' : 'event-chip'}
                    onClick={() => setThreadEditor({ ...threadEditor, emojiGroup: option.value })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="event-editor__row">
              <label>
                开始日期
                <input
                  type="date"
                  value={threadEditor.startedOn}
                  onChange={(event) => setThreadEditor({ ...threadEditor, startedOn: event.target.value })}
                  required
                />
              </label>
              {closed ? (
                <label>
                  结束日期
                  <input
                    type="date"
                    value={threadEditor.endedOn}
                    onChange={(event) => setThreadEditor({ ...threadEditor, endedOn: event.target.value })}
                  />
                </label>
              ) : null}
            </div>
            <div className="event-editor__actions">
              <button type="button" className="secondary" onClick={() => setThreadEditor(null)} disabled={saving}>
                取消
              </button>
              <button type="submit" className="primary" disabled={saving || !threadEditor.title.trim()}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete?.kind === 'thread' ? '删除这条事件线？' : '删除这条条目？'}
        description={
          pendingDelete?.kind === 'thread'
            ? `「${thread?.title ?? ''}」及其全部 ${entries.length} 条条目将被彻底删除，无法恢复。结项归档不需要删除，只需点「结项」。`
            : pendingDelete?.kind === 'entry'
              ? `${pendingDelete.entry.entryDate} 的这条记录将被彻底删除，无法恢复。`
              : undefined
        }
        confirmLabel="彻底删除"
        confirmDisabled={saving}
        cancelDisabled={saving}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

export default EventThreadPage
