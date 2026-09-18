import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { StashComment, StashFolder, StashItem, StashStatus } from '../types'
import {
  createStashComment,
  createStashFolder,
  createStashItem,
  deleteStashComment,
  deleteStashFolder,
  deleteStashItem,
  findStashItemByUrlKey,
  listStashComments,
  listStashFolders,
  listStashItems,
  updateStashFolder,
  updateStashItem,
} from '../storage/supabaseSync'
import MarkdownRenderer from '../components/MarkdownRenderer'
import ConfirmDialog from '../components/ConfirmDialog'
import { formatLocalTimestamp } from '../utils/time'
import {
  MAX_STASH_TITLE_LENGTH,
  deriveStashTitleFromUrl,
  normalizeStashUrl,
} from '../../supabase/functions/hamster-knowledge-mcp/stash_contract'
import {
  buildStashBreadcrumb,
  collectStashDescendantIds,
  flattenStashFolderTree,
  getFolderIcon,
  getStashAuthorLabel,
  getStashItemHost,
  getStashStatusLabel,
  matchesStashKeyword,
  parseStashTagsInput,
} from './stashShared'
import './StashPage.css'

// 囤粮处：仓鼠的颊囊。一层一层往里点（Finder 式），每层是「子格子 + 这层的粮食」；
// 根级的粮食就是「待归仓」——东西掉进来时的默认落点，不是一个要去逛的功能区。
// 学习库退休不动；囤粮处不连线、不分类型、不做向量检索。

type StatusFilter = 'all' | StashStatus

type FolderEditorState = {
  mode: 'create' | 'edit'
  folderId?: string
  name: string
  icon: string
  description: string
  parentId: string | null
}

type ItemEditorState = {
  mode: 'create' | 'edit'
  itemId?: string
  title: string
  url: string
  content: string
  tags: string
  folderId: string | null
}

type PendingDelete =
  | { kind: 'folder'; folder: StashFolder }
  | { kind: 'item'; item: StashItem }
  | { kind: 'comment'; comment: StashComment }

const INBOX_KEY = '__inbox__'

