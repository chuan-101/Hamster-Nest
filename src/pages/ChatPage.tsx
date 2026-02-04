import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage, ChatSession } from '../types'
import ConfirmDialog from '../components/ConfirmDialog'
import ReasoningPanel from '../components/ReasoningPanel'
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
  isStreaming,
  onStopStreaming,
  enabledModels,
  defaultModel,
  onSelectModel,
  defaultReasoning,
  onSelectReasoning,
}: ChatPageProps) => {
  const [draft, setDraft] = useState('')
  const [openActionsId, setOpenActionsId] = useState<string | null>(null)
  const [openHeaderMenu, setOpenHeaderMenu] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ChatMessage | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const headerMenuRef = useRef<HTMLDivElement | null>(null)
  const navigate = useNavigate()

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed) {
      return
    }
    await onSendMessage(trimmed)
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
                  navigate('/settings')
                }}
              >
                API设置
              </button>
            </div>
          ) : null}
        </div>
      </header>
      <main className="chat-messages">
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
                {message.meta?.reasoning?.trim() ? (
                  <ReasoningPanel reasoning={message.meta.reasoning} />
                ) : null}
                {message.role === 'assistant' ? (
                  <div className="assistant-markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.content}
                    </ReactMarkdown>
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
