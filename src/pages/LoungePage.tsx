import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  createLoungeSofa,
  deleteLoungeSofa,
  fetchLoungeMessageCounts,
  fetchLoungeSofas,
  renameLoungeSofa,
} from '../storage/loungeStorage'
import type { LoungeSofa } from '../types'
import './LoungePage.css'

const formatSofaTime = (sofa: LoungeSofa) => {
  const timestamp = sofa.updatedAt ?? sofa.createdAt
  return new Date(timestamp).toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const LoungePage = () => {
  const navigate = useNavigate()
  const [sofas, setSofas] = useState<LoungeSofa[]>([])
  const [messageCounts, setMessageCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingSofaId, setEditingSofaId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [savingSofaId, setSavingSofaId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<LoungeSofa | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadSofas = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await fetchLoungeSofas()
      setSofas(next)
      try {
        setMessageCounts(await fetchLoungeMessageCounts(next.map((sofa) => sofa.id)))
      } catch (countError) {
        console.warn('加载沙发消息数量失败', countError)
      }
    } catch (loadError) {
      console.warn('加载客厅沙发失败', loadError)
      setError('加载客厅失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSofas()
  }, [loadSofas])

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    const name = newName.trim()
    if (!name || creating) {
      return
    }
    setCreating(true)
    try {
      const sofa = await createLoungeSofa(name)
      setNewName('')
      setShowCreateForm(false)
      navigate(`/lounge/${sofa.id}`)
    } catch (createError) {
      console.warn('新建沙发失败', createError)
      setError('新建沙发失败，请稍后重试。')
    } finally {
      setCreating(false)
    }
  }

  const handleRenameSubmit = async (sofa: LoungeSofa) => {
    const name = editingName.trim()
    if (!name || name === sofa.name) {
      setEditingSofaId(null)
      return
    }
    setSavingSofaId(sofa.id)
    try {
      const updated = await renameLoungeSofa(sofa.id, name)
      setSofas((prev) => prev.map((item) => (item.id === sofa.id ? updated : item)))
      setEditingSofaId(null)
    } catch (renameError) {
      console.warn('重命名沙发失败', renameError)
      setError('重命名失败，请稍后重试。')
    } finally {
      setSavingSofaId(null)
    }
  }

  const handleConfirmDelete = async () => {
    if (!pendingDelete || deleting) {
      return
    }
    setDeleting(true)
    try {
      await deleteLoungeSofa(pendingDelete.id)
      setSofas((prev) => prev.filter((item) => item.id !== pendingDelete.id))
      setPendingDelete(null)
    } catch (deleteError) {
      console.warn('删除沙发失败', deleteError)
      setError('删除失败，请稍后重试。')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="lounge-page">
      <header className="lounge-header">
        <button type="button" className="lounge-back-btn" onClick={() => navigate('/')}>← 返回</button>
        <div className="lounge-title-wrap">
          <p className="lounge-kicker">LOUNGE</p>
          <h1 className="ui-title">仓鼠客厅</h1>
        </div>
        <button
          type="button"
          className="lounge-create-btn"
          onClick={() => setShowCreateForm((prev) => !prev)}
        >
          + 新沙发
        </button>
      </header>

      {error ? <p className="lounge-error">{error}</p> : null}

      {showCreateForm ? (
        <form className="lounge-create-form" onSubmit={handleCreate}>
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="给新沙发起个名字"
            maxLength={40}
            autoFocus
          />
          <button type="submit" disabled={creating || newName.trim().length === 0}>
            {creating ? '创建中…' : '创建'}
          </button>
        </form>
      ) : null}

      <section className="lounge-sofa-list">
        {loading ? <p className="lounge-empty">客厅打扫中…</p> : null}
        {!loading && sofas.length === 0 ? (
          <p className="lounge-empty">客厅里还没有沙发，点右上角搬一张进来吧。</p>
        ) : null}
        {sofas.map((sofa) => (
          <article key={sofa.id} className="lounge-sofa-card">
            {editingSofaId === sofa.id ? (
              <form
                className="lounge-rename-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleRenameSubmit(sofa)
                }}
              >
                <input
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  maxLength={40}
                  autoFocus
                />
                <button type="submit" disabled={savingSofaId === sofa.id}>保存</button>
                <button type="button" onClick={() => setEditingSofaId(null)}>取消</button>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  className="lounge-sofa-main"
                  onClick={() => navigate(`/lounge/${sofa.id}`)}
                >
                  <span className="lounge-sofa-emoji" aria-hidden="true">🛋️</span>
                  <span className="lounge-sofa-info">
                    <strong>{sofa.name}</strong>
                    <span className="lounge-sofa-meta">
                      {messageCounts[sofa.id] ?? 0} 条消息 · {formatSofaTime(sofa)}
                    </span>
                  </span>
                </button>
                <div className="lounge-sofa-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingSofaId(sofa.id)
                      setEditingName(sofa.name)
                    }}
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    className="lounge-danger"
                    onClick={() => setPendingDelete(sofa)}
                  >
                    删除
                  </button>
                </div>
              </>
            )}
          </article>
        ))}
      </section>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除沙发"
        description={
          pendingDelete
            ? `确定要删除「${pendingDelete.name}」吗？沙发上的所有聊天记录会一起被清掉，无法恢复。`
            : undefined
        }
        confirmLabel={deleting ? '删除中…' : '删除'}
        confirmDisabled={deleting}
        cancelDisabled={deleting}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

export default LoungePage
