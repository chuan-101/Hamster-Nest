import { useCallback, useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { EventThread, EventThreadStatus } from '../types'
import {
  createEventThread,
  deleteEventThread,
  listEventEntryCounts,
  listEventThreads,
  updateEventThread,
} from '../storage/supabaseSync'
import ConfirmDialog from '../components/ConfirmDialog'
import { formatLocalTimestamp } from '../utils/time'
import {
  EVENT_GROUP_OPTIONS,
  formatDateRange,
  getTodayDateKey,
  isLongText,
} from './eventCollectionShared'
import './EventCollection.css'

type ThreadEditorState = {
  mode: 'create' | 'edit'
  threadId?: string
  title: string
  currentStatus: string
  emojiGroup: string | null
  status: EventThreadStatus
  startedOn: string
  endedOn: string
}

type ThreadStats = Map<string, { count: number; lastEntryDate: string | null }>

const buildEditorState = (thread?: EventThread): ThreadEditorState => ({
  mode: thread ? 'edit' : 'create',
  threadId: thread?.id,
  title: thread?.title ?? '',
  currentStatus: thread?.currentStatus ?? '',
  emojiGroup: thread?.emojiGroup ?? null,
  status: thread?.status ?? 'active',
  startedOn: thread?.startedOn ?? getTodayDateKey(),
  endedOn: thread?.endedOn ?? '',
})

const EventCollectionPage = () => {
  const navigate = useNavigate()
  const [threads, setThreads] = useState<EventThread[]>([])
  const [stats, setStats] = useState<ThreadStats>(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<ThreadEditorState | null>(null)
  const [groupFilter, setGroupFilter] = useState<string | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [expandedIds, setExpandedIds] = useState<string[]>([])
  const [pendingDelete, setPendingDelete] = useState<EventThread | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [nextThreads, nextStats] = await Promise.all([listEventThreads(), listEventEntryCounts()])
      setThreads(nextThreads)
      setStats(nextStats)
      setError(null)
    } catch (loadError) {
      console.warn('加载事件集失败', loadError)
      setError('加载事件集失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const filteredThreads = useMemo(
    () => (groupFilter ? threads.filter((thread) => thread.emojiGroup === groupFilter) : threads),
    [groupFilter, threads],
  )
  const activeThreads = useMemo(() => filteredThreads.filter((thread) => thread.status === 'active'), [filteredThreads])
  const closedThreads = useMemo(() => filteredThreads.filter((thread) => thread.status === 'closed'), [filteredThreads])
  const activeCount = useMemo(() => threads.filter((thread) => thread.status === 'active').length, [threads])
  const closedCount = threads.length - activeCount

  const toggleExpanded = (event: MouseEvent, threadId: string) => {
    event.stopPropagation()
    setExpandedIds((current) =>
      current.includes(threadId) ? current.filter((id) => id !== threadId) : [...current, threadId],
    )
  }

  const openEditor = (event: MouseEvent, thread: EventThread) => {
    event.stopPropagation()
    setEditor(buildEditorState(thread))
  }

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    if (!editor) {
      return
    }
    const title = editor.title.trim()
    if (!title) {
      setError('标题不能为空')
      return
    }
    if (!editor.startedOn) {
      setError('请选择开始日期')
      return
    }
    setSaving(true)
    try {
      if (editor.mode === 'create') {
        await createEventThread({
          title,
          currentStatus: editor.currentStatus.trim(),
          emojiGroup: editor.emojiGroup,
          startedOn: editor.startedOn,
        })
        setNotice('事件线已开')
      } else if (editor.threadId) {
        const closed = editor.status === 'closed'
        await updateEventThread(editor.threadId, {
          title,
          currentStatus: editor.currentStatus.trim(),
          emojiGroup: editor.emojiGroup,
          status: editor.status,
          startedOn: editor.startedOn,
          endedOn: closed ? editor.endedOn || getTodayDateKey() : null,
        })
        setNotice('事件线已更新')
      }
      setEditor(null)
      setError(null)
      await refresh()
    } catch (saveError) {
      console.warn('保存事件线失败', saveError)
      setError('保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const requestDelete = () => {
    if (!editor?.threadId) {
      return
    }
    const target = threads.find((thread) => thread.id === editor.threadId)
    if (target) {
      setPendingDelete(target)
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete || saving) {
      return
    }
    setSaving(true)
    try {
      await deleteEventThread(pendingDelete.id)
      setPendingDelete(null)
      setEditor(null)
      setNotice('事件线已删除')
      setError(null)
      await refresh()
    } catch (deleteError) {
      console.warn('删除事件线失败', deleteError)
      setError('删除失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const renderThreadCard = (thread: EventThread) => {
    const stat = stats.get(thread.id)
    const expanded = expandedIds.includes(thread.id)
    const hasStatus = thread.currentStatus.trim().length > 0
    const clampable = hasStatus && isLongText(thread.currentStatus)
    const closed = thread.status === 'closed'
    return (
      <article
        key={thread.id}
        className={closed ? 'event-thread-card event-thread-card--closed' : 'event-thread-card'}
        onClick={() => navigate(`/events/${thread.id}`)}
        role="link"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            navigate(`/events/${thread.id}`)
          }
        }}
      >
        <div className="event-thread-card__top">
          <h3 className="event-thread-card__title">
            {thread.emojiGroup ? <span className="event-thread-card__emoji">{thread.emojiGroup}</span> : null}
            {thread.title}
          </h3>
          <span className={closed ? 'event-status-badge event-status-badge--closed' : 'event-status-badge'}>
            {closed ? '已结束' : '进行中'}
          </span>
        </div>
        <div className="event-thread-card__status-wrap">
          <span className="event-thread-card__status-label">当前状态</span>
          <p className={clampable && !expanded ? 'event-thread-card__status clamped' : 'event-thread-card__status'}>
            {hasStatus ? thread.currentStatus : '（还没写当前状态）'}
          </p>
          {clampable ? (
            <button type="button" className="event-expand-btn" onClick={(event) => toggleExpanded(event, thread.id)}>
              {expanded ? '收起 ▲' : '展开全文 ▼'}
            </button>
          ) : null}
        </div>
        <div className="event-thread-card__meta">
          <span>{formatDateRange(thread)}</span>
          <span>{stat?.count ?? 0} 条</span>
          {stat?.lastEntryDate ? <span>最近 {stat.lastEntryDate}</span> : null}
          <button type="button" className="event-inline-btn" onClick={(event) => openEditor(event, thread)}>
            编辑
          </button>
        </div>
      </article>
    )
  }

  return (
    <div className="event-page">
      <header className="event-header">
        <button type="button" className="ghost event-header-btn event-header-btn--left" onClick={() => navigate(-1)}>
          ← 返回
        </button>
        <div className="event-title-wrap">
          <p className="event-kicker">Event Chronicle</p>
          <h1 className="ui-title">事件集</h1>
        </div>
        <button type="button" className="event-create-btn" onClick={() => setEditor(buildEditorState())}>
          + 新建
        </button>
      </header>

      <section className="event-intro-card" aria-label="事件集说明与筛选">
        <div className="event-intro-dot" aria-hidden="true" />
        <div className="event-intro-top">
          <strong>
            线程进事件集
            <span className="event-count">
              进行中 {activeCount} · 已结束 {closedCount}
            </span>
          </strong>
          <p className="event-intro-hint">一件正在进行的事开一条线，进度按日期追加；结项归档，不删。</p>
        </div>
        <div className="event-chip-list">
          <button
            type="button"
            className={groupFilter === null ? 'event-chip selected' : 'event-chip'}
            onClick={() => setGroupFilter(null)}
          >
            全部
          </button>
          {EVENT_GROUP_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={groupFilter === option.value ? 'event-chip selected' : 'event-chip'}
              onClick={() => setGroupFilter((current) => (current === option.value ? null : option.value))}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      {notice ? <p className="event-notice">{notice}</p> : null}
      {error ? <p className="event-error">{error}</p> : null}

      <section className="event-thread-list" aria-label="进行中的事件线">
        <h2 className="event-section-title">进行中</h2>
        {loading ? <p className="tips">加载中…</p> : null}
        {!loading && activeThreads.length === 0 ? (
          <p className="tips event-empty">
            {threads.length === 0 ? '还没有事件线，点击右上角开第一条吧。' : '当前筛选下没有进行中的事件线。'}
          </p>
        ) : null}
        {activeThreads.map(renderThreadCard)}
      </section>

      {!loading && closedThreads.length > 0 ? (
        <section className="event-thread-list event-thread-list--archive" aria-label="已结束的事件线">
          <button
            type="button"
            className="event-archive-toggle"
            onClick={() => setArchiveOpen((current) => !current)}
            aria-expanded={archiveOpen}
          >
            <span className="event-section-title">已结束 · {closedThreads.length}</span>
            <span>{archiveOpen ? '收起 ▲' : '展开 ▼'}</span>
          </button>
          {archiveOpen ? closedThreads.map(renderThreadCard) : null}
        </section>
      ) : null}

      {editor ? (
        <div className="event-editor-backdrop" role="dialog" aria-modal="true" aria-label="事件线编辑">
          <form className="event-editor" onSubmit={handleSave}>
            <h2>{editor.mode === 'create' ? '新开事件线' : '编辑事件线'}</h2>
            <label>
              标题
              <input
                type="text"
                value={editor.title}
                onChange={(event) => setEditor({ ...editor, title: event.target.value })}
                placeholder="一件正在进行的事，如「荣格阶段」"
                required
              />
            </label>
            <label>
              当前状态（一行）
              <textarea
                rows={3}
                value={editor.currentStatus}
                onChange={(event) => setEditor({ ...editor, currentStatus: event.target.value })}
                placeholder="各端开机只读这一行，写成能一眼看懂的现状"
              />
            </label>
            <div className="event-editor__group">
              <strong>分组</strong>
              <div className="event-chip-list">
                <button
                  type="button"
                  className={editor.emojiGroup === null ? 'event-chip selected' : 'event-chip'}
                  onClick={() => setEditor({ ...editor, emojiGroup: null })}
                >
                  无
                </button>
                {EVENT_GROUP_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={editor.emojiGroup === option.value ? 'event-chip selected' : 'event-chip'}
                    onClick={() => setEditor({ ...editor, emojiGroup: option.value })}
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
                  value={editor.startedOn}
                  onChange={(event) => setEditor({ ...editor, startedOn: event.target.value })}
                  required
                />
              </label>
              {editor.mode === 'edit' ? (
                <label>
                  状态
                  <select
                    value={editor.status}
                    onChange={(event) => setEditor({ ...editor, status: event.target.value as EventThreadStatus })}
                  >
                    <option value="active">进行中</option>
                    <option value="closed">已结束</option>
                  </select>
                </label>
              ) : null}
            </div>
            {editor.mode === 'edit' && editor.status === 'closed' ? (
              <label>
                结束日期
                <input
                  type="date"
                  value={editor.endedOn}
                  onChange={(event) => setEditor({ ...editor, endedOn: event.target.value })}
                />
              </label>
            ) : null}

            <div className="event-editor__actions">
              <button type="button" className="secondary" onClick={() => setEditor(null)} disabled={saving}>
                取消
              </button>
              {editor.mode === 'edit' ? (
                <button type="button" className="danger" onClick={requestDelete} disabled={saving}>
                  删除
                </button>
              ) : null}
              <button type="submit" className="primary" disabled={saving || !editor.title.trim()}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这条事件线？"
        description={
          pendingDelete
            ? `「${pendingDelete.title}」及其全部 ${stats.get(pendingDelete.id)?.count ?? 0} 条条目将被彻底删除，无法恢复。结项归档不需要删除，只需把状态改为已结束。`
            : undefined
        }
        confirmLabel="彻底删除"
        confirmDisabled={saving}
        cancelDisabled={saving}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />

      {!loading && threads.length > 0 ? (
        <p className="event-footnote">最近活动：{formatLocalTimestamp(threads[0].updatedAt)}</p>
      ) : null}
    </div>
  )
}

export default EventCollectionPage
