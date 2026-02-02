import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { ChatMessage, ChatSession } from '../types'
import ConfirmDialog from '../components/ConfirmDialog'
import './ChatPage.css'

export type ChatPageProps = {
  session: ChatSession
  messages: ChatMessage[]
  onOpenDrawer: () => void
  onSendMessage: (text: string) => void
  onDeleteMessage: (messageId: string) => void
}

const formatTime = (timestamp: string) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

const ChatPage = ({
  session,
  messages,
  onOpenDrawer,
  onSendMessage,
  onDeleteMessage,
}: ChatPageProps) => {
  const [draft, setDraft] = useState('')
  const [openActionsId, setOpenActionsId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ChatMessage | null>(null)

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed) {
      return
    }
    onSendMessage(trimmed)
    setDraft('')
  }

  const handleCopy = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.content)
    } catch (error) {
      console.warn('Unable to copy message', error)
    } finally {
      setOpenActionsId(null)
    }
  }

  const handleDelete = (message: ChatMessage) => {
    setPendingDelete(message)
    setOpenActionsId(null)
  }

  const handleConfirmDelete = () => {
    if (!pendingDelete) {
      return
    }
    onDeleteMessage(pendingDelete.id)
    setPendingDelete(null)
  }

  const actionsLabel = useMemo(() => {
    return openActionsId ? 'Close actions' : 'Open actions'
  }, [openActionsId])

  return (
    <div className="chat-page">
      <header className="chat-header">
        <button type="button" className="ghost" onClick={onOpenDrawer}>
          Sessions
        </button>
        <div className="header-title">
          <h1>{session.title}</h1>
          <span className="subtitle">Single chat</span>
        </div>
        <button type="button" className="ghost">
          Chat actions
        </button>
      </header>
      <main className="chat-messages">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`message ${message.role === 'user' ? 'out' : 'in'}`}
          >
            <div className="bubble">
              <p>{message.content}</p>
              <div className="message-footer">
                {message.role === 'assistant' && message.meta?.model ? (
                  <span className="model-tag">{message.meta.model}</span>
                ) : null}
                <span className="timestamp">{formatTime(message.createdAt)}</span>
              </div>
            </div>
            <div className="message-actions">
              <button
                type="button"
                className="ghost action-trigger"
                aria-expanded={openActionsId === message.id}
                aria-label={actionsLabel}
                onClick={() =>
                  setOpenActionsId((current) =>
                    current === message.id ? null : message.id,
                  )
                }
              >
                •••
              </button>
              {openActionsId === message.id ? (
                <div className="actions-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => handleCopy(message)}>
                    Copy
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => handleDelete(message)}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </main>
      <form className="chat-composer" onSubmit={handleSubmit}>
        <textarea
          placeholder="Type your message"
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="primary">
          Send
        </button>
      </form>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete message?"
        description="This will remove the message from this session."
        confirmLabel="Delete"
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}

export default ChatPage
