import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import type { ChatMessage, ChatSession, CheckinEntry } from '../types'
import ConfirmDialog from '../components/ConfirmDialog'
import MarkdownRenderer from '../components/MarkdownRenderer'
import ReasoningPanel from '../components/ReasoningPanel'
import { createTodayCheckin, fetchCheckinTotalCount, fetchRecentCheckins } from '../storage/supabaseSync'
import './ChatPage.css'

export type ChatPageProps = {
  session: ChatSession
  messages: ChatMessage[]
  onOpenDrawer: () => void
  onSendMessage: (text: string) => Promise<void>
  onDeleteMessage: (messageId: string) => void | Promise<void>
  isStreaming: boolean
  onStopStreaming: () => void
  enabledModels: string[]
  defaultModel: string
  onSelectModel: (model: string | null) => void
  defaultReasoning: boolean
  onSelectReasoning: (reasoning: boolean | null) => void
  user: User | null
}

const formatTime = (timestamp: string) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

const formatDateKey = (date: Date) => {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

const shiftDateKey = (dateKey: string, daysDelta: number) => {
  const base = new Date(`${dateKey}T00:00:00`)
  base.setDate(base.getDate() + daysDelta)
  return formatDateKey(base)
}

const computeStreak = (dates: string[], todayKey: string) => {
  const uniqueDates = Array.from(new Set(dates)).sort((a, b) => b.localeCompare(a))
  const dateSet = new Set(uniqueDates)
  const startDate = dateSet.has(todayKey) ? todayKey : shiftDateKey(todayKey, -1)
  if (!dateSet.has(startDate)) {
    return 0
  }

  let streak = 0
  let cursor = startDate
  while (dateSet.has(cursor)) {
    streak += 1
    cursor = shiftDateKey(cursor, -1)
  }
  return streak
}

const ChatPage = ({
  session,
  messages,
  onOpenDrawer,
  onSendMessage,
  onDeleteMessage,
  isStreaming,
  onStopStreaming,
  enabledModels,
  defaultModel,
  onSelectModel,
  defaultReasoning,
  onSelectReasoning,
  user,
}: ChatPageProps) => {
  const [draft, setDraft] = useState('')
  const [openActionsId, setOpenActionsId] = useState<string | null>(null)
  const [openHeaderMenu, setOpenHeaderMenu] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ChatMessage | null>(null)
  const [recentCheckins, setRecentCheckins] = useState<CheckinEntry[]>([])
  const [checkinTotal, setCheckinTotal] = useState(0)
  const [checkinLoading, setCheckinLoading] = useState(false)
  const [checkinSubmitting, setCheckinSubmitting] = useState(false)
  const [checkinNotice, setCheckinNotice] = useState<string | null>(null)
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const headerMenuRef = useRef<HTMLDivElement | null>(null)
  const navigate = useNavigate()

  const submitDraft = async () => {
    const trimmed = draft.trim()
    if (!trimmed) {
      return
    }
    await onSendMessage(trimmed)
    setDraft('')
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    await submitDraft()
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
    return openActionsId ? '关闭操作菜单' : '打开操作菜单'
  }, [openActionsId])

  const sessionOverride = session.overrideModel?.trim() || null
  const selectedModel = sessionOverride ?? defaultModel
  const hasOverride = Boolean(sessionOverride && sessionOverride !== defaultModel)
  const sessionOverrideReasoning = session.overrideReasoning ?? null
  const reasoningEnabled = sessionOverrideReasoning ?? defaultReasoning
  const reasoningHint = sessionOverrideReasoning === null ? '（默认）' : '（会话覆盖）'
  const modelOptions = useMemo(() => {
    const unique = new Set<string>()
    enabledModels.forEach((model) => unique.add(model))
    unique.add(defaultModel)
    if (sessionOverride) {
      unique.add(sessionOverride)
    }
    return Array.from(unique)
  }, [defaultModel, enabledModels, sessionOverride])

  const todayKey = useMemo(() => formatDateKey(new Date()), [])
  const todayDisplay = useMemo(
    () => new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }),
    [],
  )
  const recentDateKeys = useMemo(() => recentCheckins.map((entry) => entry.checkinDate), [recentCheckins])
  const checkedToday = useMemo(() => recentDateKeys.includes(todayKey), [recentDateKeys, todayKey])
  const streakDays = useMemo(() => computeStreak(recentDateKeys, todayKey), [recentDateKeys, todayKey])

  const loadCheckinData = async () => {
    if (!user) {
      return
    }
    setCheckinLoading(true)
    try {
      const [recent, total] = await Promise.all([fetchRecentCheckins(60), fetchCheckinTotalCount()])
      setRecentCheckins(recent)
      setCheckinTotal(total)
    } catch (error) {
      console.warn('加载打卡记录失败', error)
      setCheckinNotice('加载打卡数据失败，请稍后重试。')
    } finally {
      setCheckinLoading(false)
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  useEffect(() => {
    if (!openHeaderMenu) {
      return
    }
    const handleClick = (event: MouseEvent) => {
      if (!headerMenuRef.current) {
        return
      }
      if (headerMenuRef.current.contains(event.target as Node)) {
        return
      }
      setOpenHeaderMenu(false)
    }
    document.addEventListener('click', handleClick)
    return () => {
      document.removeEventListener('click', handleClick)
    }
  }, [openHeaderMenu])


  useEffect(() => {
    void loadCheckinData()
  }, [user])

  const handleCheckin = async () => {
    if (!user || checkinSubmitting) {
      return
    }
    setCheckinSubmitting(true)
    setCheckinNotice(null)
    try {
      const result = await createTodayCheckin(todayKey)
      setCheckinNotice(result === 'created' ? '打卡成功！' : '今日已打卡')
      await loadCheckinData()
    } catch (error) {
      console.warn('打卡失败', error)
      setCheckinNotice('打卡失败，请稍后重试。')
    } finally {
      setCheckinSubmitting(false)
    }
  }

  return (
    <div className="chat-page">
      <header className="chat-header">
        <button type="button" className="ghost" onClick={onOpenDrawer}>
          会话
        </button>
        <div className="header-title">
          <h1>{session.title}</h1>
          <span className="subtitle">单聊</span>
        </div>
        <div className="header-actions" ref={headerMenuRef}>
          <button
            type="button"
            className="ghost"
            onClick={(event) => {
              event.stopPropagation()
              setOpenHeaderMenu((current) => !current)
            }}
          >
            聊天操作
          </button>
          {openHeaderMenu ? (
            <div className="header-menu">
              <button
                type="button"
                onClick={() => {
                  setOpenHeaderMenu(false)
                  navigate('/snacks')
                }}
              >
                零食罐罐
              </button>

              <button
                type="button"
                onClick={() => {
                  setOpenHeaderMenu(false)
                  navigate('/syzygy')
                }}
              >
                仓鼠观察日志
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpenHeaderMenu(false)
                  navigate('/memory-vault')
                }}
              >
                囤囤库
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpenHeaderMenu(false)
                  navigate('/checkin')
                }}
              >
                打卡
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpenHeaderMenu(false)
                  navigate('/settings')
                }}
              >
                设置
              </button>
            </div>
          ) : null}
        </div>
      </header>
      <main className="chat-messages">
        <section className="checkin-card">
          <div className="checkin-header">
            <h2>今日打卡</h2>
            <span>{todayDisplay}</span>
          </div>
          <div className="checkin-status-row">
            <span className={`checkin-status ${checkedToday ? 'done' : 'todo'}`}>
              {checkedToday ? '今日已打卡' : '今日未打卡'}
            </span>
            <button
              type="button"
              className="primary checkin-button"
              onClick={() => void handleCheckin()}
              disabled={!user || checkinSubmitting || checkedToday}
            >
              {checkedToday ? '已打卡' : checkinSubmitting ? '打卡中…' : '打卡'}
            </button>
          </div>
          <div className="checkin-metrics">
            <p>连续打卡：<strong>{streakDays}</strong> 天</p>
            <p>累计打卡：<strong>{checkinTotal}</strong> 次</p>
          </div>
          <button type="button" className="ghost checkin-history-toggle" onClick={() => setHistoryExpanded((v) => !v)}>
            {historyExpanded ? '收起记录' : '查看记录'}
          </button>
          {historyExpanded ? (
            <ul className="checkin-history">
              {recentCheckins.length === 0 ? <li>暂无打卡记录</li> : recentCheckins.map((entry) => <li key={entry.id}>{entry.checkinDate}</li>)}
            </ul>
          ) : null}
          {checkinLoading ? <p className="checkin-tip">打卡数据加载中…</p> : null}
          {checkinNotice ? <p className="checkin-tip">{checkinNotice}</p> : null}
        </section>

        {messages.length === 0 ? (
          <div className="empty-state">
            <p>暂无消息，开始聊点什么吧。</p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`message ${message.role === 'user' ? 'out' : 'in'}`}
            >
              <div className="bubble">
                {(() => {
                  const reasoningText =
                    message.meta?.reasoning_text?.trim() ?? message.meta?.reasoning?.trim()
                  return reasoningText ? <ReasoningPanel reasoning={reasoningText} /> : null
                })()}
                {message.role === 'assistant' ? (
                  <div className="assistant-markdown">
                    <MarkdownRenderer content={message.content} />
                  </div>
                ) : (
                  <p>{message.content}</p>
                )}
                <div className="message-footer">
                  {message.role === 'assistant' && message.meta?.model ? (
                    <span className="model-tag">
                      {message.meta.model === 'mock-model' ? '模拟模型' : message.meta.model}
                    </span>
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
                      复制
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="danger"
                      onClick={() => handleDelete(message)}
                    >
                      删除
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </main>
      <form className="chat-composer" onSubmit={handleSubmit}>
        {isStreaming ? (
          <div className="streaming-status">
            <span>生成中…</span>
            <button type="button" className="ghost stop-button" onClick={onStopStreaming}>
              停止生成
            </button>
          </div>
        ) : null}
        <div className="composer-toolbar">
          <label className="model-selector">
            <span>模型</span>
            <select
              value={selectedModel}
              onChange={(event) => {
                const next = event.target.value
                onSelectModel(next === defaultModel ? null : next)
              }}
            >
              {modelOptions.map((modelId) => (
                <option key={modelId} value={modelId}>
                  {modelId === defaultModel ? `默认：${modelId}` : modelId}
                </option>
              ))}
            </select>
          </label>
          <span className="model-hint">
            当前：{selectedModel}
            {hasOverride ? '（会话覆盖）' : '（默认）'}
          </span>
          <label className="composer-toggle">
            <input
              type="checkbox"
              checked={reasoningEnabled}
              onChange={(event) => onSelectReasoning(event.target.checked)}
            />
            <span>思考链</span>
            <span className="toggle-hint">{reasoningHint}</span>
          </label>
        </div>
        <div className="composer-row">
          <textarea
            placeholder="输入你的消息"
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                return
              }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void submitDraft()
              }
            }}
          />
          <button type="submit" className="primary">
            发送
          </button>
        </div>
      </form>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这条消息？"
        description="此操作会从当前会话中移除这条消息。"
        confirmLabel="删除"
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}

export default ChatPage
