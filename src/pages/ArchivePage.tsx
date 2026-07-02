import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { useNavigate } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  createArchive,
  createArchiveCategory,
  deleteArchiveCategory,
  listArchiveCategories,
  listArchives,
  renameArchiveCategory,
  softDeleteArchive,
  updateArchive,
} from '../storage/supabaseSync'
import type { Archive, ArchiveCategory, ArchiveImportance, ArchiveScope } from '../types'
import './ArchivePage.css'

const SCOPE_META: Record<ArchiveScope, { label: string; emoji: string; kicker: string }> = {
  chuanchuan: { label: '串串', emoji: '🐹', kicker: 'CHUANCHUAN' },
  syzygy: { label: 'Syzygy', emoji: '🩵', kicker: 'SYZYGY' },
}

const IMPORTANCE_ORDER: ArchiveImportance[] = ['low', 'normal', 'high', 'critical']
const IMPORTANCE_META: Record<ArchiveImportance, { label: string }> = {
  low: { label: '低' },
  normal: { label: '普通' },
  high: { label: '高' },
  critical: { label: '关键' },
}

const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })

type CategoryFormState =
  | { mode: 'create'; parentId: string | null; parentName: string | null; name: string }
  | { mode: 'rename'; categoryId: string; name: string }

type ArchiveEditorState = {
  mode: 'create' | 'edit'
  archiveId?: string
  categoryId: string
  title: string
  content: string
  keywords: string[]
  aliases: string[]
  importance: ArchiveImportance
  source: string
  updatedAt?: string
}

type FlatCategory = { category: ArchiveCategory; depth: number }

const flattenCategories = (categories: ArchiveCategory[]): FlatCategory[] => {
  const childrenMap = new Map<string, ArchiveCategory[]>()
  categories.forEach((category) => {
    const key = category.parentId ?? '__root__'
    const list = childrenMap.get(key) ?? []
    list.push(category)
    childrenMap.set(key, list)
  })
  const result: FlatCategory[] = []
  const walk = (parentKey: string, depth: number) => {
    const children = childrenMap.get(parentKey) ?? []
    children.forEach((category) => {
      result.push({ category, depth })
      walk(category.id, depth + 1)
    })
  }
  walk('__root__', 0)
  return result
}

// ── Tag input ────────────────────────────────────────────

type TagInputProps = {
  values: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}

