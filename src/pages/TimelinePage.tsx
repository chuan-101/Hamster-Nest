import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { TimelineEntry, TimelineRecorder } from '../types'
import {
  createTimelineEntry,
  deleteTimelineEntry,
  listTimelineEntriesByMonth,
  updateTimelineEntry,
} from '../storage/supabaseSync'
import './TimelinePage.css'

type TimelineEditorState = {
  mode: 'create' | 'edit'
  entryId?: string
  eventDate: string
  summary: string
  recorder: TimelineRecorder
}

const RECORDER_META: Record<TimelineRecorder, { emoji: string; label: string }> = {
  chuanchuan: { emoji: '🐹', label: '串串' },
  syzygy: { emoji: '🌙', label: 'Syzygy' },
}

const getTodayDate = () => {
  const date = new Date()
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getMonthRange = (anchorDate: Date) => {
  const year = anchorDate.getFullYear()
  const month = anchorDate.getMonth()
  const start = new Date(year, month, 1)
  const end = new Date(year, month + 1, 0)
  const toDateKey = (value: Date) => {
    const y = value.getFullYear()
    const m = `${value.getMonth() + 1}`.padStart(2, '0')
    const d = `${value.getDate()}`.padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return {
    monthLabel: `${year}年${month + 1}月`,
    start: toDateKey(start),
    end: toDateKey(end),
  }
}

const buildEditorState = (entry?: TimelineEntry): TimelineEditorState => ({
  mode: entry ? 'edit' : 'create',
  entryId: entry?.id,
  eventDate: entry?.eventDate ?? getTodayDate(),
  summary: entry?.summary ?? '',
  recorder: entry?.recorder ?? 'chuanchuan',
})

const TimelinePage = () => {
  const navigate = useNavigate()
  const today = useMemo(() => getTodayDate(), [])
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<TimelineEditorState | null>(null)

  const monthRange = useMemo(() => getMonthRange(monthCursor), [monthCursor])

  const refresh = useCallback(async () => {
    setLoading(true)
    setEntries([])
    try {
      const data = await listTimelineEntriesByMonth(monthRange.start, monthRange.end)
      setEntries(data)
      setError(null)
    } catch (loadError) {
      console.warn('加载时间轴失败', loadError)
      setError('加载时间轴失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [monthRange.end, monthRange.start])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const entriesByDate = useMemo(() => {
    const groups = new Map<string, TimelineEntry[]>()
    entries.forEach((entry) => {
      const current = groups.get(entry.eventDate) ?? []
      current.push(entry)
      groups.set(entry.eventDate, current)
    })
    return groups
  }, [entries])

  const calendarCells = useMemo(() => {
    const first = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1)
    const firstWeekday = first.getDay()
    const daysInMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0).getDate()
    const cells: Array<{ dateKey: string; day: number; count: number } | null> = []

    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push(null)
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = `${monthCursor.getFullYear()}-${`${monthCursor.getMonth() + 1}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`
      const count = entriesByDate.get(dateKey)?.length ?? 0
      cells.push({ dateKey, day, count })
    }
    while (cells.length % 7 !== 0) {
      cells.push(null)
    }
    return cells
  }, [entriesByDate, monthCursor])

  const groupedList = useMemo(() => {
    return Array.from(entriesByDate.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [entriesByDate])

  const selectedEntries = useMemo(() => {
    if (!selectedDate) {
      return []
    }
    return entriesByDate.get(selectedDate) ?? []
  }, [entriesByDate, selectedDate])

  useEffect(() => {
    if (entries.length === 0) {
      setSelectedDate(null)
      return
    }
    const latestDate = entries.reduce((latest, entry) => (entry.eventDate > latest ? entry.eventDate : latest), entries[0].eventDate)
    setSelectedDate(latestDate)
  }, [entries, monthRange.start])

  const shiftMonth = (delta: number) => {
    setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1))
  }

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    if (!editor) {
      return
    }

    const summary = editor.summary.trim()
    if (!editor.eventDate) {
      setError('请选择日期')
      return
    }
    if (!summary) {
      setError('摘要不能为空')
      return
    }
    if (editor.recorder !== 'chuanchuan' && editor.recorder !== 'syzygy') {
      setError('记录人无效')
      return
    }

    setSaving(true)
    try {
      if (editor.mode === 'create') {
        await createTimelineEntry({
          eventDate: editor.eventDate,
          summary,
          recorder: editor.recorder,
        })
        setNotice('时间轴已创建')
      } else if (editor.entryId) {
        await updateTimelineEntry(editor.entryId, {
          eventDate: editor.eventDate,
          summary,
          recorder: editor.recorder,
        })
        setNotice('时间轴已更新')
      }
      setEditor(null)
      setError(null)
      await refresh()
    } catch (saveError) {
      console.warn('保存时间轴失败', saveError)
      setError('保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!editor?.entryId || saving) {
      return
    }
    const confirmed = window.confirm('确认删除这条时间轴记录吗？删除后不可恢复。')
    if (!confirmed) {
      return
    }
    setSaving(true)
    try {
      await deleteTimelineEntry(editor.entryId)
      setEditor(null)
      setNotice('时间轴已删除')
      setError(null)
      await refresh()
    } catch (deleteError) {
      console.warn('删除时间轴失败', deleteError)
      setError('删除失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="timeline-page">
      <header className="timeline-header">
        <button type="button" className="ghost timeline-back-btn" onClick={() => navigate(-1)}>
          ← 返回
        </button>
        <div className="timeline-title-wrap">
          <p className="timeline-kicker">Timeline</p>
          <h1 className="ui-title">时间轴</h1>
        </div>
        <button type="button" className="timeline-create-btn" onClick={() => setEditor(buildEditorState())}>
          + 新建
        </button>
      </header>

      <section className="timeline-calendar" aria-label="月份日历">
        <div className="timeline-calendar__dot" aria-hidden="true" />
        <div className="timeline-calendar__top">
          <button type="button" className="ghost" onClick={() => shiftMonth(-1)}>
            ← 上月
          </button>
          <strong>{monthRange.monthLabel}</strong>
          <button type="button" className="ghost" onClick={() => shiftMonth(1)}>
            下月 →
          </button>
        </div>
        <div className="timeline-calendar__weekdays">
          {['日', '一', '二', '三', '四', '五', '六'].map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="timeline-calendar__grid">
          {calendarCells.map((cell, index) =>
            cell ? (
              <button
                key={cell.dateKey}
                type="button"
                className={[
                  'timeline-calendar__cell',
                  cell.count > 0 && 'has-entry',
                  cell.dateKey === today && 'today',
                  cell.dateKey === selectedDate && 'selected',
                ].filter(Boolean).join(' ')}
                title={cell.count > 0 ? `${cell.dateKey} 有 ${cell.count} 条记录` : cell.dateKey}
                onClick={() => setSelectedDate(cell.dateKey)}
                aria-pressed={cell.dateKey === selectedDate}
              >
                <span>{cell.day}</span>
                {cell.count > 1 ? <em>{cell.count}</em> : null}
              </button>
            ) : (
              <div key={`blank-${index}`} className="timeline-calendar__cell timeline-calendar__cell--blank" />
            ),
          )}
        </div>
      </section>

      {notice ? <p className="timeline-notice">{notice}</p> : null}
      {error ? <p className="timeline-error">{error}</p> : null}

      <section className="timeline-list" aria-label="时间轴列表">
        <div className="timeline-list__body">
          {loading ? <p className="tips">加载中…</p> : null}
          {!loading && groupedList.length === 0 ? <p className="timeline-empty">当前月份暂无记录</p> : null}
          {!loading && groupedList.length > 0 && !selectedDate ? <p className="timeline-empty">请选择日期查看记录</p> : null}
          {!loading && selectedDate ? (
            <article className="timeline-date-group">
              <h2>{selectedDate}</h2>
              {selectedEntries.length === 0 ? (
                <p className="timeline-empty">当天暂无记录</p>
              ) : (
                <div className="timeline-date-group__entries">
                  {selectedEntries.map((entry) => {
                    const recorderMeta = RECORDER_META[entry.recorder]
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        className="timeline-card"
                        onClick={() => setEditor(buildEditorState(entry))}
                      >
                        <span className="timeline-card__recorder" title={recorderMeta.label}>
                          {recorderMeta.emoji}
                        </span>
                        <p className="timeline-card__summary">{entry.summary}</p>
                      </button>
                    )
                  })}
                </div>
              )}
            </article>
          ) : null}
        </div>
      </section>

      {editor ? (
        <div className="timeline-editor-backdrop" role="dialog" aria-modal="true">
          <form className="timeline-editor" onSubmit={handleSave}>
            <h2>{editor.mode === 'create' ? '新建时间轴' : '编辑时间轴'}</h2>
            <label>
              日期
              <input
                type="date"
                value={editor.eventDate}
                onChange={(event) => setEditor({ ...editor, eventDate: event.target.value })}
                required
              />
            </label>
            <label>
              摘要
              <textarea
                value={editor.summary}
                onChange={(event) => setEditor({ ...editor, summary: event.target.value })}
                rows={5}
                required
              />
            </label>
            <label>
              记录人
              <select
                value={editor.recorder}
                onChange={(event) => setEditor({ ...editor, recorder: event.target.value as TimelineRecorder })}
              >
                <option value="chuanchuan">{RECORDER_META.chuanchuan.emoji} {RECORDER_META.chuanchuan.label}</option>
                <option value="syzygy">{RECORDER_META.syzygy.emoji} {RECORDER_META.syzygy.label}</option>
              </select>
            </label>

            <div className="timeline-editor__actions">
              <button type="button" className="secondary" onClick={() => setEditor(null)} disabled={saving}>
                取消
              </button>
              {editor.mode === 'edit' ? (
                <button type="button" className="danger" onClick={handleDelete} disabled={saving}>
                  删除
                </button>
              ) : null}
              <button type="submit" className="primary" disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}

export default TimelinePage