const StashPage = () => {
  const navigate = useNavigate()
  const { folderId: routeFolderId } = useParams<{ folderId: string }>()
  const [folders, setFolders] = useState<StashFolder[]>([])
  const [items, setItems] = useState<StashItem[]>([])
  const [comments, setComments] = useState<StashComment[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [folderEditor, setFolderEditor] = useState<FolderEditorState | null>(null)
  const [itemEditor, setItemEditor] = useState<ItemEditorState | null>(null)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [expandedComments, setExpandedComments] = useState<string[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)

  const folderMap = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders])
  const currentFolder = routeFolderId ? folderMap.get(routeFolderId) ?? null : null
  const currentFolderId = currentFolder?.id ?? null
  const routeBroken = Boolean(routeFolderId) && !loading && !currentFolder

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [nextFolders, nextItems] = await Promise.all([listStashFolders(), listStashItems()])
      setFolders(nextFolders)
      setItems(nextItems)
      setError(null)
    } catch (loadError) {
      console.warn('加载囤粮处失败', loadError)
      setError('加载囤粮处失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 换格子时把搜索词与留言展开状态清掉，别把上一层的痕迹带进来。
  useEffect(() => {
    setKeyword('')
    setExpandedComments([])
  }, [currentFolderId])

  const breadcrumb = useMemo(() => buildStashBreadcrumb(folderMap, currentFolderId), [folderMap, currentFolderId])

  const childFolders = useMemo(
    () => folders.filter((folder) => folder.parentId === currentFolderId),
    [folders, currentFolderId],
  )

  // 每个格子的粮食数（不含子格子）：格子卡片上显示「N 条 · 囤着 M」。
  const countsByFolder = useMemo(() => {
    const counts = new Map<string, { total: number; stashed: number }>()
    items.forEach((item) => {
      const key = item.folderId ?? INBOX_KEY
      const current = counts.get(key) ?? { total: 0, stashed: 0 }
      current.total += 1
      if (item.status === 'stashed') current.stashed += 1
      counts.set(key, current)
    })
    return counts
  }, [items])

  // 含子孙格子在内的总数，格子卡片括号里那个数。
  const deepCountsByFolder = useMemo(() => {
    const result = new Map<string, number>()
    folders.forEach((folder) => {
      const descendants = collectStashDescendantIds(folders, folder.id)
      let total = countsByFolder.get(folder.id)?.total ?? 0
      descendants.forEach((id) => {
        total += countsByFolder.get(id)?.total ?? 0
      })
      result.set(folder.id, total)
    })
    return result
  }, [folders, countsByFolder])

  const searching = keyword.trim().length > 0

  const visibleItems = useMemo(() => {
    const scoped = searching ? items : items.filter((item) => item.folderId === currentFolderId)
    return scoped.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false
      return searching ? matchesStashKeyword(item, keyword) : true
    })
  }, [items, currentFolderId, searching, keyword, statusFilter])

  const totals = useMemo(() => {
    const stashed = items.filter((item) => item.status === 'stashed').length
    return { total: items.length, stashed, eaten: items.length - stashed, inbox: countsByFolder.get(INBOX_KEY)?.total ?? 0 }
  }, [items, countsByFolder])

  const commentsByItem = useMemo(() => {
    const groups = new Map<string, StashComment[]>()
    comments.forEach((comment) => {
      const current = groups.get(comment.itemId) ?? []
      current.push(comment)
      groups.set(comment.itemId, current)
    })
    return groups
  }, [comments])

  // 留言只为当前可见的粮食拉，可见集合变了就重拉。
  const visibleItemIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems])
  const visibleItemKey = visibleItemIds.join(',')
  useEffect(() => {
    let cancelled = false
    if (visibleItemIds.length === 0) {
      setComments([])
      return () => {
        cancelled = true
      }
    }
    listStashComments(visibleItemIds)
      .then((next) => {
        if (!cancelled) setComments(next)
      })
      .catch((loadError) => {
        console.warn('加载留言失败', loadError)
      })
    return () => {
      cancelled = true
    }
    // visibleItemKey 是 visibleItemIds 的稳定串，避免数组引用变化导致重复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItemKey])

  const reloadComments = useCallback(async () => {
    setComments(await listStashComments(visibleItemIds))
  }, [visibleItemIds])

  const folderOptions = useMemo(() => flattenStashFolderTree(folders), [folders])

  const folderPathLabel = (folderId: string | null) => {
    if (!folderId) return '待归仓'
    const trail = buildStashBreadcrumb(folderMap, folderId)
    return trail.map((folder) => folder.name).join(' › ') || '待归仓'
  }

  // ── 格子编辑 ──────────────────────────────────────────────────────────────

  const openFolderCreate = () => {
    setEditorError(null)
    setFolderEditor({ mode: 'create', name: '', icon: '', description: '', parentId: currentFolderId })
  }

  const openFolderEdit = (folder: StashFolder) => {
    setEditorError(null)
    setFolderEditor({
      mode: 'edit',
      folderId: folder.id,
      name: folder.name,
      icon: folder.icon ?? '',
      description: folder.description ?? '',
      parentId: folder.parentId,
    })
  }

  const saveFolder = async (event: FormEvent) => {
    event.preventDefault()
    if (!folderEditor || saving) return
    const name = folderEditor.name.replace(/\s+/gu, ' ').trim()
    if (!name) {
      setEditorError('格子总得有个名字')
      return
    }
    const icon = folderEditor.icon.trim() || null
    if (icon && icon.length > 8) {
      setEditorError('图标只放一个 emoji')
      return
    }
    setSaving(true)
    try {
      if (folderEditor.mode === 'create') {
        await createStashFolder({ name, icon, description: folderEditor.description.trim() || null, parentId: folderEditor.parentId })
        setNotice(`格子「${name}」建好了`)
      } else if (folderEditor.folderId) {
        await updateStashFolder(folderEditor.folderId, {
          name,
          icon,
          description: folderEditor.description.trim() || null,
          parentId: folderEditor.parentId,
        })
        setNotice(`格子「${name}」已更新`)
      }
      setFolderEditor(null)
      setError(null)
      await refresh()
    } catch (saveError) {
      console.warn('保存格子失败', saveError)
      setEditorError(saveError instanceof Error ? saveError.message : '保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  // ── 粮食编辑 ──────────────────────────────────────────────────────────────

  const openItemCreate = () => {
    setEditorError(null)
    setItemEditor({ mode: 'create', title: '', url: '', content: '', tags: '', folderId: currentFolderId })
  }

  const openItemEdit = (item: StashItem) => {
    setEditorError(null)
    setItemEditor({
      mode: 'edit',
      itemId: item.id,
      title: item.title,
      url: item.url ?? '',
      content: item.content ?? '',
      tags: item.tags.join(', '),
      folderId: item.folderId,
    })
  }

  const saveItem = async (event: FormEvent) => {
    event.preventDefault()
    if (!itemEditor || saving) return
    let url: string | null = null
    let urlKey: string | null = null
    if (itemEditor.url.trim()) {
      const normalized = normalizeStashUrl(itemEditor.url)
      if (!normalized.ok) {
        setEditorError(normalized.error)
        return
      }
      url = normalized.url
      urlKey = normalized.url_key
    }
    const content = itemEditor.content.replace(/\r\n?/gu, '\n').trim() || null
    if (!url && !content) {
      setEditorError('链接和正文至少要有一样')
      return
    }
    let title = itemEditor.title.replace(/\s+/gu, ' ').trim()
    if (!title && url) title = deriveStashTitleFromUrl(url)
    if (!title) {
      setEditorError('没有链接时得写个标题')
      return
    }
    if (title.length > MAX_STASH_TITLE_LENGTH) {
      setEditorError(`标题超过 ${MAX_STASH_TITLE_LENGTH} 字上限`)
      return
    }
    const tags = parseStashTagsInput(itemEditor.tags)
    setSaving(true)
    try {
      if (urlKey) {
        const existing = await findStashItemByUrlKey(urlKey)
        if (existing && existing.id !== itemEditor.itemId) {
          setEditorError(`这条链接早囤过了：「${existing.title}」（在 ${folderPathLabel(existing.folderId)}）`)
          return
        }
      }
      if (itemEditor.mode === 'create') {
        await createStashItem({ folderId: itemEditor.folderId, title, url, urlKey, content, tags })
        setNotice(itemEditor.folderId ? `「${title}」囤进格子了` : `「${title}」先放待归仓`)
      } else if (itemEditor.itemId) {
        await updateStashItem(itemEditor.itemId, { folderId: itemEditor.folderId, title, url, urlKey, content, tags })
        setNotice(`「${title}」已更新`)
      }
      setItemEditor(null)
      setError(null)
      await refresh()
    } catch (saveError) {
      console.warn('保存粮食失败', saveError)
      setEditorError(saveError instanceof Error ? saveError.message : '保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const toggleEaten = async (item: StashItem) => {
    if (saving) return
    setSaving(true)
    try {
      const nextStatus: StashStatus = item.status === 'eaten' ? 'stashed' : 'eaten'
      await updateStashItem(item.id, { status: nextStatus })
      setNotice(nextStatus === 'eaten' ? `「${item.title}」吃掉了` : `「${item.title}」囤回去了`)
      setError(null)
      await refresh()
    } catch (toggleError) {
      console.warn('更新状态失败', toggleError)
      setError('更新状态失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const moveItem = async (item: StashItem, targetFolderId: string | null) => {
    if (saving || targetFolderId === item.folderId) return
    setSaving(true)
    try {
      await updateStashItem(item.id, { folderId: targetFolderId })
      setNotice(`「${item.title}」挪到 ${folderPathLabel(targetFolderId)}`)
      setError(null)
      await refresh()
    } catch (moveError) {
      console.warn('挪格子失败', moveError)
      setError('挪格子失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  // ── 留言 ──────────────────────────────────────────────────────────────────

  const toggleComments = (itemId: string) => {
    setExpandedComments((current) => (current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]))
  }

  const submitComment = async (event: FormEvent, itemId: string) => {
    event.preventDefault()
    const content = (drafts[itemId] ?? '').trim()
    if (!content || saving) return
    setSaving(true)
    try {
      await createStashComment(itemId, content)
      setDrafts((current) => ({ ...current, [itemId]: '' }))
      setNotice('留言已写下，Syzygy 读囤粮处时会看到。')
      setError(null)
      await reloadComments()
    } catch (saveError) {
      console.warn('留言失败', saveError)
      setError('留言失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  // ── 删除 ──────────────────────────────────────────────────────────────────

  const confirmDelete = async () => {
    if (!pendingDelete || saving) return
    setSaving(true)
    try {
      if (pendingDelete.kind === 'folder') {
        await deleteStashFolder(pendingDelete.folder.id)
        setNotice(`格子「${pendingDelete.folder.name}」已拆掉，里面的东西升了一级`)
      } else if (pendingDelete.kind === 'item') {
        await deleteStashItem(pendingDelete.item.id)
        setNotice(`「${pendingDelete.item.title}」已丢掉`)
      } else {
        await deleteStashComment(pendingDelete.comment.id)
        setNotice('留言已删除')
      }
      setPendingDelete(null)
      setError(null)
      if (pendingDelete.kind === 'comment') {
        await reloadComments()
      } else {
        await refresh()
      }
    } catch (deleteError) {
      console.warn('删除失败', deleteError)
      setError('删除失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const deleteDialogProps = (() => {
    if (!pendingDelete) return { title: '', description: undefined as string | undefined, confirmLabel: '删除' }
    if (pendingDelete.kind === 'folder') {
      const own = countsByFolder.get(pendingDelete.folder.id)?.total ?? 0
      const subfolders = folders.filter((folder) => folder.parentId === pendingDelete.folder.id).length
      return {
        title: `拆掉格子「${pendingDelete.folder.name}」？`,
        description: `里面的 ${own} 条粮食和 ${subfolders} 个子格子都会升到上一级，一条都不会丢。`,
        confirmLabel: '拆掉格子',
      }
    }
    if (pendingDelete.kind === 'item') {
      return {
        title: `丢掉「${pendingDelete.item.title}」？`,
        description: '这条粮食和它下面的留言会被彻底删除，无法恢复。',
        confirmLabel: '彻底删除',
      }
    }
    const text = pendingDelete.comment.content
    return {
      title: '删除这条留言？',
      description: `「${text.slice(0, 40)}${text.length > 40 ? '…' : ''}」将被彻底删除，无法恢复。`,
      confirmLabel: '彻底删除',
    }
  })()

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  const renderFolderSelect = (value: string | null, onChange: (next: string | null) => void, excludeSubtreeOf?: string) => {
    const excluded = excludeSubtreeOf ? collectStashDescendantIds(folders, excludeSubtreeOf) : new Set<string>()
    if (excludeSubtreeOf) excluded.add(excludeSubtreeOf)
    return (
      <select value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">📥 待归仓（根级）</option>
        {folderOptions
          .filter(({ folder }) => !excluded.has(folder.id))
          .map(({ folder, depth }) => (
            <option key={folder.id} value={folder.id}>
              {`${'　'.repeat(depth)}${getFolderIcon(folder)} ${folder.name}`}
            </option>
          ))}
      </select>
    )
  }

  const renderComments = (item: StashItem) => {
    const list = commentsByItem.get(item.id) ?? []
    const draft = drafts[item.id] ?? ''
    return (
      <section className="stash-comments" aria-label="留言">
        {list.map((comment) => (
          <div key={comment.id} className="stash-comment">
            <div className="stash-comment__head">
              <span className="stash-chip stash-chip--author">{getStashAuthorLabel(comment.author)}</span>
              <time dateTime={comment.createdAt}>{formatLocalTimestamp(comment.createdAt)}</time>
              {comment.author === 'chuanchuan' ? (
                <button type="button" className="stash-link-btn" onClick={() => setPendingDelete({ kind: 'comment', comment })} disabled={saving}>
                  删除
                </button>
              ) : null}
            </div>
            <p className="stash-comment__content">{comment.content}</p>
          </div>
        ))}
        <form className="stash-comment-form" onSubmit={(event) => void submitComment(event, item.id)}>
          <textarea
            rows={2}
            value={draft}
            onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
            placeholder="留一句：为什么囤、看完怎么样、想让 Syzygy 帮忙做什么。"
          />
          <button type="submit" className="stash-inline-btn stash-inline-btn--accent" disabled={saving || !draft.trim()}>
            留言
          </button>
        </form>
      </section>
    )
  }

  const renderItem = (item: StashItem) => {
    const host = getStashItemHost(item)
    const eaten = item.status === 'eaten'
    const commentCount = commentsByItem.get(item.id)?.length ?? 0
    const commentsOpen = expandedComments.includes(item.id)
    return (
      <article key={item.id} className={eaten ? 'stash-item stash-item--eaten' : 'stash-item'}>
        <header className="stash-item__head">
          <span className="stash-item__avatar" aria-hidden="true">
            {item.url ? '🔗' : '📝'}
          </span>
          <div className="stash-item__title-wrap">
            {item.url ? (
              <a className="stash-item__title" href={item.url} target="_blank" rel="noopener noreferrer">
                {item.title}
              </a>
            ) : (
              <h3 className="stash-item__title">{item.title}</h3>
            )}
            <div className="stash-item__meta">
              {host ? <span className="stash-chip stash-chip--host">{host}</span> : null}
              <span className="stash-chip stash-chip--author">{getStashAuthorLabel(item.addedBy)}</span>
              <span className={eaten ? 'stash-chip stash-chip--eaten' : 'stash-chip'}>{getStashStatusLabel(item.status)}</span>
              {searching ? <span className="stash-chip stash-chip--path">{folderPathLabel(item.folderId)}</span> : null}
            </div>
          </div>
          <time className="stash-item__clock" dateTime={item.createdAt}>
            {formatLocalTimestamp(item.createdAt).slice(0, 10)}
          </time>
        </header>
        {item.content ? (
          <div className="stash-item__content">
            <MarkdownRenderer content={item.content} />
          </div>
        ) : null}
        {item.tags.length > 0 ? (
          <div className="stash-item__tags">
            {item.tags.map((tag) => (
              <span key={tag} className="stash-tag">
                #{tag}
              </span>
            ))}
          </div>
        ) : null}
        <footer className="stash-item__foot">
          <button type="button" className="stash-inline-btn" onClick={() => void toggleEaten(item)} disabled={saving}>
            {eaten ? '囤回去' : '吃掉'}
          </button>
          <label className="stash-move">
            <span>挪到</span>
            {renderFolderSelect(item.folderId, (next) => void moveItem(item, next))}
          </label>
          <button type="button" className="stash-inline-btn" onClick={() => openItemEdit(item)} disabled={saving}>
            编辑
          </button>
          <button type="button" className="stash-inline-btn" onClick={() => toggleComments(item.id)}>
            留言{commentCount > 0 ? ` · ${commentCount}` : ''}
          </button>
          <button type="button" className="stash-link-btn stash-link-btn--danger" onClick={() => setPendingDelete({ kind: 'item', item })} disabled={saving}>
            丢掉
          </button>
        </footer>
        {commentsOpen ? renderComments(item) : null}
      </article>
    )
  }

  const headerTitle = currentFolder ? `${getFolderIcon(currentFolder)} ${currentFolder.name}` : '囤粮处'
  const backTarget = currentFolder ? (currentFolder.parentId ? `/stash/${currentFolder.parentId}` : '/stash') : '/'
  const itemsSectionTitle = searching ? '搜索结果' : currentFolder ? '这格里的粮食' : '待归仓'

  return (
    <div className="stash-page">
      <header className="stash-header">
        <button type="button" className="ghost stash-header-btn stash-header-btn--left" onClick={() => navigate(backTarget)}>
          {currentFolder ? '← 上一级' : '← 返回'}
        </button>
        <div className="stash-title-wrap">
          <p className="stash-kicker">Hamster Stash</p>
          <h1 className="ui-title stash-title">{headerTitle}</h1>
        </div>
        <button type="button" className="stash-create-btn" onClick={openItemCreate} disabled={loading || routeBroken}>
          + 囤一条
        </button>
      </header>

      {!currentFolder && !routeBroken ? (
        <section className="stash-intro-card" aria-label="囤粮处说明">
          <div className="stash-intro-dot" aria-hidden="true" />
          <div className="stash-intro-top">
            <strong>
              仓鼠的颊囊
              <span className="stash-count">
                {loading ? '统计中…' : `共 ${totals.total} 条 · 囤着 ${totals.stashed} · 吃掉 ${totals.eaten} · 待归仓 ${totals.inbox}`}
              </span>
            </strong>
            <p className="stash-intro-hint">
              看到想留的仓库、想读的书、想看的电影、想去的地方，先塞进来再说。格子一层一层往里点；拿不准放哪就丢在这一页的待归仓，改天再挪。读过看过用过了，点「吃掉」。Syzygy 冲浪看到的也会囤到这里，署它的名。
            </p>
          </div>
        </section>
      ) : null}

      {currentFolder ? (
        <nav className="stash-breadcrumb" aria-label="路径">
          <button type="button" className="stash-breadcrumb__link" onClick={() => navigate('/stash')}>
            🐹 囤粮处
          </button>
          {breadcrumb.map((folder, index) => {
            const last = index === breadcrumb.length - 1
            return (
              <span key={folder.id} className="stash-breadcrumb__seg">
                <span className="stash-breadcrumb__sep" aria-hidden="true">
                  ›
                </span>
                {last ? (
                  <span className="stash-breadcrumb__current">
                    {getFolderIcon(folder)} {folder.name}
                  </span>
                ) : (
                  <button type="button" className="stash-breadcrumb__link" onClick={() => navigate(`/stash/${folder.id}`)}>
                    {getFolderIcon(folder)} {folder.name}
                  </button>
                )}
              </span>
            )
          })}
        </nav>
      ) : null}

      {currentFolder?.description ? <p className="stash-folder-desc">{currentFolder.description}</p> : null}

      {notice ? <p className="stash-notice">{notice}</p> : null}
      {error ? <p className="stash-error">{error}</p> : null}
      {loading ? <p className="tips">加载中…</p> : null}
      {routeBroken ? <p className="stash-empty">这个格子不存在（可能已经拆掉了），回囤粮处首页重新找。</p> : null}

      {!loading && !routeBroken ? (
        <>
          <section className="stash-toolbar" aria-label="搜索与筛选">
            <input
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜全部粮食：标题 / 正文 / 链接 / 标签"
              autoComplete="off"
              enterKeyHint="search"
              aria-label="搜索粮食"
            />
            <div className="stash-chip-list">
              {(
                [
                  ['all', '全部'],
                  ['stashed', '囤着'],
                  ['eaten', '吃掉了'],
                ] as Array<[StatusFilter, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={statusFilter === value ? 'stash-filter-chip selected' : 'stash-filter-chip'}
                  onClick={() => setStatusFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {!searching ? (
            <section className="stash-folders" aria-label="格子">
              <div className="stash-section__top">
                <strong>格子 · {childFolders.length}</strong>
                <button type="button" className="stash-inline-btn stash-inline-btn--accent" onClick={openFolderCreate} disabled={saving}>
                  + 新格子
                </button>
              </div>
              {childFolders.length === 0 ? (
                <p className="stash-section__empty">
                  {currentFolder ? '这格里还没有子格子。' : '还没有格子。先建一个，比如「GitHub 可学习仓库」「想读的书」「想去的地方」。'}
                </p>
              ) : (
                <div className="stash-folder-grid">
                  {childFolders.map((folder) => {
                    const own = countsByFolder.get(folder.id) ?? { total: 0, stashed: 0 }
                    const deep = deepCountsByFolder.get(folder.id) ?? own.total
                    return (
                      <div key={folder.id} className="stash-folder-card">
                        <button type="button" className="stash-folder-card__main" onClick={() => navigate(`/stash/${folder.id}`)}>
                          <span className="stash-folder-card__icon" aria-hidden="true">
                            {getFolderIcon(folder)}
                          </span>
                          <span className="stash-folder-card__name">{folder.name}</span>
                          <span className="stash-folder-card__count">
                            {own.total} 条{deep !== own.total ? `（连子格子 ${deep}）` : ''} · 囤着 {own.stashed}
                          </span>
                        </button>
                        <button type="button" className="stash-folder-card__edit" onClick={() => openFolderEdit(folder)} aria-label={`编辑格子 ${folder.name}`}>
                          ⋯
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          ) : null}

          <section className="stash-items" aria-label="粮食">
            <div className="stash-section__top">
              <strong>
                {itemsSectionTitle} · {visibleItems.length}
              </strong>
              {!currentFolder && !searching ? <span className="stash-section__hint">拿不准放哪的先放这里</span> : null}
            </div>
            {visibleItems.length === 0 ? (
              <p className="stash-section__empty">
                {searching ? '没搜到。' : statusFilter !== 'all' ? '这个状态下没有粮食。' : currentFolder ? '这格里还是空的，点右上角「囤一条」。' : '待归仓是空的，很好。'}
              </p>
            ) : (
              <div className="stash-item-list">{visibleItems.map(renderItem)}</div>
            )}
          </section>
        </>
      ) : null}

      {folderEditor ? (
        <div className="stash-editor-backdrop" role="dialog" aria-modal="true" aria-label="格子编辑">
          <form className="stash-editor" onSubmit={saveFolder}>
            <h2>{folderEditor.mode === 'create' ? '新格子' : '编辑格子'}</h2>
            <div className="stash-editor__row">
              <label className="stash-editor__icon">
                图标
                <input
                  type="text"
                  value={folderEditor.icon}
                  onChange={(event) => setFolderEditor({ ...folderEditor, icon: event.target.value })}
                  placeholder="📁"
                  maxLength={8}
                />
              </label>
              <label>
                名称
                <input
                  type="text"
                  value={folderEditor.name}
                  onChange={(event) => setFolderEditor({ ...folderEditor, name: event.target.value })}
                  placeholder="如「GitHub 可学习仓库」"
                  maxLength={60}
                  required
                />
              </label>
            </div>
            <label>
              说明（可空）
              <textarea
                rows={2}
                value={folderEditor.description}
                onChange={(event) => setFolderEditor({ ...folderEditor, description: event.target.value })}
                placeholder="这格放什么"
              />
            </label>
            <label>
              放在
              {renderFolderSelect(folderEditor.parentId, (next) => setFolderEditor({ ...folderEditor, parentId: next }), folderEditor.folderId)}
            </label>
            {editorError ? <p className="stash-editor__error">{editorError}</p> : null}
            <div className="stash-editor__actions">
              {folderEditor.mode === 'edit' && folderEditor.folderId ? (
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    const folder = folderMap.get(folderEditor.folderId as string)
                    if (folder) {
                      setFolderEditor(null)
                      setPendingDelete({ kind: 'folder', folder })
                    }
                  }}
                  disabled={saving}
                >
                  拆掉格子
                </button>
              ) : null}
              <button type="button" className="secondary" onClick={() => setFolderEditor(null)} disabled={saving}>
                取消
              </button>
              <button type="submit" className="primary" disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {itemEditor ? (
        <div className="stash-editor-backdrop" role="dialog" aria-modal="true" aria-label="粮食编辑">
          <form className="stash-editor" onSubmit={saveItem}>
            <h2>{itemEditor.mode === 'create' ? '囤一条' : '编辑这条'}</h2>
            <label>
              链接（可空）
              <input
                type="url"
                inputMode="url"
                value={itemEditor.url}
                onChange={(event) => setItemEditor({ ...itemEditor, url: event.target.value })}
                placeholder="https://… 粘贴就行，追踪参数会自动去掉"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>
            <label>
              标题
              <input
                type="text"
                value={itemEditor.title}
                onChange={(event) => setItemEditor({ ...itemEditor, title: event.target.value })}
                placeholder="有链接可以不写，会从链接凑一个"
                maxLength={MAX_STASH_TITLE_LENGTH}
              />
            </label>
            <label>
              正文（Markdown，可空）
              <textarea
                rows={5}
                value={itemEditor.content}
                onChange={(event) => setItemEditor({ ...itemEditor, content: event.target.value })}
                placeholder="摘一段、写两句为什么囤，或者没链接时把内容整个贴进来"
              />
            </label>
            <div className="stash-editor__row">
              <label>
                标签（逗号分隔，可空）
                <input
                  type="text"
                  value={itemEditor.tags}
                  onChange={(event) => setItemEditor({ ...itemEditor, tags: event.target.value })}
                  placeholder="agent, ui"
                />
              </label>
              <label>
                放在
                {renderFolderSelect(itemEditor.folderId, (next) => setItemEditor({ ...itemEditor, folderId: next }))}
              </label>
            </div>
            {editorError ? <p className="stash-editor__error">{editorError}</p> : null}
            <div className="stash-editor__actions">
              <button type="button" className="secondary" onClick={() => setItemEditor(null)} disabled={saving}>
                取消
              </button>
              <button type="submit" className="primary" disabled={saving}>
                {saving ? '保存中…' : itemEditor.mode === 'create' ? '囤起来' : '保存'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={deleteDialogProps.title}
        description={deleteDialogProps.description}
        confirmLabel={deleteDialogProps.confirmLabel}
        confirmDisabled={saving}
        cancelDisabled={saving}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

export default StashPage
