import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  createRpSession,
  deleteRpSession,
  fetchRpMessageCounts,
  fetchRpSessions,
  renameRpSession,
  updateRpSessionArchiveState,
  updateRpSessionTileColor,
} from '../storage/supabaseSync'
import type { RpSession } from '../types'
import './RpRoomsPage.css'

type RpRoomsPageProps = {
  user: User | null
}

type ArchiveAction = {
  sessionId: string
  nextArchived: boolean
  title: string
}

type DeleteAction = {
  sessionId: string
}

const TILE_COLOR_PALETTE = [
  '#F88FA4', '#F9A49A', '#F6B58A', '#F4C39A',
  '#F3C2CC', '#E9BEDA', '#DAB9F2', '#C7C0F6',
  '#BFD0F8', '#B7DEE8', '#BFD9C8', '#CFD4DF',
  '#B8BECF', '#D9CED8', '#A4A9B8', '#8A90A1',
]

const COLOR_POPOVER_WIDTH = 138
const COLOR_POPOVER_HEIGHT = 138
const COLOR_POPOVER_GAP = 8
const VIEWPORT_MARGIN = 8

const resolveRoomTileColor = (room: RpSession) => {
  const color = room.tileColor?.trim()
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
    return color
  }
  const hash = Array.from(room.id).reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return TILE_COLOR_PALETTE[hash % TILE_COLOR_PALETTE.length]
}

