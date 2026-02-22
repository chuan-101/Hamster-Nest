import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import ChatPage from './pages/ChatPage'
import AuthPage from './pages/AuthPage'
import SessionsDrawer from './components/SessionsDrawer'
import type { ChatMessage, ChatSession, ExtractMessageInput, UserSettings } from './types'
import {
  createSession,
  deleteMessage,
  deleteSession,
  loadSnapshot,
  renameSession,
  setSessionArchiveState,
  setSnapshot,
  updateSessionOverride,
  updateSessionReasoningOverride,
} from './storage/chatStorage'
import {
  createDefaultSettings,
  ensureUserSettings,
  saveSnackSystemPrompt,
  saveMemoryAutoExtractEnabled,
  saveMemoryExtractModel,
  saveSyzygyPostSystemPrompt,
  saveSyzygyReplySystemPrompt,
  updateUserSettings,
} from './storage/userSettings'
import { invokeMemoryExtraction } from './storage/memoryExtraction'
import {
  addRemoteMessage,
  createRemoteSession,
  deleteRemoteMessage,
  deleteRemoteSession,
  fetchRemoteMessages,
  fetchRemoteSessions,
  fetchPendingMemoryCount,
  renameRemoteSession,
  updateRemoteSessionArchiveState,
  updateRemoteSessionOverride,
  updateRemoteSessionReasoningOverride,
} from './storage/supabaseSync'
import { supabase } from './supabase/client'
import './App.css'
import SettingsPage from './pages/SettingsPage'
import SnacksPage from './pages/SnacksPage'
import SyzygyFeedPage from './pages/SyzygyFeedPage'
import MemoryVaultPage from './pages/MemoryVaultPage'
import CheckinPage from './pages/CheckinPage'
import ExportPage from './pages/ExportPage'
import RpRoomsPage from './pages/RpRoomsPage'
import RpRoomPage from './pages/RpRoomPage'
import {
  resolveSnackSystemOverlay,
  resolveSyzygyPostPrompt,
  resolveSyzygyReplyPrompt,
} from './constants/aiOverlays'
import { resolveModelId } from './utils/modelResolver'

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

const selectMostRecentSession = (sessions: ChatSession[]) => {
  if (sessions.length === 0) {
    return null
  }
  return sessions.reduce<ChatSession>((latest, session) => {
    const latestTime = new Date(latest.updatedAt ?? latest.createdAt).getTime()
    const sessionTime = new Date(session.updatedAt ?? session.createdAt).getTime()
    return sessionTime > latestTime ? session : latest
  }, sessions[0])
}

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
const AUTO_EXTRACT_USER_TURN_INTERVAL = 12
const AUTO_EXTRACT_COOLDOWN_MS = 10 * 60 * 1000
const MEMORY_EXTRACT_RECENT_MESSAGES = 24
const AUTO_EXTRACT_PENDING_LIMIT = 50

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

const buildOpenAiMessages = (
  sessionId: string,
  messages: ChatMessage[],
  systemPrompt?: string,
) => {
  const trimmedPrompt = systemPrompt?.trim()
  const history = messages
    .filter(
      (message) =>
        message.sessionId === sessionId &&
        message.content.trim().length > 0 &&
        !message.meta?.streaming,
    )
    .map((message) => ({ role: message.role, content: message.content }))
  if (trimmedPrompt) {
    return [{ role: 'system', content: trimmedPrompt }, ...history]
  }
  return history
}

