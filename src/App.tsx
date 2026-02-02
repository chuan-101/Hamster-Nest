import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import ChatPage from './pages/ChatPage'
import SessionsDrawer from './components/SessionsDrawer'
import { ChatMessage, ChatSession } from './types'
import './App.css'

const nowLabel = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const createSessionEntry = (title?: string): ChatSession => ({
  id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  title: title ?? 'New chat',
  messages: [
    {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-assistant`,
      author: 'assistant',
      text: 'Welcome! This is a mocked conversation starter.',
      timestamp: nowLabel(),
    },
    {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-user`,
      author: 'user',
      text: 'Got it — ready to build out the UI shell!',
      timestamp: nowLabel(),
    },
  ],
})

const initialSessions: ChatSession[] = [
  createSessionEntry('Project kickoff'),
  createSessionEntry('Design review'),
]

const App = () => {
  const [sessions, setSessions] = useState<ChatSession[]>(initialSessions)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const createSession = useCallback((title?: string) => {
    const newSession = createSessionEntry(title)
    setSessions((prev) => [newSession, ...prev])
    return newSession
  }, [])

  const renameSession = useCallback((sessionId: string, title: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId ? { ...session, title } : session,
      ),
    )
  }, [])

  const addMessage = useCallback((sessionId: string, text: string) => {
    const newMessage: ChatMessage = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-user`,
      author: 'user',
      text,
      timestamp: nowLabel(),
    }
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? { ...session, messages: [...session.messages, newMessage] }
          : session,
      ),
    )
  }, [])

  const deleteSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((session) => session.id !== sessionId))
  }, [])

  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<NewSessionRedirect onCreateSession={createSession} />} />
        <Route
          path="/chat/:sessionId"
          element={
            <ChatRoute
              sessions={sessions}
              drawerOpen={drawerOpen}
              onOpenDrawer={() => setDrawerOpen(true)}
              onCloseDrawer={() => setDrawerOpen(false)}
              onCreateSession={createSession}
              onRenameSession={renameSession}
              onAddMessage={addMessage}
              onDeleteSession={deleteSession}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

const NewSessionRedirect = ({
  onCreateSession,
}: {
  onCreateSession: (title?: string) => ChatSession
}) => {
  const navigate = useNavigate()
  useEffect(() => {
    const newSession = onCreateSession()
    navigate(`/chat/${newSession.id}`, { replace: true })
  }, [navigate, onCreateSession])
  return null
}

const ChatRoute = ({
  sessions,
  drawerOpen,
  onOpenDrawer,
  onCloseDrawer,
  onCreateSession,
  onRenameSession,
  onAddMessage,
  onDeleteSession,
}: {
  sessions: ChatSession[]
  drawerOpen: boolean
  onOpenDrawer: () => void
  onCloseDrawer: () => void
  onCreateSession: (title?: string) => ChatSession
  onRenameSession: (sessionId: string, title: string) => void
  onAddMessage: (sessionId: string, text: string) => void
  onDeleteSession: (sessionId: string) => void
}) => {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const activeSession = sessions.find((session) => session.id === sessionId)

  const handleCreateSession = () => {
    const newSession = onCreateSession()
    navigate(`/chat/${newSession.id}`)
    onCloseDrawer()
  }

  const handleSelectSession = (id: string) => {
    navigate(`/chat/${id}`)
    onCloseDrawer()
  }

  const handleDeleteSession = (id: string) => {
    let nextSessionId: string | null = null
    onDeleteSession(id)
    if (activeSession?.id === id) {
      const remaining = sessions.filter((session) => session.id !== id)
      if (remaining.length > 0) {
        nextSessionId = remaining[0].id
      } else {
        const newSession = onCreateSession('Fresh start')
        nextSessionId = newSession.id
      }
    }

    if (nextSessionId) {
      navigate(`/chat/${nextSessionId}`, { replace: true })
    }
  }

  useEffect(() => {
    if (!activeSession) {
      const fallback = onCreateSession('Recovered chat')
      navigate(`/chat/${fallback.id}`, { replace: true })
    }
  }, [activeSession, navigate, onCreateSession])

  if (!activeSession) {
    return null
  }

  return (
    <>
      <ChatPage
        session={activeSession}
        onOpenDrawer={onOpenDrawer}
        onSendMessage={(text) => onAddMessage(activeSession.id, text)}
      />
      <SessionsDrawer
        open={drawerOpen}
        sessions={sessions}
        activeSessionId={activeSession.id}
        onClose={onCloseDrawer}
        onCreateSession={handleCreateSession}
        onSelectSession={handleSelectSession}
        onRenameSession={onRenameSession}
        onDeleteSession={handleDeleteSession}
      />
    </>
  )
}

export default App
