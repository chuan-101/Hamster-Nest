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

const COLOR_POPOVER_WIDTH = 196
const COLOR_POPOVER_HEIGHT = 214
const COLOR_POPOVER_GAP = 8
const ACTIONS_POPOVER_WIDTH = 140
const ACTIONS_POPOVER_HEIGHT = 124
const VIEWPORT_MARGIN = 8
const TILE_COLOR_DEBOUNCE_MS = 320

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

const normalizeHexColor = (value: string) => {
  const trimmed = value.trim()
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return null
  }
  return trimmed.toUpperCase()
}


const isAbortError = (error: unknown) => (
  error instanceof DOMException && error.name === 'AbortError'
)

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
  const [actionsPosition, setActionsPosition] = useState<{ top: number; left: number } | null>(null)
  const paletteTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const actionsTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const palettePopoverRef = useRef<HTMLDivElement | null>(null)
  const actionsPopoverRef = useRef<HTMLDivElement | null>(null)
  const pendingTileColorTimeoutsRef = useRef<Record<string, number>>({})
  const tileColorRequestControllersRef = useRef<Record<string, AbortController>>({})

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
    const controller = new AbortController()
    const roomIds = rooms.map((room) => room.id)

    const loadMessageCounts = async () => {
      setCountsLoading(true)
      try {
        const counts = await fetchRpMessageCounts(user.id, roomIds, controller.signal)
        if (!canceled) {
          setRoomMessageCounts(counts)
        }
      } catch (countError) {
        if (isAbortError(countError)) {
          return
        }
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
      controller.abort()
    }
  }, [rooms, user])

  useEffect(() => {
    return () => {
      Object.values(pendingTileColorTimeoutsRef.current).forEach((timerId) => {
        window.clearTimeout(timerId)
      })
      pendingTileColorTimeoutsRef.current = {}

      Object.values(tileColorRequestControllersRef.current).forEach((controller) => {
        controller.abort()
      })
      tileColorRequestControllersRef.current = {}
    }
  }, [])

  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) {
        return
      }

      if (palettePopoverRef.current?.contains(target)) {
        return
      }
      if (actionsPopoverRef.current?.contains(target)) {
        return
      }

      setOpenPaletteRoomId(null)
      setOpenActionsRoomId(null)
    }
    document.addEventListener('pointerdown', closeMenus)
    return () => document.removeEventListener('pointerdown', closeMenus)
  }, [])

  useEffect(() => {
    if (!openPaletteRoomId) {
      setPalettePosition(null)
      return
    }

    let frameId: number | null = null

    const updatePalettePosition = () => {
      frameId = null
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

    const scheduleUpdatePalettePosition = () => {
      if (frameId !== null) {
        return
      }
      frameId = window.requestAnimationFrame(updatePalettePosition)
    }

    updatePalettePosition()
    window.addEventListener('resize', scheduleUpdatePalettePosition)
    window.addEventListener('scroll', scheduleUpdatePalettePosition, true)

    return () => {
      window.removeEventListener('resize', scheduleUpdatePalettePosition)
      window.removeEventListener('scroll', scheduleUpdatePalettePosition, true)
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [openPaletteRoomId])

  useEffect(() => {
    if (!openActionsRoomId) {
      setActionsPosition(null)
      return
    }

    let frameId: number | null = null

    const updateActionsPosition = () => {
      frameId = null
      const trigger = actionsTriggerRefs.current[openActionsRoomId]
      if (!trigger) {
        setActionsPosition(null)
        return
      }

      const triggerRect = trigger.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      let left = triggerRect.right - ACTIONS_POPOVER_WIDTH
      left = Math.max(VIEWPORT_MARGIN, Math.min(left, viewportWidth - ACTIONS_POPOVER_WIDTH - VIEWPORT_MARGIN))

      let top = triggerRect.bottom + COLOR_POPOVER_GAP
      const wouldOverflowBottom = top + ACTIONS_POPOVER_HEIGHT > viewportHeight - VIEWPORT_MARGIN
      if (wouldOverflowBottom) {
        top = triggerRect.top - ACTIONS_POPOVER_HEIGHT - COLOR_POPOVER_GAP
      }
      top = Math.max(VIEWPORT_MARGIN, Math.min(top, viewportHeight - ACTIONS_POPOVER_HEIGHT - VIEWPORT_MARGIN))

      setActionsPosition({ top, left })
    }

    const scheduleUpdateActionsPosition = () => {
      if (frameId !== null) {
        return
      }
      frameId = window.requestAnimationFrame(updateActionsPosition)
    }

    updateActionsPosition()
    window.addEventListener('resize', scheduleUpdateActionsPosition)
    window.addEventListener('scroll', scheduleUpdateActionsPosition, true)

    return () => {
      window.removeEventListener('resize', scheduleUpdateActionsPosition)
      window.removeEventListener('scroll', scheduleUpdateActionsPosition, true)
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [openActionsRoomId])

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

  const handleTileColorSelect = (roomId: string, color: string) => {
    const normalizedColor = normalizeHexColor(color)
    if (!normalizedColor) {
      return
    }

    setRooms((current) => current.map((room) => (room.id === roomId ? { ...room, tileColor: normalizedColor } : room)))

    const existingTimeoutId = pendingTileColorTimeoutsRef.current[roomId]
    if (typeof existingTimeoutId !== 'undefined') {
      window.clearTimeout(existingTimeoutId)
      delete pendingTileColorTimeoutsRef.current[roomId]
    }

    const existingController = tileColorRequestControllersRef.current[roomId]
    if (existingController) {
      existingController.abort()
      delete tileColorRequestControllersRef.current[roomId]
    }

    pendingTileColorTimeoutsRef.current[roomId] = window.setTimeout(() => {
      const controller = new AbortController()
      tileColorRequestControllersRef.current[roomId] = controller
      delete pendingTileColorTimeoutsRef.current[roomId]

      void (async () => {
        try {
          await updateRpSessionTileColor(roomId, normalizedColor, controller.signal)
        } catch (updateError) {
          if (isAbortError(updateError)) {
            return
          }
          console.warn('更新 RP 房间颜色失败', updateError)
          setNotice('颜色已本地更新，云端保存失败。')
        } finally {
          if (tileColorRequestControllersRef.current[roomId] === controller) {
            delete tileColorRequestControllersRef.current[roomId]
          }
        }
      })()
    }, TILE_COLOR_DEBOUNCE_MS)
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
  const activePaletteColor = useMemo(() => {
    if (!openPaletteRoomId) {
      return '#F88FA4'
    }
    const room = rooms.find((item) => item.id === openPaletteRoomId)
    return room ? resolveRoomTileColor(room).toUpperCase() : '#F88FA4'
  }, [openPaletteRoomId, rooms])

  return (
    <div className="rp-rooms-page">
      <div className="rp-rooms-shell">
        <section className="rp-rooms-top">
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
        </section>

        <section className="rp-rooms-scroll">
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
                        ref={(element) => {
                          actionsTriggerRefs.current[room.id] = element
                        }}
                        onClick={(event) => {
                          event.stopPropagation()
                          setOpenPaletteRoomId(null)
                          setOpenActionsRoomId((current) => (current === room.id ? null : room.id))
                        }}
                      >
                        •••
                      </button>
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
        </section>
      </div>

      {openPaletteRoomId && palettePosition
        ? createPortal(
            <div
              className="rp-color-popover rp-color-popover-portal"
              role="menu"
              style={{ top: palettePosition.top, left: palettePosition.left }}
              ref={palettePopoverRef}
              onPointerDownCapture={(event) => event.stopPropagation()}
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
              <label className="rp-color-custom" htmlFor="rp-custom-tile-color">
                自定义
                <input
                  id="rp-custom-tile-color"
                  type="color"
                  value={activePaletteColor}
                  onInput={(event) => void handleTileColorSelect(openPaletteRoomId, event.currentTarget.value)}
                  onChange={(event) => void handleTileColorSelect(openPaletteRoomId, event.target.value)}
                  aria-label="选择自定义颜色"
                />
                <span>{activePaletteColor}</span>
              </label>
              <button type="button" className="rp-color-close-btn" onClick={() => setOpenPaletteRoomId(null)}>
                完成
              </button>
            </div>,
            document.body,
          )
        : null}

      {openActionsRoomId && actionsPosition
        ? createPortal(
            <div
              className="rp-actions-popover rp-actions-popover-portal"
              role="menu"
              style={{ top: actionsPosition.top, left: actionsPosition.left }}
              ref={actionsPopoverRef}
              onPointerDownCapture={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              {(() => {
                const room = rooms.find((item) => item.id === openActionsRoomId)
                if (!room) {
                  return null
                }
                return (
                  <>
                    <button type="button" onClick={() => startRename(room)}>改名</button>
                    <button
                      type="button"
                      onClick={() =>
                        {
                          setPendingArchive({
                            sessionId: room.id,
                            nextArchived: !room.isArchived,
                            title: room.title || '未命名房间',
                          })
                          setOpenActionsRoomId(null)
                        }
                      }
                    >
                      {room.isArchived ? '取消归档' : '归档'}
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        setPendingDelete({ sessionId: room.id })
                        setOpenActionsRoomId(null)
                      }}
                    >
                      删除
                    </button>
                  </>
                )
              })()}
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
