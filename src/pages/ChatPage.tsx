import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import type { ChatMessage, ChatSession, ChatTimelineItem, LetterEntry } from '../types'
import ConfirmDialog from '../components/ConfirmDialog'
import MarkdownRenderer from '../components/MarkdownRenderer'
import ReasoningPanel from '../components/ReasoningPanel'
import { fetchLettersByConversation } from '../storage/supabaseSync'
import './ChatPage.css'

export type ChatPageProps = {
  session: ChatSession
  messages: ChatMessage[]
  theme?: 'ios' | 'pixel'
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
  onReturnToGame?: () => void
}

const formatTime = (timestamp: string) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

const normalizeMessageSortTime = (message: ChatMessage) => message.clientCreatedAt ?? message.createdAt

const buildLetterPreview = (content: string) => {
  const compact = content.replace(/\s+/g, ' ').trim()
  if (compact.length <= 50) {
    return compact
  }
  return `${compact.slice(0, 50)}…`
}

const MESSAGE_ACTIONS_MENU_WIDTH = 140
const MESSAGE_ACTIONS_MENU_HEIGHT = 84
const VIEWPORT_MARGIN = 12
const POPOVER_GAP = 6

const ChatPage = ({
  session,
  messages,
  theme = 'ios',
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
  onReturnToGame,
}: ChatPageProps) => {
  const [draft, setDraft] = useState('')
  const [openActionsId, setOpenActionsId] = useState<string | null>(null)
  const [actionsMenuPosition, setActionsMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const [openHeaderMenu, setOpenHeaderMenu] = useState(false)
  const [headerMenuPosition, setHeaderMenuPosition] = useState({ top: 0, right: 0 })
  const [pendingDelete, setPendingDelete] = useState<ChatMessage | null>(null)
  const [letters, setLetters] = useState<LetterEntry[]>([])
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const actionsMenuRef = useRef<HTMLDivElement | null>(null)
  const actionTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const headerMenuRef = useRef<HTMLDivElement | null>(null)
  const headerMenuButtonRef = useRef<HTMLButtonElement | null>(null)
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


  useEffect(() => {
    let active = true
    const loadLetters = async () => {
      try {
        const linkedLetters = await fetchLettersByConversation(session.id)
        if (!active) {
          return
        }
        setLetters(linkedLetters)
      } catch (error) {
        console.warn('无法加载关联来信', error)
        if (active) {
          setLetters([])
        }
      }
    }
    void loadLetters()
    return () => {
      active = false
    }
  }, [session.id])

  const timelineItems = useMemo<ChatTimelineItem[]>(() => {
    const messageItems: ChatTimelineItem[] = messages.map((message) => ({
      type: 'message',
      id: message.id,
      sortTime: normalizeMessageSortTime(message),
      message,
    }))
    const letterItems: ChatTimelineItem[] = letters.map((letter) => ({
      type: 'letter',
      id: letter.id,
      sortTime: letter.createdAt,
      letter,
    }))
    return [...messageItems, ...letterItems].sort((a, b) => {
      const primary = new Date(a.sortTime).getTime() - new Date(b.sortTime).getTime()
      if (primary !== 0) {
        return primary
      }
      if (a.type === 'message' && b.type === 'message') {
        return new Date(a.message.createdAt).getTime() - new Date(b.message.createdAt).getTime()
      }
      if (a.type === 'letter' && b.type === 'letter') {
        return new Date(a.letter.createdAt).getTime() - new Date(b.letter.createdAt).getTime()
      }
      return a.type === 'message' ? -1 : 1
    })
  }, [letters, messages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [timelineItems.length])

  useEffect(() => {
    document.body.classList.add('chat-page-active')
    return () => {
      document.body.classList.remove('chat-page-active')
    }
  }, [])

  useEffect(() => {
    if (!openActionsId) {
      setActionsMenuPosition(null)
      return
    }

    const updateActionsMenuPosition = () => {
      const trigger = actionTriggerRefs.current[openActionsId]
      if (!trigger) {
        setActionsMenuPosition(null)
        return
      }

      const triggerRect = trigger.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      let left = triggerRect.right - MESSAGE_ACTIONS_MENU_WIDTH
      left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(left, viewportWidth - MESSAGE_ACTIONS_MENU_WIDTH - VIEWPORT_MARGIN),
      )

      let top = triggerRect.bottom + POPOVER_GAP
      if (top + MESSAGE_ACTIONS_MENU_HEIGHT > viewportHeight - VIEWPORT_MARGIN) {
        top = triggerRect.top - MESSAGE_ACTIONS_MENU_HEIGHT - POPOVER_GAP
      }
      top = Math.max(
        VIEWPORT_MARGIN,
        Math.min(top, viewportHeight - MESSAGE_ACTIONS_MENU_HEIGHT - VIEWPORT_MARGIN),
      )

      setActionsMenuPosition({ top, left })
    }

    updateActionsMenuPosition()

    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node
      const trigger = actionTriggerRefs.current[openActionsId]
      if (trigger?.contains(target) || actionsMenuRef.current?.contains(target)) {
        return
      }
      setOpenActionsId(null)
    }

    window.addEventListener('resize', updateActionsMenuPosition)
    window.addEventListener('scroll', updateActionsMenuPosition, true)
    document.addEventListener('click', handleClick)

    return () => {
      window.removeEventListener('resize', updateActionsMenuPosition)
      window.removeEventListener('scroll', updateActionsMenuPosition, true)
      document.removeEventListener('click', handleClick)
    }
  }, [openActionsId])

  useEffect(() => {
    if (!openHeaderMenu) {
      return
    }

    const updateHeaderMenuPosition = () => {
      const triggerRect = headerMenuButtonRef.current?.getBoundingClientRect()
      if (!triggerRect) {
        return
      }
      setHeaderMenuPosition({
        top: triggerRect.bottom + 6,
        right: Math.max(window.innerWidth - triggerRect.right, 12),
      })
    }

    updateHeaderMenuPosition()
    window.addEventListener('resize', updateHeaderMenuPosition)
    window.addEventListener('scroll', updateHeaderMenuPosition, true)

    return () => {
      window.removeEventListener('resize', updateHeaderMenuPosition)
      window.removeEventListener('scroll', updateHeaderMenuPosition, true)
    }
  }, [openHeaderMenu])

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
    <div
      className={`chat-page chat-page--${theme}${theme === 'ios' ? ' chat-polka-dots' : ''}`}
      data-theme={theme}
    >
      <header className="chat-header top-nav app-shell__header">
        <button type="button" className="ghost" onClick={onOpenDrawer}>
          会话
        </button>
        <div className="header-title">
          <h1 className="ui-title">{session.title}</h1>
          <span className="subtitle">单聊</span>
        </div>
        <div className="header-actions" ref={headerMenuRef}>
          {onReturnToGame ? (
            <button type="button" className="ghost return-to-game-button" onClick={onReturnToGame}>
              Return to Game
            </button>
          ) : null}
          <button
            ref={headerMenuButtonRef}
            type="button"
            className="ghost"
            onClick={(event) => {
              event.stopPropagation()
              setOpenHeaderMenu((current) => !current)
            }}
          >
            聊天操作
          </button>
          {openHeaderMenu
            ? createPortal(
                <div
                  className="header-menu"
                  style={{ top: `${headerMenuPosition.top}px`, right: `${headerMenuPosition.right}px` }}
                >
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
                      navigate('/rp')
                    }}
                  >
                    跑跑滚轮
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
                  <button
                    type="button"
                    onClick={() => {
                      setOpenHeaderMenu(false)
                      navigate('/export')
                    }}
                  >
                    数据导出
                  </button>
                </div>,
                document.body,
              )
            : null}
        </div>
      </header>
      <main className="chat-messages glass-panel">
        {timelineItems.length === 0 ? (
          <div className="empty-state">
            <p>暂无消息，开始聊点什么吧。</p>
          </div>
        ) : (
          timelineItems.map((item) => {
            if (item.type === 'letter') {
              return (
                <div key={`letter-${item.id}`} className="timeline-letter-card">
                  <div className="timeline-letter-card__header">
                    <span className="timeline-letter-card__avatar" aria-hidden="true">
                      💌
                    </span>
                    <div className="timeline-letter-card__meta">
                      <span className="timeline-letter-card__model">{item.letter.model}</span>
                      <span className="timeline-letter-card__time">{formatTime(item.letter.createdAt)}</span>
                    </div>
                  </div>
                  <p className="timeline-letter-card__preview">{buildLetterPreview(item.letter.content)}</p>
                  <button
                    type="button"
                    className="timeline-letter-card__action"
                    onClick={() =>
                      navigate('/letters', {
                        state: { openLetterId: item.letter.id },
                      })
                    }
                  >
                    查看来信
                  </button>
                </div>
              )
            }

            const message = item.message
            return (
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
                  {message.role === 'assistant' && message.meta?.model ? (
                    <div className="message-footer">
                      <span className="model-tag">
                        {message.meta.model === 'mock-model' ? '模拟模型' : message.meta.model}
                      </span>
                    </div>
                  ) : null}
                </div>
                <div className="bubble-meta">
                  <span className="timestamp">{formatTime(message.createdAt)}</span>
                  <div className="message-actions">
                    <button
                      ref={(node) => {
                        actionTriggerRefs.current[message.id] = node
                      }}
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
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </main>
      {openActionsId && actionsMenuPosition
        ? createPortal(
            <div
              className="actions-menu actions-menu-portal"
              role="menu"
              style={{ top: actionsMenuPosition.top, left: actionsMenuPosition.left }}
              ref={actionsMenuRef}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const targetMessage = messages.find((message) => message.id === openActionsId)
                  if (targetMessage) {
                    void handleCopy(targetMessage)
                  }
                }}
              >
                复制
              </button>
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => {
                  const targetMessage = messages.find((message) => message.id === openActionsId)
                  if (targetMessage) {
                    handleDelete(targetMessage)
                  }
                }}
              >
                删除
              </button>
            </div>,
            document.body,
          )
        : null}
      <form className="chat-composer glass-card" onSubmit={handleSubmit}>
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
            <span className="chip-label">模型</span>
            <span className="chip-value" title={selectedModel}>
              {selectedModel}
            </span>
            <span className="chip-chevron" aria-hidden="true">
              ˅
            </span>
            <select
              aria-label="选择模型"
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
        <span className="model-hint">
          当前模型：{selectedModel}
          {hasOverride ? '（会话覆盖）' : '（默认）'}
        </span>
        <div className="composer-row">
          <textarea
            className="textarea-glass"
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
          <button type="submit" className="btn-primary">
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