const formatRoomTime = (session: RpSession) => {
  const timestamp = session.updatedAt ?? session.createdAt
  return new Date(timestamp).toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const RpRoomsPage = ({ user }: RpRoomsPageProps) => {
  const navigate = useNavigate()
  const [rooms, setRooms] = useState<RpSession[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [tab, setTab] = useState<'active' | 'archived'>('active')
  const [pendingArchive, setPendingArchive] = useState<ArchiveAction | null>(null)
  const [updatingArchive, setUpdatingArchive] = useState(false)
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [savingRoomId, setSavingRoomId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DeleteAction | null>(null)
  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null)
  const [roomMessageCounts, setRoomMessageCounts] = useState<Record<string, number>>({})
  const [countsLoading, setCountsLoading] = useState(false)
  const [openPaletteRoomId, setOpenPaletteRoomId] = useState<string | null>(null)
  const [openActionsRoomId, setOpenActionsRoomId] = useState<string | null>(null)
  const [palettePosition, setPalettePosition] = useState<{ top: number; left: number } | null>(null)
  const paletteTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const isArchivedView = tab === 'archived'
  const isMutating = Boolean(savingRoomId || deletingRoomId || updatingArchive)

  const loadRooms = useCallback(async () => {
    if (!user) {
      return
    }
    setLoading(true)
    setError(null)
    try {
      const next = await fetchRpSessions(user.id, isArchivedView)
      setRooms(next)
    } catch (loadError) {
      console.warn('加载 RP 房间失败', loadError)
      setError('加载房间失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }, [isArchivedView, user])

  useEffect(() => {
    void loadRooms()
  }, [loadRooms])

  useEffect(() => {
    if (!user || rooms.length === 0) {
      setRoomMessageCounts({})
      setCountsLoading(false)
      return
    }

    let canceled = false
    const roomIds = rooms.map((room) => room.id)

    const loadMessageCounts = async () => {
      setCountsLoading(true)
      try {
        const counts = await fetchRpMessageCounts(user.id, roomIds)
        if (!canceled) {
          setRoomMessageCounts(counts)
        }
      } catch (countError) {
        console.warn('加载 RP 房间消息数量失败', countError)
        if (!canceled) {
          setRoomMessageCounts({})
        }
      } finally {
        if (!canceled) {
          setCountsLoading(false)
        }
      }
    }

    void loadMessageCounts()

    return () => {
      canceled = true
    }
  }, [rooms, user])

  useEffect(() => {
    const closeMenus = () => {
      setOpenPaletteRoomId(null)
      setOpenActionsRoomId(null)
    }
    document.addEventListener('click', closeMenus)
    return () => document.removeEventListener('click', closeMenus)
  }, [])

  useEffect(() => {
    if (!openPaletteRoomId) {
      setPalettePosition(null)
      return
    }

    const updatePalettePosition = () => {
      const trigger = paletteTriggerRefs.current[openPaletteRoomId]
      if (!trigger) {
        setPalettePosition(null)
        return
      }

      const triggerRect = trigger.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      let left = triggerRect.right - COLOR_POPOVER_WIDTH
      left = Math.max(VIEWPORT_MARGIN, Math.min(left, viewportWidth - COLOR_POPOVER_WIDTH - VIEWPORT_MARGIN))

      let top = triggerRect.bottom + COLOR_POPOVER_GAP
      const wouldOverflowBottom = top + COLOR_POPOVER_HEIGHT > viewportHeight - VIEWPORT_MARGIN
      if (wouldOverflowBottom) {
        top = triggerRect.top - COLOR_POPOVER_HEIGHT - COLOR_POPOVER_GAP
      }
      top = Math.max(VIEWPORT_MARGIN, Math.min(top, viewportHeight - COLOR_POPOVER_HEIGHT - VIEWPORT_MARGIN))

      setPalettePosition({ top, left })
    }

    updatePalettePosition()
    window.addEventListener('resize', updatePalettePosition)
    window.addEventListener('scroll', updatePalettePosition, true)

    return () => {
      window.removeEventListener('resize', updatePalettePosition)
      window.removeEventListener('scroll', updatePalettePosition, true)
    }
  }, [openPaletteRoomId])

  const handleCreateRoom = async () => {
    if (!user || creating) {
      return
    }
    setCreating(true)
    setError(null)
    setNotice(null)
    try {
      const title = newTitle.trim().length > 0 ? newTitle.trim() : '新房间'
      const room = await createRpSession(user.id, title)
      setNotice('房间创建成功')
      setNewTitle('')
      navigate(`/rp/${room.id}`)
    } catch (createError) {
      console.warn('创建 RP 房间失败', createError)
      setError('创建房间失败，请稍后重试。')
    } finally {
      setCreating(false)
    }
  }

  const handleTileColorSelect = async (roomId: string, color: string) => {
    setRooms((current) => current.map((room) => (room.id === roomId ? { ...room, tileColor: color } : room)))
    setOpenPaletteRoomId(null)
    try {
      await updateRpSessionTileColor(roomId, color)
    } catch (updateError) {
      console.warn('更新 RP 房间颜色失败', updateError)
      setNotice('颜色已本地更新，云端保存失败。')
    }
  }

  const handleToggleArchive = async () => {
    if (!pendingArchive || updatingArchive) {
      return
    }
    setUpdatingArchive(true)
    setError(null)
    setNotice(null)
    try {
      await updateRpSessionArchiveState(pendingArchive.sessionId, pendingArchive.nextArchived)
      setNotice(pendingArchive.nextArchived ? '已归档房间' : '已取消归档')
      setRooms((current) => current.filter((room) => room.id !== pendingArchive.sessionId))
      setPendingArchive(null)
    } catch (updateError) {
      console.warn('更新 RP 房间归档状态失败', updateError)
      setError('更新归档状态失败，请稍后重试。')
    } finally {
      setUpdatingArchive(false)
    }
  }

  const startRename = (room: RpSession) => {
    if (isMutating) {
      return
    }
    setEditingRoomId(room.id)
    setEditingTitle(room.title ?? '')
    setError(null)
    setNotice(null)
    setOpenActionsRoomId(null)
  }

  const cancelRename = () => {
    if (savingRoomId) {
      return
    }
    setEditingRoomId(null)
    setEditingTitle('')
  }

  const handleRenameRoom = async (roomId: string) => {
    if (!user || isMutating) {
      return
    }
    setSavingRoomId(roomId)
    setError(null)
    setNotice(null)
    try {
      const title = editingTitle.trim().length > 0 ? editingTitle.trim() : '新房间'
      const updatedRoom = await renameRpSession(roomId, title)
      setRooms((current) => current.map((room) => (room.id === roomId ? updatedRoom : room)))
      setNotice('房间名称已更新')
      setEditingRoomId(null)
      setEditingTitle('')
    } catch (renameError) {
      console.warn('更新 RP 房间名称失败', renameError)
      setError('更新房间名称失败，请稍后重试。')
    } finally {
      setSavingRoomId(null)
    }
  }

  const handleDeleteRoom = async () => {
    if (!pendingDelete || isMutating) {
      return
    }
    setDeletingRoomId(pendingDelete.sessionId)
    setError(null)
    setNotice(null)
    try {
      await deleteRpSession(pendingDelete.sessionId)
      setNotice('房间已删除')
      setPendingDelete(null)
      setEditingRoomId((current) => (current === pendingDelete.sessionId ? null : current))
      if (editingRoomId === pendingDelete.sessionId) {
        setEditingTitle('')
      }
      await loadRooms()
    } catch (deleteError) {
      console.warn('删除 RP 房间失败', deleteError)
      setError('删除房间失败，请稍后重试。')
    } finally {
      setDeletingRoomId(null)
    }
  }

  const tabTitle = useMemo(() => (isArchivedView ? '已归档房间' : '活跃房间'), [isArchivedView])

  return (
    <div className="rp-rooms-page">
      <header className="rp-rooms-header glass-panel">
        <div>
          <h1 className="ui-title">跑跑滚轮区</h1>
          <p>管理 RP 房间，用颜色区分剧情分线与角色组。</p>
        </div>
        <button type="button" className="ghost" onClick={() => navigate('/')}>
          返回聊天
        </button>
      </header>

      <section className="rp-create-card glass-card">
        <h2 className="ui-title">新建房间</h2>
        <div className="rp-create-row">
          <input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            placeholder="输入房间标题（可留空）"
            maxLength={80}
          />
          <button type="button" className="btn-primary" disabled={creating} onClick={handleCreateRoom}>
            {creating ? '创建中…' : '新建房间'}
          </button>
        </div>
      </section>

      <section className="rp-list-card glass-panel">
        <div className="rp-list-head">
          <div className="rp-tabs" role="tablist" aria-label="房间筛选">
            <button
              type="button"
              className={!isArchivedView ? 'active' : ''}
              onClick={() => setTab('active')}
            >
              活跃
            </button>
            <button
              type="button"
              className={isArchivedView ? 'active' : ''}
              onClick={() => setTab('archived')}
            >
              已归档
            </button>
          </div>
          <button type="button" className="ghost" onClick={() => void loadRooms()} disabled={loading || isMutating}>
            刷新
          </button>
        </div>

        {notice ? <p className="tips">{notice}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        <h2 className="ui-title">{tabTitle}</h2>
        {loading ? <p className="tips">加载中…</p> : null}
        {!loading && rooms.length === 0 ? (
          <p className="tips">{isArchivedView ? '还没有归档房间。' : '还没有房间，先新建一个吧。'}</p>
        ) : null}

        <ul className="rp-room-grid">
          {rooms.map((room) => {
            const isRenaming = editingRoomId === room.id
            const isSaving = savingRoomId === room.id
            const isDeleting = deletingRoomId === room.id
            const isBusy = isMutating || isSaving || isDeleting
            const tileColor = resolveRoomTileColor(room)

            return (
              <li
                key={room.id}
                className="rp-room-tile"
                style={{ backgroundColor: tileColor }}
              >
                <div className="rp-room-tile-top">
                  <button
                    type="button"
                    className="rp-tile-icon-btn"
                    aria-label="更改房间颜色"
                    ref={(element) => {
                      paletteTriggerRefs.current[room.id] = element
                    }}
                    onClick={(event) => {
                      event.stopPropagation()
                      setOpenActionsRoomId(null)
                      setOpenPaletteRoomId((current) => (current === room.id ? null : room.id))
                    }}
                  >
                    🎨
                  </button>

                  <button
                    type="button"
                    className="rp-tile-icon-btn"
                    aria-label="打开房间更多操作"
                    onClick={(event) => {
                      event.stopPropagation()
                      setOpenPaletteRoomId(null)
                      setOpenActionsRoomId((current) => (current === room.id ? null : room.id))
                    }}
                  >
                    •••
                  </button>
                  {openActionsRoomId === room.id ? (
                    <div className="rp-actions-popover" role="menu" onClick={(event) => event.stopPropagation()}>
                      <button type="button" onClick={() => startRename(room)}>改名</button>
                      <button
                        type="button"
                        onClick={() =>
                          setPendingArchive({
                            sessionId: room.id,
                            nextArchived: !room.isArchived,
                            title: room.title || '未命名房间',
                          })
                        }
                      >
                        {room.isArchived ? '取消归档' : '归档'}
                      </button>
                      <button type="button" className="danger" onClick={() => setPendingDelete({ sessionId: room.id })}>
                        删除
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="rp-room-tile-content">
                  {isRenaming ? (
                    <div className="rp-rename-row">
                      <input
                        value={editingTitle}
                        onChange={(event) => setEditingTitle(event.target.value)}
                        placeholder="输入房间标题（可留空）"
                        maxLength={80}
                        disabled={isBusy}
                      />
                      <div className="rp-rename-actions">
                        <button type="button" className="btn-primary" disabled={isBusy} onClick={() => void handleRenameRoom(room.id)}>
                          {isSaving ? '保存中…' : '保存'}
                        </button>
                        <button type="button" className="ghost" disabled={isSaving} onClick={cancelRename}>
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h3 className="ui-title">{room.title || '未命名房间'}</h3>
                      <p className="rp-room-meta">
                        {countsLoading ? '… 条消息' : `${roomMessageCounts[room.id] ?? 0} 条消息`} · {formatRoomTime(room)}
                      </p>
                    </>
                  )}
                </div>

                <button type="button" className="btn-primary rp-enter-btn" onClick={() => navigate(`/rp/${room.id}`)} disabled={isBusy}>
                  进入
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      {openPaletteRoomId && palettePosition
        ? createPortal(
            <div
              className="rp-color-popover rp-color-popover-portal"
              role="menu"
              style={{ top: palettePosition.top, left: palettePosition.left }}
              onClick={(event) => event.stopPropagation()}
            >
              {TILE_COLOR_PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="rp-color-swatch"
                  style={{ backgroundColor: color }}
                  onClick={() => void handleTileColorSelect(openPaletteRoomId, color)}
                  aria-label={`使用颜色 ${color}`}
                />
              ))}
            </div>,
            document.body,
          )
        : null}

      <ConfirmDialog
        open={Boolean(pendingArchive)}
        title={pendingArchive?.nextArchived ? '确认归档房间？' : '确认取消归档？'}
        description={pendingArchive ? `房间：${pendingArchive.title}` : undefined}
        confirmLabel={updatingArchive ? '处理中…' : pendingArchive?.nextArchived ? '归档' : '取消归档'}
        cancelLabel="取消"
        confirmDisabled={updatingArchive}
        cancelDisabled={updatingArchive}
        onCancel={() => setPendingArchive(null)}
        onConfirm={() => void handleToggleArchive()}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="确认删除？"
        description="删除后无法恢复。"
        confirmLabel={deletingRoomId ? '删除中…' : '删除'}
        cancelLabel="取消"
        confirmDisabled={Boolean(deletingRoomId)}
        cancelDisabled={Boolean(deletingRoomId)}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void handleDeleteRoom()}
      />
    </div>
  )
}

export default RpRoomsPage
