import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import ChatPage from './pages/ChatPage'
import SessionsDrawer from './components/SessionsDrawer'
import type { ChatMessage, ChatSession } from './types'
import {
  addMessage,
  createSession,
  deleteMessage,
  deleteSession,
  loadSnapshot,
  renameSession,
} from './storage/chatStorage'
import './App.css'

const sortSessions = (sessions: ChatSession[]) =>
  [...sessions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )

const initialSnapshot = loadSnapshot()

const App = () => {
  const [sessions, setSessions] = useState<ChatSession[]>(initialSnapshot.sessions)
  const [messages, setMessages] = useState<ChatMessage[]>(initialSnapshot.messages)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const messageCounts = useMemo(() => {
    return messages.reduce<Record<string, number>>((accumulator, message) => {
      accumulator[message.sessionId] = (accumulator[message.sessionId] ?? 0) + 1
      return accumulator
    }, {})
  }, [messages])

  const createSessionEntry = useCallback((title?: string) => {
    const newSession = createSession(title)
    setSessions((prev) => sortSessions([...prev, newSession]))
    return newSession
  }, [])

  const renameSessionEntry = useCallback((sessionId: string, title: string) => {
    const updated = renameSession(sessionId, title)
    if (!updated) {
      return
    }
    setSessions((prev) =>
      prev.map((session) => (session.id === sessionId ? updated : session)),
    )
  }, [])

  const appendMessage = useCallback(
    (
      sessionId: string,
      role: ChatMessage['role'],
      content: string,
      meta?: ChatMessage['meta'],
    ) => {
      const result = addMessage(sessionId, role, content, meta)
      if (!result) {
        return null
      }
      setMessages((prev) => [...prev, result.message])
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId ? result.session : session,
        ),
      )
      return result.message
    },
    [],
  )

  const sendMessage = useCallback(
    (sessionId: string, content: string) => {
      appendMessage(sessionId, 'user', content)
      appendMessage(sessionId, 'assistant', '这是一个模拟回复。', {
        model: '模拟模型',
      })
    },
    [appendMessage],
  )

  const removeMessage = useCallback((messageId: string) => {
    deleteMessage(messageId)
    setMessages((prev) => prev.filter((message) => message.id !== messageId))
  }, [])

  const removeSession = useCallback((sessionId: string) => {
    deleteSession(sessionId)
    setSessions((prev) => prev.filter((session) => session.id !== sessionId))
    setMessages((prev) => prev.filter((message) => message.sessionId !== sessionId))
  }, [])

  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<NewSessionRedirect onCreateSession={createSessionEntry} />} />
        <Route
          path="/chat/:sessionId"
          element={
            <ChatRoute
              sessions={sessions}
              messages={messages}
              messageCounts={messageCounts}
              drawerOpen={drawerOpen}
              onOpenDrawer={() => setDrawerOpen(true)}
              onCloseDrawer={() => setDrawerOpen(false)}
              onCreateSession={createSessionEntry}
              onRenameSession={renameSessionEntry}
              onSendMessage={sendMessage}
              onDeleteMessage={removeMessage}
              onDeleteSession={removeSession}
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
  messages,
  messageCounts,
  drawerOpen,
  onOpenDrawer,
  onCloseDrawer,
  onCreateSession,
  onRenameSession,
  onSendMessage,
  onDeleteMessage,
  onDeleteSession,
}: {
  sessions: ChatSession[]
  messages: ChatMessage[]
  messageCounts: Record<string, number>
  drawerOpen: boolean
  onOpenDrawer: () => void
  onCloseDrawer: () => void
  onCreateSession: (title?: string) => ChatSession
  onRenameSession: (sessionId: string, title: string) => void
  onSendMessage: (sessionId: string, text: string) => void
  onDeleteMessage: (messageId: string) => void
  onDeleteSession: (sessionId: string) => void
}) => {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const activeSession = sessions.find((session) => session.id === sessionId)
  const activeMessages = useMemo(() => {
    return messages
      .filter((message) => message.sessionId === sessionId)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )
  }, [messages, sessionId])

  const handleCreateSession = useCallback(() => {
    const newSession = onCreateSession()
    navigate(`/chat/${newSession.id}`)
    onCloseDrawer()
  }, [navigate, onCloseDrawer, onCreateSession])

  const handleSelectSession = useCallback(
    (id: string) => {
      navigate(`/chat/${id}`)
      onCloseDrawer()
    },
    [navigate, onCloseDrawer],
  )

  const handleDeleteSession = useCallback(
    (id: string) => {
      let nextSessionId: string | null = null
      if (activeSession?.id === id) {
        const remaining = sessions.filter((session) => session.id !== id)
        if (remaining.length > 0) {
          nextSessionId = remaining[0].id
        } else {
          const newSession = onCreateSession('新会话')
          nextSessionId = newSession.id
        }
      }

      if (nextSessionId) {
        navigate(`/chat/${nextSessionId}`, { replace: true })
      }
      onDeleteSession(id)
    },
    [activeSession?.id, navigate, onCreateSession, onDeleteSession, sessions],
  )

  useEffect(() => {
  if (!activeSession) {
    if (sessions.length > 0) {
      navigate(`/chat/${sessions[0].id}`, { replace: true })
    } else {
      const fallback = onCreateSession('新会话')
      navigate(`/chat/${fallback.id}`, { replace: true })
    }
  }
}, [activeSession, navigate, onCreateSession, sessions])

  if (!activeSession) {
    return null
  }

  return (
    <>
      <ChatPage
        session={activeSession}
        messages={activeMessages}
        onOpenDrawer={onOpenDrawer}
        onSendMessage={(text) => onSendMessage(activeSession.id, text)}
        onDeleteMessage={onDeleteMessage}
      />
      <SessionsDrawer
        open={drawerOpen}
        sessions={sessions}
        messageCounts={messageCounts}
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
