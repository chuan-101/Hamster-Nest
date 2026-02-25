import { memo, useCallback, useMemo, useState } from 'react'
import type { ChatSession } from '../types'
import ConfirmDialog from './ConfirmDialog'
import './SessionsDrawer.css'

export type SessionsDrawerProps = {
  open: boolean
  sessions: ChatSession[]
  messageCounts: Record<string, number>
  activeSessionId?: string
  syncing?: boolean
  onClose: () => void
  onCreateSession: () => void | Promise<void>
  onSelectSession: (sessionId: string) => void
  onRenameSession: (sessionId: string, title: string) => Promise<void> | void
  onDeleteSession: (sessionId: string) => Promise<void> | void
  onArchiveSession: (sessionId: string, isArchived: boolean) => Promise<void> | void
}

type SessionRowProps = {
  session: ChatSession
  isActive: boolean
  isEditing: boolean
  draftTitle: string
  messageCount: number
  archiveView: 'active' | 'archived'
  onSelect: (sessionId: string) => void
  onStartRename: (session: ChatSession) => void
  onDraftTitleChange: (value: string) => void
  onConfirmRename: () => void
  onCancelRename: () => void
  onRequestDelete: (sessionId: string) => void
  onArchiveToggle: (sessionId: string, nextArchived: boolean) => void
}

const SessionRow = memo(
  ({
    session,
    isActive,
    isEditing,
    draftTitle,
    messageCount,
    archiveView,
    onSelect,
    onStartRename,
    onDraftTitleChange,
    onConfirmRename,
    onCancelRename,
    onRequestDelete,
    onArchiveToggle,
  }: SessionRowProps) => {
    const handleSelect = useCallback(() => {
      onSelect(session.id)
    }, [onSelect, session.id])

    const handleRename = useCallback(() => {
      onStartRename(session)
    }, [onStartRename, session])

    const handleDelete = useCallback(() => {
      onRequestDelete(session.id)
    }, [onRequestDelete, session.id])

    const handleArchiveToggle = useCallback(() => {
      onArchiveToggle(session.id, !session.isArchived)
    }, [onArchiveToggle, session.id, session.isArchived])

    return (
      <div className={`session-row ${isActive ? 'active' : ''}`}>
        {isEditing ? (
          <div className="rename-row">
            <input
              value={draftTitle}
              onChange={(event) => onDraftTitleChange(event.target.value)}
              aria-label="重命名会话"
            />
            <div className="inline-actions">
              <button type="button" onClick={onConfirmRename}>
                保存
              </button>
              <button type="button" onClick={onCancelRename}>
                取消
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="session-select" onClick={handleSelect}>
            <span>{session.title}</span>
            <span className="count">{messageCount} 条消息</span>
          </button>
        )}
        {!isEditing ? (
          <div className="session-actions">
            <button type="button" className="ghost" onClick={handleArchiveToggle}>
              {archiveView === 'active' ? '收纳' : '移出抽屉'}
            </button>
            <button type="button" className="ghost" onClick={handleRename}>
              重命名
            </button>
            <button type="button" className="danger" onClick={handleDelete}>
              删除
            </button>
          </div>
        ) : null}
      </div>
    )
  },
)

SessionRow.displayName = 'SessionRow'

const SessionsDrawer = ({
  open,
  sessions,
  messageCounts,
  activeSessionId,
  syncing,
  onClose,
  onCreateSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onArchiveSession,
}: SessionsDrawerProps) => {
  const [search, setSearch] = useState('')
  const [archiveView, setArchiveView] = useState<'active' | 'archived'>('active')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const filteredSessions = useMemo(() => {
    const query = search.trim().toLowerCase()
    const scopedSessions = sessions.filter((session) =>
      archiveView === 'active' ? !session.isArchived : session.isArchived,
    )
    if (!query) {
      return scopedSessions
    }
    return scopedSessions.filter((session) =>
      session.title.toLowerCase().includes(query),
    )
  }, [archiveView, search, sessions])

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
  }, [])

  const handleStartRename = useCallback((session: ChatSession) => {
    setEditingId(session.id)
    setDraftTitle(session.title)
  }, [])

  const handleConfirmRename = useCallback(() => {
    if (!editingId) {
      return
    }
    const trimmed = draftTitle.trim()
    if (trimmed) {
      onRenameSession(editingId, trimmed)
    }
    setEditingId(null)
    setDraftTitle('')
  }, [draftTitle, editingId, onRenameSession])

  const handleCancelRename = useCallback(() => {
    setEditingId(null)
    setDraftTitle('')
  }, [])

  const handleDelete = useCallback(() => {
    if (pendingDeleteId) {
      onDeleteSession(pendingDeleteId)
      setPendingDeleteId(null)
    }
  }, [onDeleteSession, pendingDeleteId])

  const handleRequestDelete = useCallback((sessionId: string) => {
    setPendingDeleteId(sessionId)
  }, [])

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      onSelectSession(sessionId)
    },
    [onSelectSession],
  )

  const handleArchiveToggle = useCallback(
    (sessionId: string, nextArchived: boolean) => {
      onArchiveSession(sessionId, nextArchived)
      if (editingId === sessionId) {
        setEditingId(null)
        setDraftTitle('')
      }
    },
    [editingId, onArchiveSession],
  )

  return (
    <>
      <div className={`drawer-scrim ${open ? 'open' : ''}`} onClick={onClose} />
      <aside className={`sessions-drawer ${open ? 'open' : ''}`}>
        <div className="sessions-drawer-content">
          <div className="drawer-header">
            <h2 className="ui-title">会话</h2>
            <div className="drawer-header-actions">
              {syncing ? <span className="syncing">同步中...</span> : null}
              <button type="button" className="ghost" onClick={onClose}>
                关闭
              </button>
            </div>
          </div>
          <div className="drawer-tabs" role="tablist" aria-label="会话分组">
            <button
              type="button"
              role="tab"
              aria-selected={archiveView === 'active'}
              className={archiveView === 'active' ? 'active' : ''}
              onClick={() => setArchiveView('active')}
            >
              进行中
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={archiveView === 'archived'}
              className={archiveView === 'archived' ? 'active' : ''}
              onClick={() => setArchiveView('archived')}
            >
              抽屉
            </button>
          </div>
          <button type="button" className="primary" onClick={onCreateSession}>
            + 新建聊天
          </button>
          <input
            className="search-input"
            type="search"
            placeholder="搜索会话"
            value={search}
            onChange={(event) => handleSearchChange(event.target.value)}
          />
          <div className="sessions-list">
            {filteredSessions.length === 0 ? (
              <p className="empty">未找到会话。</p>
            ) : (
              filteredSessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  isEditing={editingId === session.id}
                  draftTitle={editingId === session.id ? draftTitle : ''}
                  messageCount={messageCounts[session.id] ?? 0}
                  archiveView={archiveView}
                  onSelect={handleSelectSession}
                  onStartRename={handleStartRename}
                  onDraftTitleChange={setDraftTitle}
                  onConfirmRename={handleConfirmRename}
                  onCancelRename={handleCancelRename}
                  onRequestDelete={handleRequestDelete}
                  onArchiveToggle={handleArchiveToggle}
                />
              ))
            )}
          </div>
        </div>
      </aside>
      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="删除该会话？"
        description="此操作会删除该会话及其消息。"
        confirmLabel="删除"
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={handleDelete}
      />
    </>
  )
}

export default SessionsDrawer
