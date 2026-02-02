import type { ChatMessage, ChatSession } from '../types'

const STORAGE_KEY = 'hamster-nest.chat-data.v1'

type StorageSnapshot = {
  sessions: ChatSession[]
  messages: ChatMessage[]
}

const createId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`

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

const writeSnapshot = (snapshot: StorageSnapshot) => {
  if (typeof localStorage === 'undefined') {
    return
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
}

const sortSessions = (sessions: ChatSession[]) =>
  [...sessions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )

const sortMessages = (messages: ChatMessage[]) =>
  [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )

export const loadSnapshot = (): StorageSnapshot => {
  const snapshot = readSnapshot()
  return {
    sessions: sortSessions(snapshot.sessions),
    messages: sortMessages(snapshot.messages),
  }
}

export const createSession = (title?: string): ChatSession => {
  const snapshot = readSnapshot()
  const now = new Date().toISOString()
  const session: ChatSession = {
    id: createId(),
    title: title ?? 'New chat',
    createdAt: now,
    updatedAt: now,
  }
  const sessions = sortSessions([...snapshot.sessions, session])
  writeSnapshot({ ...snapshot, sessions })
  return session
}

export const renameSession = (sessionId: string, title: string): ChatSession | null => {
  const snapshot = readSnapshot()
  let updatedSession: ChatSession | null = null
  const sessions = snapshot.sessions.map((session) => {
    if (session.id !== sessionId) {
      return session
    }
    updatedSession = { ...session, title }
    return updatedSession
  })
  if (!updatedSession) {
    return null
  }
  writeSnapshot({ ...snapshot, sessions })
  return updatedSession
}

export const addMessage = (
  sessionId: string,
  role: ChatMessage['role'],
  content: string,
  meta?: ChatMessage['meta'],
): { message: ChatMessage; session: ChatSession } | null => {
  const snapshot = readSnapshot()
  const now = new Date().toISOString()
  const sessionIndex = snapshot.sessions.findIndex((session) => session.id === sessionId)
  if (sessionIndex === -1) {
    return null
  }
  const message: ChatMessage = {
    id: createId(),
    sessionId,
    role,
    content,
    createdAt: now,
    meta,
  }
  const sessions = [...snapshot.sessions]
  const updatedSession = { ...sessions[sessionIndex], updatedAt: now }
  sessions[sessionIndex] = updatedSession
  const messages = [...snapshot.messages, message]
  writeSnapshot({ sessions, messages })
  return { message, session: updatedSession }
}

export const deleteMessage = (messageId: string) => {
  const snapshot = readSnapshot()
  const messages = snapshot.messages.filter((message) => message.id !== messageId)
  writeSnapshot({ ...snapshot, messages })
}

export const deleteSession = (sessionId: string) => {
  const snapshot = readSnapshot()
  const sessions = snapshot.sessions.filter((session) => session.id !== sessionId)
  const messages = snapshot.messages.filter((message) => message.sessionId !== sessionId)
  writeSnapshot({ sessions, messages })
}
