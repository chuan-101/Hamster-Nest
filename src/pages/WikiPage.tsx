import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const COLLAPSED_TAG_COUNT = 12

const emptyEditor = (): EditorState => ({ title: '', content: '', category: '', tags: '', status: 'draft' })

const parseTags = (value: string) =>
  value
    .split(/[,，]/)
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
  const [reading, setReading] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [tagsExpanded, setTagsExpanded] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editor, setEditor] = useState<EditorState>(emptyEditor())
  const browseScrollRef = useRef(0)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listWikiEntries()
      setEntries(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const categories = useMemo(() => Array.from(new Set(entries.map((e) => e.category))).sort(), [entries])

  // tag 按使用频次降序排列，频次相同按字典序，供折叠展示与编辑器快捷选择复用
  const rankedTags = useMemo(() => {
    const counts = new Map<string, number>()
    entries.forEach((entry) => entry.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)))
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN'))
      .map(([tag]) => tag)
  }, [entries])

  const visibleTags = useMemo(() => {
    if (tagsExpanded) return rankedTags
    const top = rankedTags.slice(0, COLLAPSED_TAG_COUNT)
    if (tagFilter && !top.includes(tagFilter)) top.push(tagFilter)
    return top
  }, [rankedTags, tagsExpanded, tagFilter])

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
    if (!reading && !editing) browseScrollRef.current = window.scrollY
    setSelectedId(entry.id)
    setEditing(false)
    setReading(true)
    window.scrollTo(0, 0)
  }

  const backToList = () => {
    setReading(false)
    requestAnimationFrame(() => window.scrollTo(0, browseScrollRef.current))
  }

  const filterByTag = (tag: string) => {
    setTagFilter(tag)
    setReading(false)
    requestAnimationFrame(() => window.scrollTo(0, 0))
  }

  const startCreate = () => {
    setSelectedId(null)
    setReading(false)
    setEditor(emptyEditor())
    setEditing(true)
    window.scrollTo(0, 0)
  }

  const startEdit = () => {
    if (!selected) return
    setEditor(toEditorState(selected))
    setEditing(true)
    window.scrollTo(0, 0)
  }

  const toggleEditorTag = (tag: string) => {
    setEditor((prev) => {
      const tags = parseTags(prev.tags)
      const next = tags.includes(tag) ? tags.filter((item) => item !== tag) : [...tags, tag]
      return { ...prev, tags: next.join(', ') }
    })
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

  const view = editing ? 'edit' : reading && selected ? 'read' : 'browse'
  const editorTags = parseTags(editor.tags)

  return (
    <div className="wiki-page">
      {view === 'browse' && (
        <aside className="wiki-nav" aria-label="Wiki 导航筛选区">
          <div className="wiki-header">
            <button type="button" className="wiki-back" onClick={() => navigate('/')}>← 返回</button>
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
              {visibleTags.map((tag) => (
                <button key={tag} type="button" className={tagFilter === tag ? 'pill active' : 'pill'} onClick={() => setTagFilter(tagFilter === tag ? null : tag)}>{tag}</button>
              ))}
              {rankedTags.length > COLLAPSED_TAG_COUNT && (
                <button type="button" className="pill wiki-tags-toggle" onClick={() => setTagsExpanded((prev) => !prev)}>
                  {tagsExpanded ? '收起 ▴' : `全部 ${rankedTags.length} 个 ▾`}
                </button>
              )}
            </div>
          </div>
          <div className="wiki-groups">
            {grouped.map(([category, list]) => (
              <section key={category}>
                <button type="button" className="wiki-group-title" onClick={() => setCollapsed((prev) => ({ ...prev, [category]: !prev[category] }))}>{collapsed[category] ? '▸' : '▾'} {category}<span className="wiki-group-count">{list.length}</span></button>
                {!collapsed[category] && list.map((entry) => (
                  <button type="button" key={entry.id} className="wiki-item" onClick={() => openEntry(entry)}>
                    {entry.title}
                    {entry.status === 'draft' && <span className="wiki-draft-mark">草稿</span>}
                  </button>
                ))}
              </section>
            ))}
            {!loading && grouped.length === 0 && <p className="wiki-empty">暂无条目</p>}
          </div>
        </aside>
      )}

      {view === 'read' && selected && (
        <main className="wiki-main">
          <article className="wiki-reader">
            <header className="wiki-reader-top">
              <button type="button" className="wiki-back" onClick={backToList}>← 目录</button>
              <button type="button" className="wiki-create" onClick={startEdit}>编辑</button>
            </header>
            <h1 className="wiki-reader-title">{selected.title}</h1>
            <p className="wiki-meta">{selected.category} · {selected.status}</p>
            {selected.tags.length > 0 && (
              <div className="wiki-entry-tags">
                {selected.tags.map((tag) => (
                  <button key={tag} type="button" className="pill" onClick={() => filterByTag(tag)}>{tag}</button>
                ))}
              </div>
            )}
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
        </main>
      )}

      {view === 'edit' && (
        <main className="wiki-main">
          <section className="wiki-editor">
            <header className="wiki-reader-top">
              <button type="button" className="wiki-back" onClick={() => setEditing(false)}>← 取消</button>
              <span className="wiki-editor-heading">{editor.id ? '编辑条目' : '新建条目'}</span>
            </header>
            <input className="wiki-input" placeholder="标题" value={editor.title} onChange={(e) => setEditor((prev) => ({ ...prev, title: e.target.value }))} />
            <input className="wiki-input" placeholder="分类" value={editor.category} onChange={(e) => setEditor((prev) => ({ ...prev, category: e.target.value }))} list="wiki-category-options" />
            <datalist id="wiki-category-options">
              {categories.map((category) => <option key={category} value={category} />)}
            </datalist>
            <input className="wiki-input" placeholder="标签（逗号分隔，优先复用下方已有标签）" value={editor.tags} onChange={(e) => setEditor((prev) => ({ ...prev, tags: e.target.value }))} />
            {rankedTags.length > 0 && (
              <div className="wiki-tag-suggest">
                {rankedTags.slice(0, 15).map((tag) => (
                  <button key={tag} type="button" className={editorTags.includes(tag) ? 'pill active' : 'pill'} onClick={() => toggleEditorTag(tag)}>{tag}</button>
                ))}
              </div>
            )}
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
        </main>
      )}
    </div>
  )
}

export default WikiPage
