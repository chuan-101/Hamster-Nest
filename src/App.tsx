import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import ChatPage from './pages/ChatPage'
import AuthPage from './pages/AuthPage'
import SessionsDrawer from './components/SessionsDrawer'
import type { ChatMessage, ChatSession } from './types'
import {
  addMessage,
  createSession,
  deleteMessage,
  deleteSession,
  loadSnapshot,
  renameSession,
  setSnapshot,
} from './storage/chatStorage'
import {
  addRemoteMessage,
  createRemoteSession,
  deleteRemoteMessage,
  deleteRemoteSession,
  fetchRemoteMessages,
  fetchRemoteSessions,
  renameRemoteSession,
} from './storage/supabaseSync'
import { supabase } from './supabase/client'
import './App.css'

const sortSessions = (sessions: ChatSession[]) =>
  [...sessions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )

const sortMessages = (messages: ChatMessage[]) =>
  [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )

const initialSnapshot = loadSnapshot()

const App = () => {
  const [sessions, setSessions] = useState<ChatSession[]>(initialSnapshot.sessions)
  const [messages, setMessages] = useState<ChatMessage[]>(initialSnapshot.messages)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const sessionsRef = useRef(sessions)
  const messagesRef = useRef(messages)

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const applySnapshot = useCallback((nextSessions: ChatSession[], nextMessages: ChatMessage[]) => {
    const orderedSessions = sortSessions(nextSessions)
    const orderedMessages = sortMessages(nextMessages)
    sessionsRef.current = orderedSessions
    messagesRef.current = orderedMessages
    setSessions(orderedSessions)
    setMessages(orderedMessages)
    setSnapshot({ sessions: orderedSessions, messages: orderedMessages })
  }, [])

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setAuthReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setAuthReady(true)
    })
    return () => {
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!authReady) {
      return
    }
    if (!user) {
      const fallback = loadSnapshot()
      applySnapshot(fallback.sessions, fallback.messages)
      return
    }
    let active = true
    const loadRemote = async () => {
      setSyncing(true)
      try {
        const [remoteSessions, remoteMessages] = await Promise.all([
          fetchRemoteSessions(user.id),
          fetchRemoteMessages(user.id),
        ])
        if (!active) {
          return
        }
        applySnapshot(remoteSessions, remoteMessages)
      } catch (error) {
        console.warn('无法加载 Supabase 数据', error)
      } finally {
        if (active) {
          setSyncing(false)
        }
      }
    }
    loadRemote()
    return () => {
      active = false
    }
  }, [applySnapshot, authReady, user])

  const messageCounts = useMemo(() => {
    return messages.reduce<Record<string, number>>((accumulator, message) => {
      accumulator[message.sessionId] = (accumulator[message.sessionId] ?? 0) + 1
      return accumulator
    }, {})
  }, [messages])

  const createSessionEntry = useCallback(
    async (title?: string) => {
      const sessionTitle = title ?? '新会话'
      if (user && supabase) {
        try {
          const remoteSession = await createRemoteSession(user.id, sessionTitle)
          const nextSessions = sortSessions([...sessionsRef.current, remoteSession])
          applySnapshot(nextSessions, messagesRef.current)
          return remoteSession
        } catch (error) {
          console.warn('创建云端会话失败，已切换本地存储', error)
        }
      }
      const newSession = createSession(sessionTitle)
      setSessions((prev) => sortSessions([...prev, newSession]))
      return newSession
    },
    [applySnapshot, user],
  )

  const renameSessionEntry = useCallback(
    async (sessionId: string, title: string) => {
      if (user && supabase) {
        try {
          const updated = await renameRemoteSession(sessionId, title)
          const nextSessions = sessionsRef.current.map((session) =>
            session.id === sessionId ? updated : session,
          )
          applySnapshot(nextSessions, messagesRef.current)
          return
        } catch (error) {
          console.warn('更新云端会话失败，已切换本地存储', error)
        }
      }
      const updated = renameSession(sessionId, title)
      if (!updated) {
        return
      }
      setSessions((prev) =>
        prev.map((session) => (session.id === sessionId ? updated : session)),
      )
    },
    [applySnapshot, user],
  )

  const appendMessage = useCallback(
    async (
      sessionId: string,
      role: ChatMessage['role'],
      content: string,
      meta?: ChatMessage['meta'],
    ) => {
      if (user && supabase) {
        try {
          const { message, updatedAt } = await addRemoteMessage(
            sessionId,
            user.id,
            role,
            content,
            meta,
          )
          const nextMessages = [...messagesRef.current, message]
          const nextSessions = sessionsRef.current.map((session) =>
            session.id === sessionId ? { ...session, updatedAt } : session,
          )
          applySnapshot(nextSessions, nextMessages)
          return message
        } catch (error) {
          console.warn('写入云端消息失败，已切换本地存储', error)
        }
      }
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
    [applySnapshot, user],
  )

  const sendMessage = useCallback(
    async (sessionId: string, content: string) => {
      await appendMessage(sessionId, 'user', content)
      await appendMessage(sessionId, 'assistant', '这是一个模拟回复。', {
        model: '模拟模型',
      })
    },
    [appendMessage],
  )

  const removeMessage = useCallback(
    async (messageId: string) => {
      if (user && supabase) {
        try {
          await deleteRemoteMessage(messageId)
          const nextMessages = messagesRef.current.filter(
            (message) => message.id !== messageId,
          )
          applySnapshot(sessionsRef.current, nextMessages)
          return
        } catch (error) {
          console.warn('删除云端消息失败，已切换本地存储', error)
        }
      }
      deleteMessage(messageId)
      setMessages((prev) => prev.filter((message) => message.id !== messageId))
    },
    [applySnapshot, user],
  )

  const removeSession = useCallback(
    async (sessionId: string) => {
      if (user && supabase) {
        try {
          await deleteRemoteSession(sessionId)
          const nextSessions = sessionsRef.current.filter(
            (session) => session.id !== sessionId,
          )
          const nextMessages = messagesRef.current.filter(
            (message) => message.sessionId !== sessionId,
          )
          applySnapshot(nextSessions, nextMessages)
          return
        } catch (error) {
          console.warn('删除云端会话失败，已切换本地存储', error)
        }
      }
      deleteSession(sessionId)
      setSessions((prev) => prev.filter((session) => session.id !== sessionId))
      setMessages((prev) => prev.filter((message) => message.sessionId !== sessionId))
    },
    [applySnapshot, user],
  )

  return (
    <div className="app-shell">
      <Routes>
        <Route
          path="/login"
          element={<AuthPage user={user} />}
        />
        <Route
          path="/"
          element={
            <RequireAuth ready={authReady} user={user}>
              <NewSessionRedirect onCreateSession={createSessionEntry} />
            </RequireAuth>
          }
        />
        <Route
          path="/chat/:sessionId"
          element={
            <RequireAuth ready={authReady} user={user}>
              <ChatRoute
                sessions={sessions}
                messages={messages}
                messageCounts={messageCounts}
                drawerOpen={drawerOpen}
                syncing={syncing}
                onOpenDrawer={() => setDrawerOpen(true)}
                onCloseDrawer={() => setDrawerOpen(false)}
                onCreateSession={createSessionEntry}
                onRenameSession={renameSessionEntry}
                onSendMessage={sendMessage}
                onDeleteMessage={removeMessage}
                onDeleteSession={removeSession}
              />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

const RequireAuth = ({
  ready,
  user,
  children,
}: {
  ready: boolean
  user: User | null
  children: ReactNode
}) => {
  if (!ready) {
    return (
      <div className="loading-state">
        <p>正在检查登录状态...</p>
      </div>
    )
  }
  if (!user) {
    return <Navigate to="/login" replace />
  }
  return children
}

const NewSessionRedirect = ({
  onCreateSession,
}: {
  onCreateSession: (title?: string) => Promise<ChatSession>
}) => {
  const navigate = useNavigate()
  useEffect(() => {
    let active = true
    const create = async () => {
      const newSession = await onCreateSession()
      if (!active) {
        return
      }
      navigate(`/chat/${newSession.id}`, { replace: true })
    }
    create()
    return () => {
      active = false
    }
  }, [navigate, onCreateSession])
  return null
}

const ChatRoute = ({
  sessions,
  messages,
  messageCounts,
  drawerOpen,
  syncing,
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
  syncing: boolean
  onOpenDrawer: () => void
  onCloseDrawer: () => void
  onCreateSession: (title?: string) => Promise<ChatSession>
  onRenameSession: (sessionId: string, title: string) => Promise<void>
  onSendMessage: (sessionId: string, text: string) => Promise<void>
  onDeleteMessage: (messageId: string) => Promise<void>
  onDeleteSession: (sessionId: string) => Promise<void>
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

  const handleCreateSession = useCallback(async () => {
    const newSession = await onCreateSession()
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
    async (id: string) => {
      let nextSessionId: string | null = null
      if (activeSession?.id === id) {
        const remaining = sessions.filter((session) => session.id !== id)
        if (remaining.length > 0) {
          nextSessionId = remaining[0].id
        } else {
          const newSession = await onCreateSession('新会话')
          nextSessionId = newSession.id
        }
      }

      if (nextSessionId) {
        navigate(`/chat/${nextSessionId}`, { replace: true })
      }
      await onDeleteSession(id)
    },
    [activeSession?.id, navigate, onCreateSession, onDeleteSession, sessions],
  )

  useEffect(() => {
    if (!activeSession) {
      if (sessions.length > 0) {
        navigate(`/chat/${sessions[0].id}`, { replace: true })
      } else {
        const ensureSession = async () => {
          const fallback = await onCreateSession('新会话')
          navigate(`/chat/${fallback.id}`, { replace: true })
        }
        ensureSession()
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
        syncing={syncing}
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
