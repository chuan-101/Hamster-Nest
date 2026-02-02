import { useMemo, useState } from 'react'
import { ChatSession } from '../types'
import ConfirmDialog from './ConfirmDialog'
import './SessionsDrawer.css'

export type SessionsDrawerProps = {
  open: boolean
  sessions: ChatSession[]
  activeSessionId?: string
  onClose: () => void
  onCreateSession: () => void
  onSelectSession: (sessionId: string) => void
  onRenameSession: (sessionId: string, title: string) => void
  onDeleteSession: (sessionId: string) => void
}

const SessionsDrawer = ({
  open,
  sessions,
  activeSessionId,
  onClose,
  onCreateSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
}: SessionsDrawerProps) => {
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const filteredSessions = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) {
      return sessions
    }
    return sessions.filter((session) =>
      session.title.toLowerCase().includes(query),
    )
  }, [search, sessions])

  const handleStartRename = (session: ChatSession) => {
    setEditingId(session.id)
    setDraftTitle(session.title)
  }

  const handleConfirmRename = () => {
    if (!editingId) {
      return
    }
    const trimmed = draftTitle.trim()
    if (trimmed) {
      onRenameSession(editingId, trimmed)
    }
    setEditingId(null)
    setDraftTitle('')
  }

  const handleCancelRename = () => {
    setEditingId(null)
    setDraftTitle('')
  }

  const handleDelete = () => {
    if (pendingDeleteId) {
      onDeleteSession(pendingDeleteId)
      setPendingDeleteId(null)
    }
  }

  return (
    <>
      <div className={`drawer-scrim ${open ? 'open' : ''}`} onClick={onClose} />
      <aside className={`sessions-drawer ${open ? 'open' : ''}`}>
        <div className="drawer-header">
          <h2>Sessions</h2>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <button type="button" className="primary" onClick={onCreateSession}>
          + New chat
        </button>
        <input
          className="search-input"
          type="search"
          placeholder="Search sessions"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="sessions-list">
          {filteredSessions.length === 0 ? (
            <p className="empty">No sessions found.</p>
          ) : (
            filteredSessions.map((session) => (
              <div
                key={session.id}
                className={`session-row ${
                  session.id === activeSessionId ? 'active' : ''
                }`}
              >
                {editingId === session.id ? (
                  <div className="rename-row">
                    <input
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      aria-label="Rename session"
                    />
                    <div className="inline-actions">
                      <button type="button" onClick={handleConfirmRename}>
                        Save
                      </button>
                      <button type="button" onClick={handleCancelRename}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="session-select"
                    onClick={() => onSelectSession(session.id)}
                  >
                    <span>{session.title}</span>
                    <span className="count">{session.messages.length} msgs</span>
                  </button>
                )}
                {editingId !== session.id ? (
                  <div className="session-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => handleStartRename(session)}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => setPendingDeleteId(session.id)}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </aside>
      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete session?"
        description="This will remove the session and its messages."
        confirmLabel="Delete"
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={handleDelete}
      />
    </>
  )
}

export default SessionsDrawer