const buildRecentExtractionMessages = (
  sessionId: string,
  messages: ChatMessage[],
  limit: number,
): ExtractMessageInput[] => {
  const scoped = messages
    .filter((message) => message.sessionId === sessionId && message.content.trim().length > 0)
    .sort(
      (a, b) =>
        new Date(a.clientCreatedAt ?? a.createdAt).getTime() -
          new Date(b.clientCreatedAt ?? b.createdAt).getTime() ||
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
  return scoped.slice(-limit).map((message) => ({ role: message.role, content: message.content }))
}

const App = () => {
  const [sessions, setSessions] = useState<ChatSession[]>(initialSnapshot.sessions)
  const [messages, setMessages] = useState<ChatMessage[]>(initialSnapshot.messages)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null)
  const [settingsReady, setSettingsReady] = useState(false)
  const [sessionsReady, setSessionsReady] = useState(false)
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null)
  const sessionsRef = useRef(sessions)
  const messagesRef = useRef(messages)
  const streamingControllerRef = useRef<AbortController | null>(null)
  const settingsRef = useRef<UserSettings | null>(null)
  const autoExtractStateRef = useRef<Record<string, { lastUserCount: number; lastExtractedAt: number }>>({})
  const fallbackSettings = useMemo(
    () => createDefaultSettings(user?.id ?? 'local'),
    [user?.id],
  )
  const activeSettings = userSettings ?? fallbackSettings
  const defaultModelId =
    activeSettings.defaultModel?.trim().length > 0
      ? activeSettings.defaultModel
      : defaultOpenRouterModel
  const enabledModels = useMemo(() => {
    const unique = new Set<string>()
    activeSettings.enabledModels.forEach((model) => unique.add(model))
    unique.add(defaultModelId)
    return Array.from(unique)
  }, [activeSettings.enabledModels, defaultModelId])

  const latestSession = useMemo(() => selectMostRecentSession(sessions), [sessions])
  const feedAiConfigBase = useMemo(() => ({
    reasoning: latestSession?.overrideReasoning ?? activeSettings.enableReasoning,
    temperature: activeSettings.temperature,
    topP: activeSettings.topP,
    maxTokens: activeSettings.maxTokens,
    systemPrompt: activeSettings.systemPrompt,
    snackSystemOverlay: resolveSnackSystemOverlay(activeSettings.snackSystemOverlay),
    syzygyPostSystemPrompt: resolveSyzygyPostPrompt(activeSettings.syzygyPostSystemPrompt),
    syzygyReplySystemPrompt: resolveSyzygyReplyPrompt(activeSettings.syzygyReplySystemPrompt),
  }), [activeSettings, latestSession])
  const snackAiConfig = useMemo(() => ({
    ...feedAiConfigBase,
    model: resolveModelId('snack', { defaultModelId }),
  }), [defaultModelId, feedAiConfigBase])
  const syzygyAiConfig = useMemo(() => ({
    ...feedAiConfigBase,
    model: resolveModelId('syzygy', { defaultModelId }),
  }), [defaultModelId, feedAiConfigBase])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    settingsRef.current = userSettings
  }, [userSettings])

  const applySnapshot = useCallback((nextSessions: ChatSession[], nextMessages: ChatMessage[]) => {
    const orderedSessions = sortSessions(nextSessions)
    const orderedMessages = sortMessages(nextMessages)
    sessionsRef.current = orderedSessions
    messagesRef.current = orderedMessages
    setSessions(orderedSessions)
    setMessages(orderedMessages)
    setSnapshot({ sessions: orderedSessions, messages: orderedMessages })
  }, [])

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
      setUserSettings(null)
      setSettingsReady(true)
      return
    }
    let active = true
    setSettingsReady(false)
    const loadSettings = async () => {
      try {
        const settings = await ensureUserSettings(user.id)
        if (!active) {
          return
        }
        setUserSettings(settings)
      } catch (error) {
        console.warn('无法加载用户设置', error)
        if (!active) {
          return
        }
        setUserSettings(createDefaultSettings(user.id))
      } finally {
        if (active) {
          setSettingsReady(true)
        }
      }
    }
    loadSettings()
    return () => {
      active = false
    }
  }, [authReady, user])

  useEffect(() => {
    if (!authReady) {
      return
    }
    if (!user) {
      const fallback = loadSnapshot()
      applySnapshot(fallback.sessions, fallback.messages)
      setSessionsReady(true)
      return
    }
    let active = true
    const loadRemote = async () => {
      setSessionsReady(false)
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
          setSessionsReady(true)
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

  const resolveSessionModel = useCallback(
    (sessionId: string) => {
      const fallback = createDefaultSettings(user?.id ?? 'local')
      const settings = settingsRef.current ?? fallback
      const baseDefaultModel =
        settings.defaultModel?.trim().length > 0
          ? settings.defaultModel
          : defaultOpenRouterModel
      const selectedModel = sessionsRef.current.find((session) => session.id === sessionId)?.overrideModel ?? null
      return resolveModelId('chitchat', {
        defaultModelId: baseDefaultModel,
        chitchatSelectedModelId: selectedModel,
      })
    },
    [user?.id],
  )

  const resolveSessionReasoning = useCallback((sessionId: string) => {
    const fallback = createDefaultSettings(user?.id ?? 'local')
    const settings = settingsRef.current ?? fallback
    const overrideReasoning = sessionsRef.current.find((session) => session.id === sessionId)
      ?.overrideReasoning
    return overrideReasoning ?? settings.enableReasoning
  }, [user?.id])

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

  const handleSessionOverrideChange = useCallback(
    async (sessionId: string, overrideModel: string | null) => {
      const normalized = overrideModel?.trim().length ? overrideModel.trim() : null
      if (user && supabase) {
        try {
          const updated = await updateRemoteSessionOverride(sessionId, normalized)
          const nextSessions = sessionsRef.current.map((session) =>
            session.id === sessionId ? updated : session,
          )
          applySnapshot(nextSessions, messagesRef.current)
          return
        } catch (error) {
          console.warn('更新云端会话模型失败，已切换本地存储', error)
        }
      }
      const updated = updateSessionOverride(sessionId, normalized)
      if (!updated) {
        return
      }
      setSessions((prev) =>
        prev.map((session) => (session.id === sessionId ? updated : session)),
      )
    },
    [applySnapshot, user],
  )

  const handleSessionReasoningOverrideChange = useCallback(
    async (sessionId: string, overrideReasoning: boolean | null) => {
      if (user && supabase) {
        try {
          const updated = await updateRemoteSessionReasoningOverride(
            sessionId,
            overrideReasoning,
          )
          const nextSessions = sessionsRef.current.map((session) =>
            session.id === sessionId ? updated : session,
          )
          applySnapshot(nextSessions, messagesRef.current)
          return
        } catch (error) {
          console.warn('更新云端会话思考链失败，已切换本地存储', error)
        }
      }
      const updated = updateSessionReasoningOverride(sessionId, overrideReasoning)
      if (!updated) {
        return
      }
      setSessions((prev) =>
        prev.map((session) => (session.id === sessionId ? updated : session)),
      )
    },
    [applySnapshot, user],
  )

  const handleSessionArchiveStateChange = useCallback(
    async (sessionId: string, isArchived: boolean) => {
      if (user && supabase) {
        try {
          const updated = await updateRemoteSessionArchiveState(sessionId, isArchived)
          const nextSessions = sessionsRef.current.map((session) =>
            session.id === sessionId ? updated : session,
          )
          applySnapshot(nextSessions, messagesRef.current)
          return
        } catch (error) {
          console.warn('更新云端会话抽屉状态失败，已切换本地存储', error)
        }
      }
      const updated = setSessionArchiveState(sessionId, isArchived)
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
      const fallbackSettings = createDefaultSettings(user?.id ?? 'local')
      const activeSettings = settingsRef.current ?? fallbackSettings
      const effectiveModel = resolveSessionModel(sessionId)
      const reasoningEnabled = resolveSessionReasoning(sessionId)
      const paramsSnapshot = {
        temperature: activeSettings.temperature,
        top_p: activeSettings.topP,
        max_tokens: activeSettings.maxTokens,
      }
      const systemPrompt = activeSettings.systemPrompt
      const isFirstMessageInSession = !messagesRef.current.some(
        (message) =>
          message.sessionId === sessionId &&
          message.role === 'user' &&
          message.content.trim().length > 0,
      )
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
        meta: {
          model: effectiveModel,
          provider: 'openrouter',
          streaming: true,
          params: paramsSnapshot,
        },
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
        let reasoningContent = ''
        let reasoningType: 'reasoning' | 'thinking' | null = null
        let actualModel = effectiveModel
        let pendingDelta = ''
        let pendingReasoningDelta = ''
        let flushTimer: number | null = null
        let thinkCarry = ''
        let isInThink = false

        const openTag = '<think>'
        const closeTag = '</think>'
        const reasoningFields: Array<{
          key: 'reasoning' | 'thinking' | 'reasoning_content' | 'thinking_content'
          type: 'reasoning' | 'thinking'
        }> = [
          { key: 'reasoning', type: 'reasoning' },
          { key: 'thinking', type: 'thinking' },
          { key: 'reasoning_content', type: 'reasoning' },
          { key: 'thinking_content', type: 'thinking' },
        ]

        const collectReasoningFromObject = (
          source: Record<string, unknown> | null | undefined,
        ) => {
          if (!source) {
            return { text: '', type: null as typeof reasoningType }
          }
          let text = ''
          let type: typeof reasoningType = null
          for (const field of reasoningFields) {
            const value = source[field.key]
            if (typeof value === 'string' && value.length > 0) {
              text += value
              if (!type) {
                type = field.type
              }
            }
          }
          return { text, type }
        }

        const findPartialSuffix = (text: string, tag: string) => {
          const maxLength = Math.min(tag.length - 1, text.length)
          for (let length = maxLength; length > 0; length -= 1) {
            const fragment = tag.slice(0, length)
            if (text.endsWith(fragment)) {
              return fragment
            }
          }
          return ''
        }

        const splitReasoningFromContent = (delta: string) => {
          let text = `${thinkCarry}${delta}`
          thinkCarry = ''
          let contentChunk = ''
          let reasoningChunk = ''

          while (text.length > 0) {
            if (isInThink) {
              const closeIndex = text.indexOf(closeTag)
              if (closeIndex === -1) {
                const partial = findPartialSuffix(text, closeTag)
                const cutoff = text.length - partial.length
                reasoningChunk += text.slice(0, cutoff)
                thinkCarry = partial
                text = ''
              } else {
                reasoningChunk += text.slice(0, closeIndex)
                text = text.slice(closeIndex + closeTag.length)
                isInThink = false
              }
            } else {
              const openIndex = text.indexOf(openTag)
              if (openIndex === -1) {
                const partial = findPartialSuffix(text, openTag)
                const cutoff = text.length - partial.length
                contentChunk += text.slice(0, cutoff)
                thinkCarry = partial
                text = ''
              } else {
                contentChunk += text.slice(0, openIndex)
                text = text.slice(openIndex + openTag.length)
                isInThink = true
              }
            }
          }

          return { contentChunk, reasoningChunk }
        }

        const appendReasoningDelta = (
          text: string,
          type: typeof reasoningType,
          target: 'pending' | 'final' = 'pending',
        ) => {
          if (!text) {
            return
          }
          if (target === 'pending') {
            pendingReasoningDelta += text
          } else {
            reasoningContent += text
          }
          if (!reasoningType && type) {
            reasoningType = type
          }
        }

        const buildAssistantMeta = (streaming: boolean): ChatMessage['meta'] => {
          const meta: ChatMessage['meta'] = {
            model: actualModel,
            provider: 'openrouter',
            streaming,
            params: paramsSnapshot,
          }
          if (reasoningContent) {
            meta.reasoning = reasoningContent
            meta.reasoning_text = reasoningContent
          }
          if (reasoningType) {
            meta.reasoning_type = reasoningType
          }
          return meta
        }

        const flushPending = () => {
          if (!pendingDelta && !pendingReasoningDelta) {
            return
          }
          if (pendingDelta) {
            assistantContent += pendingDelta
            pendingDelta = ''
          }
          if (pendingReasoningDelta) {
            reasoningContent += pendingReasoningDelta
            pendingReasoningDelta = ''
          }
          const streamingUpdate = updateMessage(messagesRef.current, {
            id: assistantClientId,
            sessionId,
            role: 'assistant',
            clientId: assistantClientId,
            content: assistantContent,
            createdAt: assistantClientCreatedAt,
            clientCreatedAt: assistantClientCreatedAt,
            meta: buildAssistantMeta(true),
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
          const messagesPayload = buildOpenAiMessages(
            sessionId,
            messagesRef.current,
            systemPrompt,
          )
          const isClaudeModel = (model: string) => /claude|anthropic/i.test(model)
          const requestBody: Record<string, unknown> = {
            model: effectiveModel,
            modelId: effectiveModel,
            module: 'chitchat',
            conversationId: sessionId,
            messages: messagesPayload,
            temperature: paramsSnapshot.temperature,
            top_p: paramsSnapshot.top_p,
            max_tokens: paramsSnapshot.max_tokens,
            reasoning: reasoningEnabled,
            stream: true,
            isFirstMessage: isFirstMessageInSession,
          }
          if (reasoningEnabled && isClaudeModel(effectiveModel)) {
            const maxTokens = paramsSnapshot.max_tokens ?? 1024
            requestBody.thinking = {
              type: 'enabled',
              budget_tokens: Math.max(256, Math.min(1024, maxTokens)),
            }
          }
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
              body: JSON.stringify(requestBody),
              signal: controller.signal,
            },
          )
          if (!response.ok) {
            const errorText = await response.text()
            throw new Error(errorText || '请求失败')
          }
          const contentType = response.headers.get('content-type') ?? ''
          const isEventStream = contentType.includes('text/event-stream')
          if (!isEventStream) {
            try {
              const payload = (await response.json()) as Record<string, unknown>
              if (typeof payload?.model === 'string') {
                actualModel = payload.model
              }
              const choice = (payload as { choices?: unknown[] })?.choices?.[0] as
                | Record<string, unknown>
                | undefined
              const message = (choice?.message as Record<string, unknown>) ?? choice ?? {}
              const content =
                typeof message?.content === 'string'
                  ? (message.content as string)
                  : typeof (choice as { text?: unknown })?.text === 'string'
                    ? ((choice as { text?: unknown }).text as string)
                    : ''
              if (content) {
                const { contentChunk, reasoningChunk } = splitReasoningFromContent(content)
                assistantContent = contentChunk
                if (reasoningChunk) {
                  appendReasoningDelta(reasoningChunk, 'thinking', 'final')
                }
              }
              const messageReasoning = collectReasoningFromObject(message)
              if (messageReasoning.text) {
                appendReasoningDelta(messageReasoning.text, messageReasoning.type, 'final')
              }
              if (choice && choice !== message) {
                const choiceReasoning = collectReasoningFromObject(choice)
                if (choiceReasoning.text) {
                  appendReasoningDelta(choiceReasoning.text, choiceReasoning.type, 'final')
                }
              }
              if (payload && payload !== choice) {
                const payloadReasoning = collectReasoningFromObject(payload)
                if (payloadReasoning.text) {
                  appendReasoningDelta(payloadReasoning.text, payloadReasoning.type, 'final')
                }
              }
              const { message: assistantMessage, updatedAt } = await addRemoteMessage(
                sessionId,
                user.id,
                'assistant',
                assistantContent,
                assistantClientId,
                assistantClientCreatedAt,
                buildAssistantMeta(false),
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
              console.warn('解析非流式响应失败', error)
              throw error
            }
            return
          }
          if (!response.body) {
            throw new Error('响应体为空')
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
            const events = buffer.split('\n\n')
            buffer = events.pop() ?? ''
            for (const event of events) {
              const data = event
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.replace(/^data:\s*/, ''))
                .join('\n')
              if (!data) {
                continue
              }
              if (data === '[DONE]') {
                done = true
                break
              }
              try {
                const payload = JSON.parse(data)
                const deltaPayload = payload?.choices?.[0]?.delta ?? {}
                const delta = typeof deltaPayload?.content === 'string' ? deltaPayload.content : ''
                if (payload?.model) {
                  actualModel = payload.model
                }
                const explicitReasoning =
                  typeof deltaPayload?.reasoning === 'string' && deltaPayload.reasoning.length > 0
                    ? deltaPayload.reasoning
                    : ''
                if (explicitReasoning) {
                  appendReasoningDelta(explicitReasoning, 'reasoning')
                  scheduleFlush()
                }
                const deltaReasoning = collectReasoningFromObject(
                  deltaPayload as Record<string, unknown>,
                )
                if (deltaReasoning.text && deltaReasoning.text !== explicitReasoning) {
                  appendReasoningDelta(deltaReasoning.text, deltaReasoning.type)
                  scheduleFlush()
                }
                if (delta) {
                  const { contentChunk, reasoningChunk } = splitReasoningFromContent(delta)
                  if (contentChunk) {
                    pendingDelta += contentChunk
                  }
                  if (reasoningChunk) {
                    appendReasoningDelta(reasoningChunk, 'thinking')
                  }
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
            buildAssistantMeta(false),
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
                buildAssistantMeta(false),
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
                meta: buildAssistantMeta(false),
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
            meta: buildAssistantMeta(false),
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
    [applySnapshot, resolveSessionReasoning, resolveSessionModel, user],
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

  const handleSaveSettings = useCallback(async (nextSettings: UserSettings) => {
    if (user && supabase) {
      await updateUserSettings(nextSettings)
    }
    setUserSettings(nextSettings)
  }, [user])

  const handleSaveMemoryExtractModel = useCallback(async (modelId: string | null) => {
    if (!user) {
      return
    }
    const normalizedModel = modelId?.trim() ? modelId.trim() : null
    if (supabase) {
      await saveMemoryExtractModel(user.id, normalizedModel)
    }
    setUserSettings((current) => {
      const base = current ?? createDefaultSettings(user.id)
      return {
        ...base,
        userId: user.id,
        memoryExtractModel: normalizedModel,
        updatedAt: new Date().toISOString(),
      }
    })
  }, [user])

  const handleSaveSnackSystemPrompt = useCallback(async (nextSnackSystemPrompt: string) => {
    if (!user) {
      return
    }
    const nextSettings = {
      ...(settingsRef.current ?? createDefaultSettings(user.id)),
      userId: user.id,
      snackSystemOverlay: nextSnackSystemPrompt,
      updatedAt: new Date().toISOString(),
    }
    if (supabase) {
      await saveSnackSystemPrompt(user.id, nextSnackSystemPrompt)
    }
    setUserSettings(nextSettings)
  }, [user])
  const handleSaveSyzygyPostSystemPrompt = useCallback(async (nextPrompt: string) => {
    if (!user) {
      return
    }
    const nextSettings = {
      ...(settingsRef.current ?? createDefaultSettings(user.id)),
      userId: user.id,
      syzygyPostSystemPrompt: nextPrompt,
      updatedAt: new Date().toISOString(),
    }
    if (supabase) {
      await saveSyzygyPostSystemPrompt(user.id, nextPrompt)
    }
    setUserSettings(nextSettings)
  }, [user])

  const handleSaveSyzygyReplySystemPrompt = useCallback(async (nextPrompt: string) => {
    if (!user) {
      return
    }
    const nextSettings = {
      ...(settingsRef.current ?? createDefaultSettings(user.id)),
      userId: user.id,
      syzygyReplySystemPrompt: nextPrompt,
      updatedAt: new Date().toISOString(),
    }
    if (supabase) {
      await saveSyzygyReplySystemPrompt(user.id, nextPrompt)
    }
    setUserSettings(nextSettings)
  }, [user])

  const handleToggleMemoryAutoExtract = useCallback(async (enabled: boolean) => {
    if (!user) {
      return
    }
    const nextSettings = {
      ...(settingsRef.current ?? createDefaultSettings(user.id)),
      userId: user.id,
      memoryAutoExtractEnabled: enabled,
      updatedAt: new Date().toISOString(),
    }
    if (supabase) {
      await saveMemoryAutoExtractEnabled(user.id, enabled)
    }
    setUserSettings(nextSettings)
  }, [user])

  useEffect(() => {
    if (!user || !supabase || isStreaming || !activeSettings.memoryAutoExtractEnabled) {
      return
    }
    const latestBySession = new Map<string, number>()
    messages.forEach((message) => {
      if (message.role !== 'user' || !message.content.trim()) {
        return
      }
      latestBySession.set(message.sessionId, (latestBySession.get(message.sessionId) ?? 0) + 1)
    })

    latestBySession.forEach((userCount, sessionId) => {
      if (userCount < AUTO_EXTRACT_USER_TURN_INTERVAL) {
        return
      }
      if (userCount % AUTO_EXTRACT_USER_TURN_INTERVAL !== 0) {
        return
      }
      const currentState =
        autoExtractStateRef.current[sessionId] ?? { lastUserCount: 0, lastExtractedAt: 0 }
      const now = Date.now()
      if (userCount <= currentState.lastUserCount) {
        return
      }
      if (now - currentState.lastExtractedAt < AUTO_EXTRACT_COOLDOWN_MS) {
        return
      }
      autoExtractStateRef.current[sessionId] = {
        lastUserCount: userCount,
        lastExtractedAt: currentState.lastExtractedAt,
      }
      const recentMessages = buildRecentExtractionMessages(
        sessionId,
        messagesRef.current,
        MEMORY_EXTRACT_RECENT_MESSAGES,
      )
      if (recentMessages.length === 0) {
        return
      }
      void (async () => {
        try {
          const pendingCount = await fetchPendingMemoryCount(user.id)
          if (pendingCount >= AUTO_EXTRACT_PENDING_LIMIT) {
            return
          }
          autoExtractStateRef.current[sessionId] = {
            lastUserCount: userCount,
            lastExtractedAt: Date.now(),
          }
          await invokeMemoryExtraction(recentMessages, activeSettings.memoryMergeEnabled)
        } catch (error) {
          console.warn('自动抽取记忆建议失败', error)
        }
      })()
    })
  }, [activeSettings.memoryAutoExtractEnabled, activeSettings.memoryMergeEnabled, isStreaming, messages, user])


  return (
    <div className="app-shell">
      <Routes>
        <Route path="/auth" element={<AuthPage user={user} />} />
        <Route
          path="/"
          element={
            <RequireAuth ready={authReady} user={user}>
              <NewSessionRedirect
                sessions={sessions}
                sessionsReady={sessionsReady}
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
                sessionsReady={sessionsReady}
                isStreaming={isStreaming}
                onStopStreaming={handleStopStreaming}
                onOpenDrawer={() => setDrawerOpen(true)}
                onCloseDrawer={() => setDrawerOpen(false)}
                onCreateSession={createSessionEntry}
                onRenameSession={renameSessionEntry}
                onSendMessage={sendMessage}
                onDeleteMessage={removeMessage}
                onDeleteSession={removeSession}
                enabledModels={enabledModels}
                defaultModel={defaultModelId}
                onSelectModel={handleSessionOverrideChange}
                defaultReasoning={activeSettings.enableReasoning}
                onSelectReasoning={handleSessionReasoningOverrideChange}
                onArchiveSession={handleSessionArchiveStateChange}
                onActiveSessionChange={setActiveChatSessionId}
                user={user}
              />
            </RequireAuth>
          }
        />
        <Route
          path="/checkin"
          element={
            <RequireAuth ready={authReady} user={user}>
              <CheckinPage user={user} />
            </RequireAuth>
          }
        />
        <Route
          path="/export"
          element={
            <RequireAuth ready={authReady} user={user}>
              <ExportPage user={user} />
            </RequireAuth>
          }
        />
        <Route
          path="/rp"
          element={
            <RequireAuth ready={authReady} user={user}>
              <RpRoomsPage user={user} />
            </RequireAuth>
          }
        />
        <Route
          path="/rp/:sessionId"
          element={
            <RequireAuth ready={authReady} user={user}>
              <RpRoomPage user={user} mode="chat" />
            </RequireAuth>
          }
        />
        <Route
          path="/rp/:sessionId/dashboard"
          element={
            <RequireAuth ready={authReady} user={user}>
              <RpRoomPage user={user} mode="dashboard" />
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth ready={authReady} user={user}>
              <SettingsPage
                user={user}
                settings={userSettings}
                ready={settingsReady}
                onSaveSettings={handleSaveSettings}
                onSaveMemoryExtractModel={handleSaveMemoryExtractModel}
                onSaveSnackSystemPrompt={handleSaveSnackSystemPrompt}
                onSaveSyzygyPostPrompt={handleSaveSyzygyPostSystemPrompt}
                onSaveSyzygyReplyPrompt={handleSaveSyzygyReplySystemPrompt}
              />
            </RequireAuth>
          }
        />
        <Route
          path="/snacks"
          element={
            <RequireAuth ready={authReady} user={user}>
              <SnacksPage user={user} snackAiConfig={snackAiConfig} />
            </RequireAuth>
          }
        />

        <Route
          path="/memory-vault"
          element={
            <RequireAuth ready={authReady} user={user}>
              <MemoryVaultPage
                recentMessages={buildRecentExtractionMessages(
                  activeChatSessionId ?? latestSession?.id ?? '',
                  messages,
                  MEMORY_EXTRACT_RECENT_MESSAGES,
                )}
                autoExtractEnabled={activeSettings.memoryAutoExtractEnabled}
                onToggleAutoExtract={handleToggleMemoryAutoExtract}
              />
            </RequireAuth>
          }
        />
        <Route
          path="/syzygy"
          element={
            <RequireAuth ready={authReady} user={user}>
              <SyzygyFeedPage user={user} snackAiConfig={syzygyAiConfig} />
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
  sessionsReady,
  onCreateSession,
}: {
  sessions: ChatSession[]
  sessionsReady: boolean
  onCreateSession: (title?: string) => Promise<ChatSession>
}) => {
  const navigate = useNavigate()
  const hasInitializedRef = useRef(false)
  useEffect(() => {
    if (hasInitializedRef.current) {
      return
    }
    if (!sessionsReady) {
      return
    }
    hasInitializedRef.current = true
    let active = true
    const create = async () => {
      if (sessions.length > 0) {
        const targetSession = selectMostRecentSession(sessions)
        if (targetSession) {
          navigate(`/chat/${targetSession.id}`, { replace: true })
        }
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
  }, [navigate, onCreateSession, sessions, sessionsReady])
  return null
}

const ChatRoute = ({
  sessions,
  messages,
  messageCounts,
  drawerOpen,
  syncing,
  sessionsReady,
  isStreaming,
  onStopStreaming,
  onOpenDrawer,
  onCloseDrawer,
  onCreateSession,
  onRenameSession,
  onSendMessage,
  onDeleteMessage,
  onDeleteSession,
  enabledModels,
  defaultModel,
  onSelectModel,
  defaultReasoning,
  onSelectReasoning,
  onArchiveSession,
  onActiveSessionChange,
  user,
}: {
  sessions: ChatSession[]
  messages: ChatMessage[]
  messageCounts: Record<string, number>
  drawerOpen: boolean
  syncing: boolean
  sessionsReady: boolean
  isStreaming: boolean
  onStopStreaming: () => void
  onOpenDrawer: () => void
  onCloseDrawer: () => void
  onCreateSession: (title?: string) => Promise<ChatSession>
  onRenameSession: (sessionId: string, title: string) => Promise<void>
  onSendMessage: (sessionId: string, text: string) => Promise<void>
  onDeleteMessage: (messageId: string) => Promise<void>
  onDeleteSession: (sessionId: string) => Promise<void>
  enabledModels: string[]
  defaultModel: string
  onSelectModel: (sessionId: string, model: string | null) => Promise<void>
  defaultReasoning: boolean
  onSelectReasoning: (sessionId: string, reasoning: boolean | null) => Promise<void>
  onArchiveSession: (sessionId: string, isArchived: boolean) => Promise<void>
  onActiveSessionChange: (sessionId: string) => void
  user: User | null
}) => {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const activeSession = sessions.find((session) => session.id === sessionId)

  useEffect(() => {
    if (activeSession) {
      onActiveSessionChange(activeSession.id)
    }
  }, [activeSession, onActiveSessionChange])
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
      const targetSession = selectMostRecentSession(sessions)
      if (targetSession) {
        navigate(`/chat/${targetSession.id}`, { replace: true })
      }
    }
  }, [activeSession, navigate, sessions])

  useEffect(() => {
    if (activeSession || syncing || !sessionsReady || sessions.length > 0) {
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
  }, [activeSession, navigate, onCreateSession, sessions.length, sessionsReady, syncing])

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
        enabledModels={enabledModels}
        defaultModel={defaultModel}
        onSelectModel={(model) => onSelectModel(activeSession.id, model)}
        defaultReasoning={defaultReasoning}
        onSelectReasoning={(reasoning) =>
          onSelectReasoning(activeSession.id, reasoning)
        }
        user={user}
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
        onArchiveSession={onArchiveSession}
      />
    </>
  )
}

export default App
