import { FormEvent, useState } from 'react'
import { ChatSession } from '../types'
import './ChatPage.css'

export type ChatPageProps = {
  session: ChatSession
  onOpenDrawer: () => void
  onSendMessage: (text: string) => void
}

const ChatPage = ({ session, onOpenDrawer, onSendMessage }: ChatPageProps) => {
  const [draft, setDraft] = useState('')

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed) {
      return
    }
    onSendMessage(trimmed)
    setDraft('')
  }

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
        {session.messages.map((message) => (
          <div
            key={message.id}
            className={`message ${message.author === 'user' ? 'out' : 'in'}`}
          >
            <div className="bubble">
              <p>{message.text}</p>
              <span>{message.timestamp}</span>
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
    </div>
  )
}

export default ChatPage
