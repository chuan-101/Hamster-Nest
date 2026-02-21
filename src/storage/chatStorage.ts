import type { ChatMessage, ChatSession } from '../types'

const STORAGE_KEY = 'hamster-nest.chat-data.v1'

type StorageSnapshot = {
  sessions: ChatSession[]
  messages: ChatMessage[]
}

const createId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`

const ensureMessageFields = (message: ChatMessage): ChatMessage => {
  const clientId = message.clientId ?? message.id ?? createId()
  const clientCreatedAt = message.clientCreatedAt ?? message.createdAt ?? null
  return {
    ...message,
    id: message.id ?? clientId,
    clientId,
    clientCreatedAt,
    createdAt: message.createdAt ?? clientCreatedAt ?? new Date().toISOString(),
    pending: message.pending ?? false,
  }
}

const ensureSessionFields = (session: ChatSession): ChatSession => ({
  ...session,
  isArchived: session.isArchived ?? false,
  archivedAt: session.archivedAt ?? null,
})

const readSnapshot = (): StorageSnapshot => {
  if (typeof localStorage === 'undefined') {
    return { sessions: [], messages: [] }
  }
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return { sessions: [], messages: [] }
  }
  try {
    const parsed = JSON.parse(raw) as StorageSnapshot
    return {
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    }
  } catch (error) {
    console.warn('Failed to parse chat storage', error)
    return { sessions: [], messages: [] }
  }
}

const snapshot: StorageSnapshot = readSnapshot()
let pendingWrite: ReturnType<typeof setTimeout> | null = null

const scheduleWrite = () => {
  if (typeof localStorage === 'undefined') {
    return
  }
  if (pendingWrite) {
    return
  }
  pendingWrite = setTimeout(() => {
    pendingWrite = null
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
    } catch (error) {
      console.warn('Failed to persist chat storage', error)
    }
  }, 150)
}

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

export const loadSnapshot = (): StorageSnapshot => {
  snapshot.sessions = sortSessions(snapshot.sessions.map(ensureSessionFields))
  snapshot.messages = sortMessages(snapshot.messages.map(ensureMessageFields))
  return {
    sessions: sortSessions(snapshot.sessions.map(ensureSessionFields)),
    messages: sortMessages(snapshot.messages.map(ensureMessageFields)),
  }
}

export const setSnapshot = (next: StorageSnapshot) => {
  snapshot.sessions = sortSessions(next.sessions.map(ensureSessionFields))
  snapshot.messages = sortMessages(next.messages.map(ensureMessageFields))
  scheduleWrite()
}

export const createSession = (title?: string): ChatSession => {
  const now = new Date().toISOString()
  const session: ChatSession = {
    id: createId(),
    title: title ?? '新会话',
    createdAt: now,
    updatedAt: now,
    isArchived: false,
    archivedAt: null,
    overrideModel: null,
    overrideReasoning: null,
  }
  snapshot.sessions = sortSessions([...snapshot.sessions, session])
  scheduleWrite()
  return session
}

export const renameSession = (sessionId: string, title: string): ChatSession | null => {
  let updatedSession: ChatSession | null = null
  snapshot.sessions = snapshot.sessions.map((session) => {
    if (session.id !== sessionId) {
      return session
    }
    updatedSession = { ...session, title }
    return updatedSession
  })
  if (!updatedSession) {
    return null
  }
  scheduleWrite()
  return updatedSession
}

export const addMessage = (
  sessionId: string,
  role: ChatMessage['role'],
  content: string,
  meta?: ChatMessage['meta'],
  options?: {
    clientId?: string
    clientCreatedAt?: string
    createdAt?: string
    pending?: boolean
  },
): { message: ChatMessage; session: ChatSession } | null => {
  const now = options?.createdAt ?? new Date().toISOString()
  const sessionIndex = snapshot.sessions.findIndex((session) => session.id === sessionId)
  if (sessionIndex === -1) {
    return null
  }
  const clientId = options?.clientId ?? createId()
  const clientCreatedAt = options?.clientCreatedAt ?? now
  const message: ChatMessage = {
    id: options?.pending ? clientId : createId(),
    sessionId,
    role,
    content,
    createdAt: now,
    clientId,
    clientCreatedAt,
    meta,
    pending: options?.pending ?? false,
  }
  const sessions = [...snapshot.sessions]
  const updatedSession = { ...sessions[sessionIndex], updatedAt: now }
  sessions[sessionIndex] = updatedSession
  snapshot.sessions = sessions
  snapshot.messages = [...snapshot.messages, message]
  scheduleWrite()
  return { message, session: updatedSession }
}

export const deleteMessage = (messageId: string) => {
  snapshot.messages = snapshot.messages.filter((message) => message.id !== messageId)
  scheduleWrite()
}

export const deleteSession = (sessionId: string) => {
  snapshot.sessions = snapshot.sessions.filter((session) => session.id !== sessionId)
  snapshot.messages = snapshot.messages.filter((message) => message.sessionId !== sessionId)
  scheduleWrite()
}

export const updateSessionOverride = (
  sessionId: string,
  overrideModel: string | null,
): ChatSession | null => {
  let updatedSession: ChatSession | null = null
  snapshot.sessions = snapshot.sessions.map((session) => {
    if (session.id !== sessionId) {
      return session
    }
    updatedSession = { ...session, overrideModel }
    return updatedSession
  })
  if (!updatedSession) {
    return null
  }
  scheduleWrite()
  return updatedSession
}

export const updateSessionReasoningOverride = (
  sessionId: string,
  overrideReasoning: boolean | null,
): ChatSession | null => {
  let updatedSession: ChatSession | null = null
  snapshot.sessions = snapshot.sessions.map((session) => {
    if (session.id !== sessionId) {
      return session
    }
    updatedSession = { ...session, overrideReasoning }
    return updatedSession
  })
  if (!updatedSession) {
    return null
  }
  scheduleWrite()
  return updatedSession
}

export const setSessionArchiveState = (
  sessionId: string,
  isArchived: boolean,
): ChatSession | null => {
  let updatedSession: ChatSession | null = null
  const archivedAt = isArchived ? new Date().toISOString() : null
  snapshot.sessions = snapshot.sessions.map((session) => {
    if (session.id !== sessionId) {
      return session
    }
    updatedSession = { ...session, isArchived, archivedAt }
    return updatedSession
  })
  if (!updatedSession) {
    return null
  }
  scheduleWrite()
  return updatedSession
}
