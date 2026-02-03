import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import ChatPage from './pages/ChatPage'
import AuthPage from './pages/AuthPage'
import SessionsDrawer from './components/SessionsDrawer'
import type { ChatMessage, ChatSession } from './types'
import {
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
    (a, b) =>
      new Date(a.clientCreatedAt ?? a.createdAt).getTime() -
        new Date(b.clientCreatedAt ?? b.createdAt).getTime() ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )

const mergeMessages = (localMessages: ChatMessage[], remoteMessages: ChatMessage[]) => {
  const merged = [...localMessages]
  remoteMessages.forEach((message) => {
    const index = merged.findIndex(
      (existing) => existing.id === message.id || existing.clientId === message.clientId,
    )
    if (index === -1) {
      merged.push(message)
      return
    }
    const existing = merged[index]
    merged[index] = {
      ...existing,
      ...message,
      clientId: message.clientId ?? existing.clientId,
      clientCreatedAt: message.clientCreatedAt ?? existing.clientCreatedAt,
      pending: message.pending ?? false,
    }
  })
  return sortMessages(merged)
}

const createClientId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`

const defaultOpenRouterModel = 'openrouter/auto'

const updateMessage = (messages: ChatMessage[], next: ChatMessage) =>
  sortMessages(
    messages.map((message) =>
      message.id === next.id || message.clientId === next.clientId
        ? {
            ...message,
            ...next,
            clientId: next.clientId ?? message.clientId,
            clientCreatedAt: next.clientCreatedAt ?? message.clientCreatedAt,
            pending: next.pending ?? false,
          }
        : message,
    ),
  )

const initialSnapshot = loadSnapshot()

const buildOpenAiMessages = (sessionId: string, messages: ChatMessage[]) =>
  messages
    .filter(
      (message) =>
        message.sessionId === sessionId &&
        message.content.trim().length > 0 &&
        !message.meta?.streaming,
    )
    .map((message) => ({ role: message.role, content: message.content }))

const App = () => {
  const [sessions, setSessions] = useState<ChatSession[]>(initialSnapshot.sessions)
  const [messages, setMessages] = useState<ChatMessage[]>(initialSnapshot.messages)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [pingStatus, setPingStatus] = useState<string | null>(null)
  const [pinging, setPinging] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const sessionsRef = useRef(sessions)
  const messagesRef = useRef(messages)
  const streamingControllerRef = useRef<AbortController | null>(null)
  const enableInvokePing = import.meta.env.DEV

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
  }, [supabase])

  const refreshRemoteSessions = useCallback(async () => {
    if (!user || !supabase) {
      return
    }
    setSyncing(true)
    try {
      const remoteSessions = await fetchRemoteSessions(user.id)
      const nextSessions = sortSessions(remoteSessions)
      applySnapshot(nextSessions, messagesRef.current)
    } catch (error) {
      console.warn('无法加载 Supabase 会话数据', error)
    } finally {
      setSyncing(false)
    }
  }, [applySnapshot, user])

  const handleInvokePing = useCallback(async () => {
    if (!supabase) {
      setPingStatus('Supabase 未初始化')
      return
    }
    setPinging(true)
    setPingStatus(null)
    try {
      const { data, error } = await supabase.functions.invoke('openrouter-chat', {
        body: { ping: true },
      })
      if (error) {
        console.warn('Ping 函数失败', error)
        setPingStatus(`Ping 失败：${error.message}`)
        return
      }
      console.info('Ping 函数返回', data)
      if (data?.ok) {
        setPingStatus('Ping 成功：函数已响应')
      } else {
        setPingStatus('Ping 返回异常')
      }
    } catch (error) {
      console.warn('Ping 函数异常', error)
      setPingStatus('Ping 失败：请求异常')
    } finally {
      setPinging(false)
    }
  }, [supabase])

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
        const nextSessions = sortSessions(remoteSessions)
        const nextMessages = mergeMessages(messagesRef.current, remoteMessages)
        applySnapshot(nextSessions, nextMessages)
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

  useEffect(() => {
    if (!drawerOpen) {
      return
    }
    void refreshRemoteSessions()
  }, [drawerOpen, refreshRemoteSessions])

  useEffect(() => {
    if (!user) {
      return
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshRemoteSessions()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refreshRemoteSessions, user])

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

  const sendMessage = useCallback(
    async (sessionId: string, content: string) => {
      const clientId = createClientId()
      const clientCreatedAt = new Date().toISOString()
      const optimisticMessage: ChatMessage = {
        id: clientId,
        sessionId,
        role: 'user',
        content,
        createdAt: clientCreatedAt,
        clientId,
        clientCreatedAt,
        meta: {},
        pending: true,
      }
      const assistantClientId = createClientId()
      const assistantClientCreatedAt = new Date(
        new Date(clientCreatedAt).getTime() + 200,
      ).toISOString()
      const optimisticAssistant: ChatMessage = {
        id: assistantClientId,
        sessionId,
        role: 'assistant',
        content: '',
        createdAt: assistantClientCreatedAt,
        clientId: assistantClientId,
        clientCreatedAt: assistantClientCreatedAt,
        meta: { model: defaultOpenRouterModel, provider: 'openrouter', streaming: true },
        pending: true,
      }
      const nextMessages = sortMessages([
        ...messagesRef.current,
        optimisticMessage,
        optimisticAssistant,
      ])
      const nextSessions = sessionsRef.current.map((session) =>
        session.id === sessionId ? { ...session, updatedAt: clientCreatedAt } : session,
      )
      applySnapshot(nextSessions, nextMessages)

      const persist = async () => {
        if (!user || !supabase) {
          const localMessages = updateMessage(messagesRef.current, {
            ...optimisticMessage,
            pending: false,
          })
          const assistantMessage: ChatMessage = {
            id: assistantClientId,
            sessionId,
            role: 'assistant',
            content: '当前未登录或服务未配置，无法获取回复。',
            createdAt: assistantClientCreatedAt,
            clientId: assistantClientId,
            clientCreatedAt: assistantClientCreatedAt,
            meta: { model: 'offline', provider: 'openrouter' },
            pending: false,
          }
          const localNextMessages = sortMessages([...localMessages, assistantMessage])
          const localNextSessions = sessionsRef.current.map((session) =>
            session.id === sessionId
              ? { ...session, updatedAt: assistantClientCreatedAt }
              : session,
          )
          applySnapshot(localNextSessions, localNextMessages)
          return
        }

        try {
          const { message: savedUserMessage, updatedAt } = await addRemoteMessage(
            sessionId,
            user.id,
            'user',
            content,
            clientId,
            clientCreatedAt,
            {},
          )
          const updatedMessages = updateMessage(messagesRef.current, {
            ...savedUserMessage,
            pending: false,
          })
          const updatedSessions = sessionsRef.current.map((session) =>
            session.id === sessionId ? { ...session, updatedAt } : session,
          )
          applySnapshot(updatedSessions, updatedMessages)
        } catch (error) {
          console.warn('写入云端消息失败', error)
          window.alert('发送失败，请稍后重试。')
          return
        }

        let assistantContent = ''
        let actualModel = defaultOpenRouterModel
        let pendingDelta = ''
        let flushTimer: number | null = null

        const flushPending = () => {
          if (!pendingDelta) {
            return
          }
          assistantContent += pendingDelta
          pendingDelta = ''
          const streamingUpdate = updateMessage(messagesRef.current, {
            id: assistantClientId,
            sessionId,
            role: 'assistant',
            clientId: assistantClientId,
            content: assistantContent,
            createdAt: assistantClientCreatedAt,
            clientCreatedAt: assistantClientCreatedAt,
            meta: {
              model: actualModel,
              provider: 'openrouter',
              streaming: true,
            },
            pending: true,
          })
          applySnapshot(sessionsRef.current, streamingUpdate)
        }

        const scheduleFlush = () => {
          if (flushTimer !== null) {
            return
          }
          flushTimer = window.setTimeout(() => {
            flushTimer = null
            flushPending()
          }, 50)
        }

        try {
          const { data } = await supabase.auth.getSession()
          const accessToken = data.session?.access_token
          if (!accessToken) {
            window.alert('登录状态异常，请重新登录')
            return
          }
          const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
          if (!anonKey) {
            window.alert('Supabase 环境变量未配置')
            return
          }
          const messagesPayload = buildOpenAiMessages(sessionId, messagesRef.current)
          const controller = new AbortController()
          streamingControllerRef.current?.abort()
          streamingControllerRef.current = controller
          setIsStreaming(true)
          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/openrouter-chat`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                apikey: anonKey,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: defaultOpenRouterModel,
                messages: messagesPayload,
                stream: true,
              }),
              signal: controller.signal,
            },
          )
          if (!response.ok || !response.body) {
            const errorText = await response.text()
            throw new Error(errorText || '请求失败')
          }
          const reader = response.body.getReader()
          const decoder = new TextDecoder('utf-8')
          let buffer = ''
          let done = false
          while (!done) {
            const { value, done: readerDone } = await reader.read()
            if (readerDone) {
              break
            }
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed.startsWith('data:')) {
                continue
              }
              const data = trimmed.replace(/^data:\s*/, '')
              if (data === '[DONE]') {
                done = true
                break
              }
              try {
                const payload = JSON.parse(data)
                const delta = payload?.choices?.[0]?.delta?.content ?? ''
                if (payload?.model) {
                  actualModel = payload.model
                }
                if (delta) {
                  pendingDelta += delta
                  scheduleFlush()
                }
              } catch (error) {
                console.warn('解析流式响应失败', error)
              }
            }
          }

          if (flushTimer !== null) {
            window.clearTimeout(flushTimer)
            flushTimer = null
          }
          flushPending()

          const { message: assistantMessage, updatedAt } = await addRemoteMessage(
            sessionId,
            user.id,
            'assistant',
            assistantContent,
            assistantClientId,
            assistantClientCreatedAt,
            { model: actualModel, provider: 'openrouter' },
          )
          const updatedMessages = updateMessage(messagesRef.current, {
            ...assistantMessage,
            pending: false,
          })
          const updatedSessions = sessionsRef.current.map((session) =>
            session.id === sessionId ? { ...session, updatedAt } : session,
          )
          applySnapshot(updatedSessions, updatedMessages)
        } catch (error) {
          if (flushTimer !== null) {
            window.clearTimeout(flushTimer)
            flushTimer = null
          }
          flushPending()
          if (error instanceof DOMException && error.name === 'AbortError') {
            if (assistantContent.trim().length > 0) {
              const { message: assistantMessage, updatedAt } = await addRemoteMessage(
                sessionId,
                user.id,
                'assistant',
                assistantContent,
                assistantClientId,
                assistantClientCreatedAt,
                { model: actualModel, provider: 'openrouter' },
              )
              const updatedMessages = updateMessage(messagesRef.current, {
                ...assistantMessage,
                pending: false,
              })
              const updatedSessions = sessionsRef.current.map((session) =>
                session.id === sessionId ? { ...session, updatedAt } : session,
              )
              applySnapshot(updatedSessions, updatedMessages)
            } else {
              const abortedMessages = updateMessage(messagesRef.current, {
                id: assistantClientId,
                sessionId,
                role: 'assistant',
                clientId: assistantClientId,
                content: assistantContent,
                createdAt: assistantClientCreatedAt,
                clientCreatedAt: assistantClientCreatedAt,
                meta: { model: actualModel, provider: 'openrouter', streaming: false },
                pending: false,
              })
              applySnapshot(sessionsRef.current, abortedMessages)
            }
            return
          }
          console.warn('流式回复失败', error)
          const failedMessages = updateMessage(messagesRef.current, {
            id: assistantClientId,
            sessionId,
            role: 'assistant',
            clientId: assistantClientId,
            content: assistantContent || '回复失败，请稍后重试。',
            createdAt: assistantClientCreatedAt,
            clientCreatedAt: assistantClientCreatedAt,
            meta: { model: actualModel, provider: 'openrouter', streaming: false },
            pending: false,
          })
          applySnapshot(sessionsRef.current, failedMessages)
          window.alert('回复失败，请稍后重试。')
        } finally {
          setIsStreaming(false)
          streamingControllerRef.current = null
        }
      }

      void persist()
    },
    [applySnapshot, user],
  )

  const handleStopStreaming = useCallback(() => {
    streamingControllerRef.current?.abort()
    setIsStreaming(false)
  }, [])

  const removeMessage = useCallback(
    async (messageId: string) => {
      const targetMessage = messagesRef.current.find(
        (message) => message.id === messageId || message.clientId === messageId,
      )
      if (targetMessage?.pending) {
        const nextMessages = messagesRef.current.filter(
          (message) => message.id !== messageId && message.clientId !== messageId,
        )
        applySnapshot(sessionsRef.current, nextMessages)
        return
      }
      if (user && supabase) {
        try {
          await deleteRemoteMessage(messageId)
          const nextMessages = messagesRef.current.filter(
            (message) => message.id !== messageId && message.clientId !== messageId,
          )
          applySnapshot(sessionsRef.current, nextMessages)
          return
        } catch (error) {
          console.warn('删除云端消息失败，已切换本地存储', error)
        }
      }
      deleteMessage(messageId)
      setMessages((prev) =>
        prev.filter((message) => message.id !== messageId && message.clientId !== messageId),
      )
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
      {enableInvokePing ? (
        <div className="dev-ping">
          <span>调试：函数连接检查</span>
          <button type="button" onClick={handleInvokePing} disabled={pinging}>
            {pinging ? '检查中...' : 'Ping 函数'}
          </button>
          {pingStatus ? <span className="dev-ping__status">{pingStatus}</span> : null}
        </div>
      ) : null}
      <Routes>
        <Route path="/auth" element={<AuthPage user={user} />} />
        <Route
          path="/"
          element={
            <RequireAuth ready={authReady} user={user}>
              <NewSessionRedirect
                sessions={sessions}
                onCreateSession={createSessionEntry}
              />
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
                isStreaming={isStreaming}
                onStopStreaming={handleStopStreaming}
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
    return <Navigate to="/auth" replace />
  }
  return children
}

const NewSessionRedirect = ({
  sessions,
  onCreateSession,
}: {
  sessions: ChatSession[]
  onCreateSession: (title?: string) => Promise<ChatSession>
}) => {
  const navigate = useNavigate()
  const hasInitializedRef = useRef(false)
  useEffect(() => {
    if (hasInitializedRef.current) {
      return
    }
    hasInitializedRef.current = true
    let active = true
    const create = async () => {
      if (sessions.length > 0) {
        navigate(`/chat/${sessions[0].id}`, { replace: true })
        return
      }
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
  }, [navigate, onCreateSession, sessions])
  return null
}

const ChatRoute = ({
  sessions,
  messages,
  messageCounts,
  drawerOpen,
  syncing,
  isStreaming,
  onStopStreaming,
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
  isStreaming: boolean
  onStopStreaming: () => void
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
  void isStreaming
  void onStopStreaming

  const activeSession = sessions.find((session) => session.id === sessionId)
  const activeMessages = useMemo(() => {
    return messages
      .filter((message) => message.sessionId === sessionId)
      .sort(
        (a, b) =>
          new Date(a.clientCreatedAt ?? a.createdAt).getTime() -
            new Date(b.clientCreatedAt ?? b.createdAt).getTime() ||
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
    if (!activeSession && sessions.length > 0) {
      navigate(`/chat/${sessions[0].id}`, { replace: true })
    }
  }, [activeSession, navigate, sessions])

  useEffect(() => {
    if (activeSession || syncing || sessions.length > 0) {
      return
    }
    let active = true
    const createSession = async () => {
      const newSession = await onCreateSession('新会话')
      if (!active) {
        return
      }
      navigate(`/chat/${newSession.id}`, { replace: true })
    }
    void createSession()
    return () => {
      active = false
    }
  }, [activeSession, navigate, onCreateSession, sessions.length, syncing])

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
        isStreaming={isStreaming}
        onStopStreaming={onStopStreaming}
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
