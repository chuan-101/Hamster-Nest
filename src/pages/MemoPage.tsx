import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MemoEntry, MemoTag } from '../types'
import {
  createMemoEntry,
  createMemoTag,
  listMemoEntries,
  listMemoTags,
  softDeleteMemoEntry,
  updateMemoEntry,
} from '../storage/supabaseSync'
import { formatLocalTimestamp } from '../utils/time'
import './MemoPage.css'

type FilterMode = 'or' | 'and'

type EditorState = {
  mode: 'create' | 'edit'
  entryId?: string
  content: string
  isPinned: boolean
  selectedTagIds: string[]
  newTagInput: string
}

const buildEditorState = (entry?: MemoEntry): EditorState => ({
  mode: entry ? 'edit' : 'create',
  entryId: entry?.id,
  content: entry?.content ?? '',
  isPinned: entry?.isPinned ?? false,
  selectedTagIds: entry?.tagIds ?? [],
  newTagInput: '',
})

const MemoPage = () => {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<MemoEntry[]>([])
  const [tags, setTags] = useState<MemoTag[]>([])
  const [selectedFilterTagIds, setSelectedFilterTagIds] = useState<string[]>([])
  const [filterMode, setFilterMode] = useState<FilterMode>('or')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [nextEntries, nextTags] = await Promise.all([listMemoEntries(), listMemoTags()])
      setEntries(nextEntries)
      setTags(nextTags)
      setError(null)
    } catch (loadError) {
      console.warn('加载备忘录失败', loadError)
      setError('加载备忘录失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const tagMap = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags])

  const sortedAndFilteredEntries = useMemo(() => {
    const scoped = entries.filter((entry) => {
      if (selectedFilterTagIds.length === 0) {
        return true
      }
      if (filterMode === 'and') {
        return selectedFilterTagIds.every((tagId) => entry.tagIds.includes(tagId))
      }
      return selectedFilterTagIds.some((tagId) => entry.tagIds.includes(tagId))
    })
    return [...scoped].sort((a, b) => {
      if (a.isPinned !== b.isPinned) {
        return a.isPinned ? -1 : 1
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })
  }, [entries, filterMode, selectedFilterTagIds])

  const toggleFilterTag = (tagId: string) => {
    setSelectedFilterTagIds((current) =>
      current.includes(tagId) ? current.filter((item) => item !== tagId) : [...current, tagId],
    )
  }

  const toggleEditorTag = (tagId: string) => {
    if (!editor) {
      return
    }
    setEditor({
      ...editor,
      selectedTagIds: editor.selectedTagIds.includes(tagId)
        ? editor.selectedTagIds.filter((id) => id !== tagId)
        : [...editor.selectedTagIds, tagId],
    })
  }

  const ensureTag = async (rawName: string): Promise<MemoTag | null> => {
    const trimmed = rawName.trim()
    if (!trimmed) {
      return null
    }
    const existing = tags.find((tag) => tag.name === trimmed)
    if (existing) {
      return existing
    }
    const created = await createMemoTag(trimmed)
    setTags((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)))
    return created
  }

  const handleCreateInlineTag = async () => {
    if (!editor) {
      return
    }
    try {
      const created = await ensureTag(editor.newTagInput)
      if (!created) {
        return
      }
      setEditor((current) => {
        if (!current) {
          return current
        }
        const nextTagIds = current.selectedTagIds.includes(created.id)
          ? current.selectedTagIds
          : [...current.selectedTagIds, created.id]
        return {
          ...current,
          selectedTagIds: nextTagIds,
          newTagInput: '',
        }
      })
      setNotice('标签已添加')
      setError(null)
    } catch (tagError) {
      console.warn('创建标签失败', tagError)
      setError('创建标签失败，请稍后重试')
    }
  }

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    if (!editor) {
      return
    }
    const trimmedContent = editor.content.trim()
    if (!trimmedContent) {
      setError('内容不能为空')
      return
    }
    setSaving(true)
    try {
      let nextTagIds = editor.selectedTagIds
      if (editor.newTagInput.trim()) {
        const created = await ensureTag(editor.newTagInput)
        if (created && !nextTagIds.includes(created.id)) {
          nextTagIds = [...nextTagIds, created.id]
        }
      }
      if (editor.mode === 'create') {
        await createMemoEntry({
          content: trimmedContent,
          isPinned: editor.isPinned,
          source: 'user',
          tagIds: nextTagIds,
        })
        setNotice('备忘录已创建')
      } else if (editor.entryId) {
        await updateMemoEntry(editor.entryId, {
          content: trimmedContent,
          isPinned: editor.isPinned,
          tagIds: nextTagIds,
        })
        setNotice('备忘录已更新')
      }
      setEditor(null)
      setError(null)
      await refresh()
    } catch (saveError) {
      console.warn('保存备忘录失败', saveError)
      setError('保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!editor?.entryId || saving) {
      return
    }
    const confirmed = window.confirm('确认删除这条备忘录吗？删除后将在列表中隐藏。')
    if (!confirmed) {
      return
    }
    setSaving(true)
    try {
      await softDeleteMemoEntry(editor.entryId)
      setEditor(null)
      setNotice('备忘录已删除')
      setError(null)
      await refresh()
    } catch (deleteError) {
      console.warn('删除备忘录失败', deleteError)
      setError('删除失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="memo-page">
      <header className="memo-header">
        <button type="button" className="ghost memo-header-btn" onClick={() => navigate(-1)}>
          ← 返回
        </button>
        <div className="memo-title-wrap">
          <p className="memo-kicker">Cozy Notes</p>
          <h1 className="ui-title">备忘录</h1>
        </div>
        <button type="button" className="memo-create-btn" onClick={() => setEditor(buildEditorState())}>
          + 新建
        </button>
      </header>

      <section className="memo-filter-card" aria-label="标签筛选面板">
        <div className="memo-filter-dot" aria-hidden="true" />
        <div className="memo-filter-top">
          <strong>标签筛选</strong>
          <div className="memo-mode-toggle" role="group" aria-label="筛选模式">
            <button
              type="button"
              className={filterMode === 'or' ? 'active' : ''}
              onClick={() => setFilterMode('or')}
            >
              OR
            </button>
            <button
              type="button"
              className={filterMode === 'and' ? 'active' : ''}
              onClick={() => setFilterMode('and')}
            >
              AND
            </button>
          </div>
        </div>
        <div className="memo-tag-chip-list">
          {tags.length === 0 ? <span className="tips">暂无标签</span> : null}
          {tags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className={selectedFilterTagIds.includes(tag.id) ? 'tag-chip selected' : 'tag-chip'}
              onClick={() => toggleFilterTag(tag.id)}
            >
              #{tag.name}
            </button>
          ))}
        </div>
      </section>

      {notice ? <p className="memo-notice">{notice}</p> : null}
      {error ? <p className="memo-error">{error}</p> : null}

      <section className="memo-list" aria-label="备忘录列表">
        {loading ? <p className="tips">加载中…</p> : null}
        {!loading && sortedAndFilteredEntries.length === 0 ? (
          <p className="tips memo-empty">还没有备忘录，点击右上角新建吧。</p>
        ) : null}
        {sortedAndFilteredEntries.map((entry) => (
          <article key={entry.id} className="memo-card" onClick={() => setEditor(buildEditorState(entry))}>
            <div className="memo-card__top">
              <span className="memo-source">来源：{entry.source === 'ai' ? 'AI' : '用户'}</span>
              {entry.isPinned ? <span className="memo-pin">📌 置顶</span> : null}
            </div>
            <p className="memo-content-preview">{entry.content}</p>
            <div className="memo-card__tags">
              {entry.tagIds.length === 0 ? <span className="tips">无标签</span> : null}
              {entry.tagIds.map((tagId) => (
                <span key={tagId} className="tag-chip static">
                  #{tagMap.get(tagId)?.name ?? '未命名'}
                </span>
              ))}
            </div>
            <time className="memo-time">更新于 {formatLocalTimestamp(entry.updatedAt)}</time>
          </article>
        ))}
      </section>

      {editor ? (
        <div className="memo-editor-backdrop" role="dialog" aria-modal="true" aria-label="备忘录编辑">
          <form className="memo-editor" onSubmit={handleSave}>
            <h2>{editor.mode === 'create' ? '新建备忘录' : '编辑备忘录'}</h2>
            <textarea
              rows={6}
              value={editor.content}
              onChange={(event) => setEditor({ ...editor, content: event.target.value })}
              placeholder="写下你想保存的信息..."
            />

            <label className="memo-editor__pin">
              <input
                type="checkbox"
                checked={editor.isPinned}
                onChange={(event) => setEditor({ ...editor, isPinned: event.target.checked })}
              />
              置顶
            </label>

            <div className="memo-editor__tag-pool">
              <strong>标签</strong>
              <div className="memo-tag-chip-list">
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className={editor.selectedTagIds.includes(tag.id) ? 'tag-chip selected' : 'tag-chip'}
                    onClick={() => toggleEditorTag(tag.id)}
                  >
                    #{tag.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="memo-editor__new-tag">
              <input
                type="text"
                value={editor.newTagInput}
                onChange={(event) => setEditor({ ...editor, newTagInput: event.target.value })}
                placeholder="输入新标签"
              />
              <button type="button" className="ghost" onClick={() => void handleCreateInlineTag()}>
                添加
              </button>
            </div>

            <div className="memo-editor__actions">
              <button type="button" className="ghost" onClick={() => setEditor(null)}>
                取消
              </button>
              {editor.mode === 'edit' ? (
                <button type="button" className="danger" onClick={() => void handleDelete()} disabled={saving}>
                  删除
                </button>
              ) : null}
              <button type="submit" className="memo-save-btn" disabled={saving || !editor.content.trim()}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}

export default MemoPage
