import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { WikiEntry, WikiEntryStatus } from '../types'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { createWikiEntry, listWikiEntries, updateWikiEntry } from '../storage/supabaseSync'
import './WikiPage.css'

type EditorState = {
  id?: string
  title: string
  content: string
  category: string
  tags: string
  status: WikiEntryStatus
}

const emptyEditor = (): EditorState => ({ title: '', content: '', category: '', tags: '', status: 'draft' })

const parseTags = (value: string) =>
  value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)

const toEditorState = (entry: WikiEntry): EditorState => ({
  id: entry.id,
  title: entry.title,
  content: entry.content,
  category: entry.category,
  tags: entry.tags.join(', '),
  status: entry.status,
})

const WikiPage = () => {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<WikiEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editor, setEditor] = useState<EditorState>(emptyEditor())

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listWikiEntries()
      setEntries(data)
      if (!selectedId && data[0]) setSelectedId(data[0].id)
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const categories = useMemo(() => Array.from(new Set(entries.map((e) => e.category))).sort(), [entries])
  const allTags = useMemo(() => Array.from(new Set(entries.flatMap((e) => e.tags))).sort(), [entries])

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return entries.filter((entry) => {
      if (categoryFilter !== 'all' && entry.category !== categoryFilter) return false
      if (tagFilter && !entry.tags.includes(tagFilter)) return false
      if (!keyword) return true
      return (
        entry.title.toLowerCase().includes(keyword) ||
        entry.content.toLowerCase().includes(keyword) ||
        entry.tags.some((tag) => tag.toLowerCase().includes(keyword))
      )
    })
  }, [entries, search, categoryFilter, tagFilter])

  const grouped = useMemo(() => {
    const map = new Map<string, WikiEntry[]>()
    filtered.forEach((entry) => {
      const list = map.get(entry.category) ?? []
      list.push(entry)
      map.set(entry.category, list)
    })
    return Array.from(map.entries())
  }, [filtered])

  const selected = entries.find((entry) => entry.id === selectedId) ?? null

  const linkedTitles = useMemo(() => {
    if (!selected) return []
    const re = /\[\[([^\]]+)\]\]/g
    const found = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = re.exec(selected.content))) found.add(m[1].trim())
    return Array.from(found)
  }, [selected])

  const backlinkEntries = useMemo(() => {
    if (!selected) return []
    const marker = `[[${selected.title}]]`
    return entries.filter((entry) => entry.id !== selected.id && entry.content.includes(marker))
  }, [selected, entries])

  const openEntry = (entry: WikiEntry) => {
    setSelectedId(entry.id)
    setEditing(false)
  }

  const startCreate = () => {
    setSelectedId(null)
    setEditor(emptyEditor())
    setEditing(true)
  }

  const startEdit = () => {
    if (!selected) return
    setEditor(toEditorState(selected))
    setEditing(true)
  }

  const save = async () => {
    const payload = {
      title: editor.title.trim(),
      content: editor.content,
      category: editor.category.trim(),
      tags: parseTags(editor.tags),
      status: editor.status,
    }
    if (!payload.title || !payload.category) return
    if (editor.id) {
      await updateWikiEntry(editor.id, payload)
      setSelectedId(editor.id)
    } else {
      await createWikiEntry(payload)
    }
    setEditing(false)
    await refresh()
  }

  return (
    <div className="wiki-page">
      <aside className="wiki-nav" aria-label="Wiki 导航筛选区">
        <div className="wiki-header">
          <button type="button" className="wiki-back" onClick={() => navigate(-1)}>← 返回</button>
          <div className="wiki-title-wrap">
            <p className="wiki-kicker">WIKI</p>
            <h1 className="ui-title">Wiki</h1>
          </div>
          <button type="button" className="wiki-create" onClick={startCreate}>+ 新建</button>
        </div>
        <div className="wiki-filter-card">
          <div className="wiki-filter-dot" aria-hidden="true" />
          <div className="wiki-filter-grid">
            <input className="wiki-input" placeholder="搜索标题/正文/tag" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="wiki-input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="all">全部分类</option>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </div>
          <div className="wiki-tags">
            <button type="button" className={!tagFilter ? 'pill active' : 'pill'} onClick={() => setTagFilter(null)}>全部</button>
            {allTags.map((tag) => (
              <button key={tag} type="button" className={tagFilter === tag ? 'pill active' : 'pill'} onClick={() => setTagFilter(tag)}>{tag}</button>
            ))}
          </div>
        </div>
        <div className="wiki-groups">
          {grouped.map(([category, list]) => (
            <section key={category}>
              <button type="button" className="wiki-group-title" onClick={() => setCollapsed((prev) => ({ ...prev, [category]: !prev[category] }))}>{collapsed[category] ? '▸' : '▾'} {category}</button>
              {!collapsed[category] && list.map((entry) => <button type="button" key={entry.id} className={entry.id === selectedId ? 'wiki-item active' : 'wiki-item'} onClick={() => openEntry(entry)}>{entry.title}</button>)}
            </section>
          ))}
          {!loading && grouped.length === 0 && <p className="wiki-empty">暂无条目</p>}
        </div>
      </aside>

      <main className="wiki-main">
        {!editing && selected && (
          <article className="wiki-reader">
            <header className="wiki-reader-head">
              <h1>{selected.title}</h1>
              <button type="button" className="wiki-create" onClick={startEdit}>编辑</button>
            </header>
            <p className="wiki-meta">{selected.category} · {selected.status}</p>
            <div className="wiki-content-body">
              <MarkdownRenderer
                content={selected.content}
                onWikiLinkClick={(title) => {
                  const target = entries.find((entry) => entry.title === title)
                  if (target) openEntry(target)
                }}
              />
            </div>
            {linkedTitles.length > 0 && <p className="wiki-linked">链接到：{linkedTitles.join('、')}</p>}
            <section className="wiki-backlinks">
              <h3>反向链接</h3>
              {backlinkEntries.length === 0 ? <p>暂无反向链接</p> : backlinkEntries.map((entry) => <button type="button" key={entry.id} className="wiki-item" onClick={() => openEntry(entry)}>{entry.title}</button>)}
            </section>
          </article>
        )}
        {editing && (
          <section className="wiki-editor">
            <input className="wiki-input" placeholder="标题" value={editor.title} onChange={(e) => setEditor((prev) => ({ ...prev, title: e.target.value }))} />
            <input className="wiki-input" placeholder="分类" value={editor.category} onChange={(e) => setEditor((prev) => ({ ...prev, category: e.target.value }))} />
            <input className="wiki-input" placeholder="标签（英文逗号分隔）" value={editor.tags} onChange={(e) => setEditor((prev) => ({ ...prev, tags: e.target.value }))} />
            <select className="wiki-input" value={editor.status} onChange={(e) => setEditor((prev) => ({ ...prev, status: e.target.value as WikiEntryStatus }))}>
              <option value="draft">draft</option>
              <option value="published">published</option>
            </select>
            <textarea className="wiki-textarea" placeholder="Markdown 正文，支持 [[词条]]" value={editor.content} onChange={(e) => setEditor((prev) => ({ ...prev, content: e.target.value }))} />
            <div className="wiki-editor-actions">
              <button type="button" className="wiki-create" onClick={save}>保存</button>
              <button type="button" className="wiki-back" onClick={() => setEditing(false)}>取消</button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default WikiPage