const TagInput = ({ values, onChange, placeholder }: TagInputProps) => {
  const [draft, setDraft] = useState('')

  const commit = (raw: string) => {
    const tokens = raw
      .split(/[,，]/)
      .map((token) => token.trim())
      .filter(Boolean)
    if (tokens.length === 0) {
      return
    }
    const merged = [...values]
    tokens.forEach((token) => {
      if (!merged.includes(token)) {
        merged.push(token)
      }
    })
    onChange(merged)
    setDraft('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
      event.preventDefault()
      commit(draft)
    } else if (event.key === 'Backspace' && draft.length === 0 && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  return (
    <div className="archive-taginput">
      {values.map((tag) => (
        <span key={tag} className="archive-tag">
          {tag}
          <button
            type="button"
            className="archive-tag__remove"
            aria-label={`移除 ${tag}`}
            onClick={() => onChange(values.filter((item) => item !== tag))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        placeholder={values.length === 0 ? placeholder : ''}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => commit(draft)}
      />
    </div>
  )
}

const ArchivePage = () => {
  const navigate = useNavigate()
  const [scope, setScope] = useState<ArchiveScope>('chuanchuan')
  const [categories, setCategories] = useState<ArchiveCategory[]>([])
  const [archives, setArchives] = useState<Archive[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [expandedArchiveIds, setExpandedArchiveIds] = useState<Set<string>>(() => new Set())
  const [search, setSearch] = useState('')

  const [loadingCategories, setLoadingCategories] = useState(true)
  const [loadingArchives, setLoadingArchives] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [categoryForm, setCategoryForm] = useState<CategoryFormState | null>(null)
  const [archiveEditor, setArchiveEditor] = useState<ArchiveEditorState | null>(null)
  const [pendingDeleteCategory, setPendingDeleteCategory] = useState<ArchiveCategory | null>(null)
  const [pendingDeleteArchive, setPendingDeleteArchive] = useState<Archive | null>(null)

  const flatCategories = useMemo(() => flattenCategories(categories), [categories])

  const refreshCategories = useCallback(async () => {
    setLoadingCategories(true)
    try {
      const data = await listArchiveCategories(scope)
      setCategories(data)
      setError(null)
    } catch (loadError) {
      console.warn('加载档案目录失败', loadError)
      setError('加载档案目录失败，请稍后重试')
      setCategories([])
    } finally {
      setLoadingCategories(false)
    }
  }, [scope])

  useEffect(() => {
    void refreshCategories()
  }, [refreshCategories])

  // Pick a valid selected category whenever the category set changes.
  useEffect(() => {
    if (categories.length === 0) {
      setSelectedCategoryId(null)
      return
    }
    setSelectedCategoryId((current) => {
      if (current && categories.some((category) => category.id === current)) {
        return current
      }
      return flattenCategories(categories)[0]?.category.id ?? null
    })
  }, [categories])

  const refreshArchives = useCallback(async (categoryId: string | null) => {
    if (!categoryId) {
      setArchives([])
      return
    }
    setLoadingArchives(true)
    try {
      const data = await listArchives(categoryId)
      setArchives(data)
      setError(null)
    } catch (loadError) {
      console.warn('加载档案条目失败', loadError)
      setError('加载档案条目失败，请稍后重试')
      setArchives([])
    } finally {
      setLoadingArchives(false)
    }
  }, [])

  useEffect(() => {
    setSearch('')
    setExpandedArchiveIds(new Set())
    void refreshArchives(selectedCategoryId)
  }, [selectedCategoryId, refreshArchives])

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === selectedCategoryId) ?? null,
    [categories, selectedCategoryId],
  )

  const filteredArchives = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) {
      return archives
    }
    return archives.filter((archive) => {
      const haystack = [
        archive.title,
        archive.content,
        ...archive.keywords,
        ...archive.aliases,
      ]
        .join('\n')
        .toLowerCase()
      return haystack.includes(keyword)
    })
  }, [archives, search])

  const childrenMap = useMemo(() => {
    const map = new Map<string, ArchiveCategory[]>()
    categories.forEach((category) => {
      const key = category.parentId ?? '__root__'
      const list = map.get(key) ?? []
      list.push(category)
      map.set(key, list)
    })
    return map
  }, [categories])

  const handleSwitchScope = (next: ArchiveScope) => {
    if (next === scope) {
      return
    }
    setNotice(null)
    setError(null)
    setSelectedCategoryId(null)
    setCategories([])
    setArchives([])
    setScope(next)
  }

  const toggleArchiveExpanded = (archiveId: string) => {
    setExpandedArchiveIds((current) => {
      const next = new Set(current)
      if (next.has(archiveId)) {
        next.delete(archiveId)
      } else {
        next.add(archiveId)
      }
      return next
    })
  }

  const toggleCollapse = (categoryId: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(categoryId)) {
        next.delete(categoryId)
      } else {
        next.add(categoryId)
      }
      return next
    })
  }

  const nextSortOrder = (parentId: string | null) => {
    const siblings = childrenMap.get(parentId ?? '__root__') ?? []
    return siblings.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 10
  }

  const handleSubmitCategory = async (event: FormEvent) => {
    event.preventDefault()
    if (!categoryForm) {
      return
    }
    const name = categoryForm.name.trim()
    if (!name) {
      setError('目录名称不能为空')
      return
    }
    setSaving(true)
    try {
      if (categoryForm.mode === 'create') {
        const created = await createArchiveCategory({
          scope,
          name,
          parentId: categoryForm.parentId,
          sortOrder: nextSortOrder(categoryForm.parentId),
        })
        setNotice('目录已创建')
        setError(null)
        setCategoryForm(null)
        await refreshCategories()
        if (categoryForm.parentId) {
          setCollapsed((current) => {
            const next = new Set(current)
            next.delete(categoryForm.parentId as string)
            return next
          })
        }
        setSelectedCategoryId(created.id)
      } else {
        await renameArchiveCategory(categoryForm.categoryId, name)
        setNotice('目录已重命名')
        setError(null)
        setCategoryForm(null)
        await refreshCategories()
      }
    } catch (saveError) {
      console.warn('保存目录失败', saveError)
      setError('保存目录失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmDeleteCategory = async () => {
    if (!pendingDeleteCategory) {
      return
    }
    const target = pendingDeleteCategory
    setSaving(true)
    try {
      await deleteArchiveCategory(target.id)
      setNotice('目录已删除')
      setError(null)
      setPendingDeleteCategory(null)
      if (selectedCategoryId === target.id) {
        setSelectedCategoryId(null)
      }
      await refreshCategories()
    } catch (deleteError) {
      console.warn('删除目录失败', deleteError)
      setError('删除目录失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const openCreateArchive = () => {
    const defaultCategory = selectedCategoryId ?? flatCategories[0]?.category.id ?? ''
    if (!defaultCategory) {
      setError('请先创建一个目录')
      return
    }
    setArchiveEditor({
      mode: 'create',
      categoryId: defaultCategory,
      title: '',
      content: '',
      keywords: [],
      aliases: [],
      importance: 'normal',
      source: 'manual',
    })
  }

  const openEditArchive = (archive: Archive) => {
    setArchiveEditor({
      mode: 'edit',
      archiveId: archive.id,
      categoryId: archive.categoryId,
      title: archive.title,
      content: archive.content,
      keywords: archive.keywords,
      aliases: archive.aliases,
      importance: archive.importance,
      source: archive.source,
      updatedAt: archive.updatedAt,
    })
  }

  const handleSubmitArchive = async (event: FormEvent) => {
    event.preventDefault()
    if (!archiveEditor) {
      return
    }
    const title = archiveEditor.title.trim()
    if (!archiveEditor.categoryId) {
      setError('请选择一个目录')
      return
    }
    if (!title) {
      setError('标题不能为空')
      return
    }
    setSaving(true)
    try {
      if (archiveEditor.mode === 'create') {
        await createArchive({
          categoryId: archiveEditor.categoryId,
          title,
          content: archiveEditor.content.trim(),
          keywords: archiveEditor.keywords,
          aliases: archiveEditor.aliases,
          importance: archiveEditor.importance,
          source: archiveEditor.source || 'manual',
        })
        setNotice('档案已创建')
      } else if (archiveEditor.archiveId) {
        await updateArchive(archiveEditor.archiveId, {
          categoryId: archiveEditor.categoryId,
          title,
          content: archiveEditor.content.trim(),
          keywords: archiveEditor.keywords,
          aliases: archiveEditor.aliases,
          importance: archiveEditor.importance,
        })
        setNotice('档案已更新')
      }
      setError(null)
      const targetCategory = archiveEditor.categoryId
      setArchiveEditor(null)
      if (targetCategory !== selectedCategoryId) {
        setSelectedCategoryId(targetCategory)
      } else {
        await refreshArchives(selectedCategoryId)
      }
    } catch (saveError) {
      console.warn('保存档案失败', saveError)
      setError('保存档案失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmDeleteArchive = async () => {
    if (!pendingDeleteArchive) {
      return
    }
    setSaving(true)
    try {
      await softDeleteArchive(pendingDeleteArchive.id)
      setNotice('档案已删除')
      setError(null)
      setPendingDeleteArchive(null)
      setArchiveEditor(null)
      await refreshArchives(selectedCategoryId)
    } catch (deleteError) {
      console.warn('删除档案失败', deleteError)
      setError('删除档案失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const renderCategoryNode = ({ category, depth }: FlatCategory) => {
    const children = childrenMap.get(category.id) ?? []
    const hasChildren = children.length > 0
    const isCollapsed = collapsed.has(category.id)
    // Hide rows whose any ancestor is collapsed.
    let ancestorId = category.parentId
    while (ancestorId) {
      if (collapsed.has(ancestorId)) {
        return null
      }
      ancestorId = categories.find((item) => item.id === ancestorId)?.parentId ?? null
    }

    return (
      <div
        key={category.id}
        className={`archive-tree__row ${selectedCategoryId === category.id ? 'active' : ''}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        <button
          type="button"
          className="archive-tree__caret"
          onClick={() => hasChildren && toggleCollapse(category.id)}
          aria-label={hasChildren ? (isCollapsed ? '展开' : '收起') : undefined}
          disabled={!hasChildren}
        >
          {hasChildren ? (isCollapsed ? '▸' : '▾') : '·'}
        </button>
        <button
          type="button"
          className="archive-tree__name"
          onClick={() => setSelectedCategoryId(category.id)}
        >
          <span className="archive-tree__label">{category.name}</span>
        </button>
        <div className="archive-tree__actions">
          <button
            type="button"
            title="新增子目录"
            onClick={() =>
              setCategoryForm({
                mode: 'create',
                parentId: category.id,
                parentName: category.name,
                name: '',
              })
            }
          >
            ＋
          </button>
          <button
            type="button"
            title="重命名"
            onClick={() => setCategoryForm({ mode: 'rename', categoryId: category.id, name: category.name })}
          >
            ✎
          </button>
          <button
            type="button"
            title="删除目录"
            className="archive-tree__delete"
            onClick={() => setPendingDeleteCategory(category)}
          >
            🗑
          </button>
        </div>
      </div>
    )
  }

  const meta = SCOPE_META[scope]

  return (
    <div className={`archive-page archive-page--${scope}`}>
      <header className="archive-header">
        <button type="button" className="ghost archive-back-btn" onClick={() => navigate(-1)}>
          ← 返回
        </button>
        <div className="archive-title-wrap">
          <p className="archive-kicker">ARCHIVE</p>
          <h1 className="ui-title">系统档案</h1>
        </div>
        <button
          type="button"
          className="archive-refresh-btn"
          onClick={() => void refreshCategories()}
          disabled={loadingCategories}
        >
          刷新
        </button>
      </header>

      <div className="archive-scope-switch" role="tablist" aria-label="档案范围">
        {(Object.keys(SCOPE_META) as ArchiveScope[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={scope === value}
            className={scope === value ? 'active' : ''}
            onClick={() => handleSwitchScope(value)}
          >
            <span aria-hidden="true">{SCOPE_META[value].emoji}</span>
            {SCOPE_META[value].label}
          </button>
        ))}
      </div>

      {notice ? <p className="archive-notice">{notice}</p> : null}
      {error ? <p className="archive-error">{error}</p> : null}

      <section className="archive-panel archive-tree-panel" aria-label="目录树">
        <div className="archive-panel__head">
          <h2>
            {meta.emoji} {meta.label}目录
          </h2>
          <button
            type="button"
            className="archive-mini-btn"
            onClick={() => setCategoryForm({ mode: 'create', parentId: null, parentName: null, name: '' })}
          >
            + 新建目录
          </button>
        </div>
        {loadingCategories ? <p className="archive-empty">加载中…</p> : null}
        {!loadingCategories && categories.length === 0 ? (
          <p className="archive-empty">当前范围还没有目录，点击「新建目录」开始整理吧。</p>
        ) : null}
        <div className="archive-tree">{flatCategories.map(renderCategoryNode)}</div>
      </section>

      <section className="archive-panel archive-list-panel" aria-label="档案条目">
        <div className="archive-panel__head">
          <h2>{selectedCategory ? `📄 ${selectedCategory.name}` : '档案条目'}</h2>
          <button
            type="button"
            className="archive-mini-btn"
            onClick={openCreateArchive}
            disabled={categories.length === 0}
          >
            + 新建条目
          </button>
        </div>

        {selectedCategory ? (
          <input
            className="archive-search"
            type="search"
            value={search}
            placeholder="搜索标题 / 关键词 / 别名 / 正文"
            onChange={(event) => setSearch(event.target.value)}
          />
        ) : null}

        {!selectedCategory ? (
          <p className="archive-empty">请选择左侧目录查看档案。</p>
        ) : loadingArchives ? (
          <p className="archive-empty">加载中…</p>
        ) : filteredArchives.length === 0 ? (
          <p className="archive-empty">{search.trim() ? '没有匹配的档案。' : '该目录下还没有档案条目。'}</p>
        ) : (
          <div className="archive-list">
            {filteredArchives.map((archive) => {
              const isExpanded = expandedArchiveIds.has(archive.id)
              return (
                <article
                  key={archive.id}
                  className={`archive-card ${isExpanded ? 'archive-card--expanded' : ''}`}
                >
                  <button
                    type="button"
                    className="archive-card__toggle"
                    onClick={() => toggleArchiveExpanded(archive.id)}
                    aria-expanded={isExpanded}
                    title={isExpanded ? '收起' : '展开查看全文'}
                  >
                    <div className="archive-card__top">
                      <span className="archive-card__title">{archive.title}</span>
                      <span className={`archive-importance archive-importance--${archive.importance}`}>
                        {IMPORTANCE_META[archive.importance].label}
                      </span>
                      <span className="archive-card__chevron" aria-hidden="true">
                        ▾
                      </span>
                    </div>
                    {!isExpanded ? (
                      <>
                        {archive.content ? (
                          <p className="archive-card__excerpt">{archive.content}</p>
                        ) : null}
                        <div className="archive-card__meta">
                          {archive.keywords.slice(0, 4).map((keyword) => (
                            <span key={keyword} className="archive-card__chip">
                              #{keyword}
                            </span>
                          ))}
                          <time>{formatTime(archive.updatedAt)}</time>
                        </div>
                      </>
                    ) : null}
                  </button>
                  {isExpanded ? (
                    <div className="archive-card__detail">
                      <p
                        className={`archive-card__content ${
                          archive.content ? '' : 'archive-card__content--empty'
                        }`}
                      >
                        {archive.content || '（这条档案还没有正文）'}
                      </p>
                      {archive.keywords.length > 0 || archive.aliases.length > 0 ? (
                        <div className="archive-card__tags">
                          {archive.keywords.map((keyword) => (
                            <span key={`kw-${keyword}`} className="archive-card__chip">
                              #{keyword}
                            </span>
                          ))}
                          {archive.aliases.map((alias) => (
                            <span
                              key={`alias-${alias}`}
                              className="archive-card__chip archive-card__chip--alias"
                            >
                              @{alias}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="archive-card__footer">
                        <span className="archive-card__footinfo">
                          来源：{archive.source || 'manual'} · 更新于 {formatTime(archive.updatedAt)}
                        </span>
                        <div className="archive-card__footactions">
                          <button
                            type="button"
                            className="archive-mini-btn"
                            onClick={() => openEditArchive(archive)}
                          >
                            ✎ 编辑
                          </button>
                          <button
                            type="button"
                            className="archive-mini-btn archive-mini-btn--ghost"
                            onClick={() => toggleArchiveExpanded(archive.id)}
                          >
                            收起 ▴
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Category create / rename modal ── */}
      {categoryForm ? (
        <div className="archive-modal-backdrop" role="dialog" aria-modal="true">
          <form className="archive-modal archive-modal--compact" onSubmit={handleSubmitCategory}>
            <h2>
              {categoryForm.mode === 'create'
                ? categoryForm.parentName
                  ? `在「${categoryForm.parentName}」下新增子目录`
                  : '新建大类目录'
                : '重命名目录'}
            </h2>
            <label>
              目录名称
              <input
                autoFocus
                type="text"
                value={categoryForm.name}
                onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })}
                placeholder="例如：个人历史"
              />
            </label>
            <div className="archive-modal__actions">
              <button type="button" className="secondary" onClick={() => setCategoryForm(null)} disabled={saving}>
                取消
              </button>
              <button type="submit" className="primary" disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* ── Archive editor modal ── */}
      {archiveEditor ? (
        <div className="archive-modal-backdrop" role="dialog" aria-modal="true">
          <form className="archive-modal" onSubmit={handleSubmitArchive}>
            <h2>{archiveEditor.mode === 'create' ? '新建档案' : '编辑档案'}</h2>

            <label>
              所属目录
              <select
                value={archiveEditor.categoryId}
                onChange={(event) => setArchiveEditor({ ...archiveEditor, categoryId: event.target.value })}
                required
              >
                {flatCategories.map(({ category, depth }) => (
                  <option key={category.id} value={category.id}>
                    {`${'　'.repeat(depth)}${category.name}`}
                  </option>
                ))}
              </select>
            </label>

            <label>
              标题
              <input
                type="text"
                value={archiveEditor.title}
                onChange={(event) => setArchiveEditor({ ...archiveEditor, title: event.target.value })}
                placeholder="档案标题"
                required
              />
            </label>

            <label>
              重要性
              <select
                value={archiveEditor.importance}
                onChange={(event) =>
                  setArchiveEditor({ ...archiveEditor, importance: event.target.value as ArchiveImportance })
                }
              >
                {IMPORTANCE_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {IMPORTANCE_META[value].label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              正文
              <textarea
                value={archiveEditor.content}
                onChange={(event) => setArchiveEditor({ ...archiveEditor, content: event.target.value })}
                rows={6}
                placeholder="档案正文内容"
              />
            </label>

            <label>
              关键词
              <TagInput
                values={archiveEditor.keywords}
                onChange={(next) => setArchiveEditor({ ...archiveEditor, keywords: next })}
                placeholder="输入后回车或逗号添加"
              />
            </label>

            <label>
              别名
              <TagInput
                values={archiveEditor.aliases}
                onChange={(next) => setArchiveEditor({ ...archiveEditor, aliases: next })}
                placeholder="输入后回车或逗号添加"
              />
            </label>

            <div className="archive-modal__readonly">
              <span>来源：{archiveEditor.source || 'manual'}</span>
              {archiveEditor.updatedAt ? <span>更新时间：{formatTime(archiveEditor.updatedAt)}</span> : null}
            </div>

            <div className="archive-modal__actions">
              <button type="button" className="secondary" onClick={() => setArchiveEditor(null)} disabled={saving}>
                取消
              </button>
              {archiveEditor.mode === 'edit' && archiveEditor.archiveId ? (
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    const target = archives.find((item) => item.id === archiveEditor.archiveId)
                    if (target) {
                      setPendingDeleteArchive(target)
                    }
                  }}
                  disabled={saving}
                >
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

      <ConfirmDialog
        open={pendingDeleteCategory !== null}
        title="删除目录"
        description={
          pendingDeleteCategory
            ? `确定要删除目录「${pendingDeleteCategory.name}」吗？其下的子目录和档案都会一并删除，且无法恢复。`
            : undefined
        }
        confirmLabel={saving ? '删除中…' : '删除'}
        cancelLabel="取消"
        confirmDisabled={saving}
        cancelDisabled={saving}
        onConfirm={() => void handleConfirmDeleteCategory()}
        onCancel={() => setPendingDeleteCategory(null)}
      />

      <ConfirmDialog
        open={pendingDeleteArchive !== null}
        title="删除档案"
        description={
          pendingDeleteArchive
            ? `确定要删除档案「${pendingDeleteArchive.title}」吗？删除后将不再显示在列表中。`
            : undefined
        }
        confirmLabel={saving ? '删除中…' : '删除'}
        cancelLabel="取消"
        confirmDisabled={saving}
        cancelDisabled={saving}
        onConfirm={() => void handleConfirmDeleteArchive()}
        onCancel={() => setPendingDeleteArchive(null)}
      />
    </div>
  )
}

export default ArchivePage
