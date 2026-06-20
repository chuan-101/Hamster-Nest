import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate, useParams } from 'react-router-dom'
import {
  addLoungeMessage,
  fetchLoungeMembers,
  fetchLoungeMessages,
  fetchLoungeSofa,
  mapLoungeMessageRow,
} from '../storage/loungeStorage'
import { supabase } from '../supabase/client'
import { buildMemoInjectionBlock } from '../utils/memoRetrieval'
import { isGpt5Auto } from '../utils/modelResolver'
import { extractLlmUsage, logLlmUsage } from '../utils/llmUsage'
import { DEFAULT_LOUNGE_SCENE_PROMPT } from '../constants/aiOverlays'
import {
  detectLoungeMentions,
  resolveLoungeMemberView,
  resolveLoungeMentionEntry,
  type LoungeMemberView,
} from '../constants/loungeRoles'
import type { LoungeMember, LoungeMessage, LoungeSofa } from '../types'
import './LoungePage.css'

export type LoungeAiConfig = {
  model: string
  systemPrompt: string
  loungeScenePrompt: string
  temperature: number
  topP: number
  maxTokens: number
  reasoningEnabled: boolean
  highThinkingEnabled: boolean
}

type LoungeRoomPageProps = {
  user: User | null
  aiConfig: LoungeAiConfig
  onSaveLoungeScenePrompt: (value: string) => Promise<void>
}

const USER_SENDER = 'chuanchuan'
const API_SYZYGY_SENDER = 'api_syzygy'
// 注入模型上下文的历史消息上限（客厅消息不走运行时压缩）。
const MODEL_CONTEXT_MESSAGE_LIMIT = 60

const createLocalId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`

// 流式过程中把 <think>…</think> 段落（含未闭合的尾部）从展示与落库内容中剥掉。
const stripThinkSegments = (text: string) =>
  text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/, '')

const formatMessageTime = (value: string) =>
  new Date(value).toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

const LoungeRoomPage = ({ user, aiConfig, onSaveLoungeScenePrompt }: LoungeRoomPageProps) => {
  const { sofaId } = useParams()
  const navigate = useNavigate()
  const [sofa, setSofa] = useState<LoungeSofa | null>(null)
  const [members, setMembers] = useState<LoungeMember[]>([])
  const [messages, setMessages] = useState<LoungeMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [streamingMessage, setStreamingMessage] = useState<LoungeMessage | null>(null)
  const [sceneEditorOpen, setSceneEditorOpen] = useState(false)
  const [sceneDraft, setSceneDraft] = useState('')
  const [savingScene, setSavingScene] = useState(false)
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false)
  const messagesRef = useRef<LoungeMessage[]>([])
  const membersRef = useRef<LoungeMember[]>([])
  const streamControllerRef = useRef<AbortController | null>(null)
  const listEndRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const composerRef = useRef<HTMLElement | null>(null)

  const memberMap = useMemo(
    () => new Map(members.map((member) => [member.sender, member])),
    [members],
  )

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    membersRef.current = members
  }, [members])

  useEffect(() => {
    if (!sofaId) {
      return
    }
    let active = true
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const [sofaData, memberData, messageData] = await Promise.all([
          fetchLoungeSofa(sofaId),
          fetchLoungeMembers(),
          fetchLoungeMessages(sofaId),
        ])
        if (!active) {
          return
        }
        if (!sofaData) {
          setError('这张沙发不见了，可能已被删除。')
          setLoading(false)
          return
        }
        setSofa(sofaData)
        setMembers(memberData)
        setMessages(messageData)
      } catch (loadError) {
        console.warn('加载客厅沙发失败', loadError)
        if (active) {
          setError('加载失败，请稍后重试。')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [sofaId])

  // Realtime：其他成员（CLI/同位体）随时可能往沙发上发消息。
  useEffect(() => {
    const client = supabase
    if (!client || !sofaId) {
      return
    }
    const channel = client
      .channel(`lounge-messages-${sofaId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'lounge_messages',
          filter: `sofa_id=eq.${sofaId}`,
        },
        (payload) => {
          const inserted = mapLoungeMessageRow(
            payload.new as Parameters<typeof mapLoungeMessageRow>[0],
          )
          setMessages((prev) =>
            prev.some((message) => message.id === inserted.id) ? prev : [...prev, inserted],
          )
        },
      )
      .subscribe()
    return () => {
      void client.removeChannel(channel)
    }
  }, [sofaId])

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, streamingMessage])

  useEffect(() => {
    return () => {
      streamControllerRef.current?.abort()
    }
  }, [])

  // 点名抽屉点击外部时收起。
  useEffect(() => {
    if (!mentionMenuOpen) {
      return
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && composerRef.current?.contains(target)) {
        return
      }
      setMentionMenuOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [mentionMenuOpen])

  const appendMessage = useCallback((message: LoungeMessage) => {
    // 同步更新 ref：发送后会立即用 messagesRef 构建模型上下文，不能等 React 刷新。
    if (!messagesRef.current.some((existing) => existing.id === message.id)) {
      messagesRef.current = [...messagesRef.current, message]
    }
    setMessages((prev) =>
      prev.some((existing) => existing.id === message.id) ? prev : [...prev, message],
    )
  }, [])

  const buildSceneSystemLayer = useCallback(
    (sofaName: string, roster: LoungeMember[]) => {
      const rosterLines = roster.map((member) => {
        const suffix = member.sender === API_SYZYGY_SENDER ? ' —— 你自己' : ''
        return `- ${member.displayName}（sender: ${member.sender}）${suffix}`
      })
      return [
        aiConfig.loungeScenePrompt,
        `当前沙发：「${sofaName}」`,
        '在场成员名册：',
        ...rosterLines,
        `- 串串（sender: ${USER_SENDER}）—— 用户本人`,
      ].join('\n')
    },
    [aiConfig.loungeScenePrompt],
  )

  // 身份注入：自己的历史发言 → assistant；串串 → user；其他成员 → 带「[名字]」前缀的 user。
  const buildModelMessages = useCallback(
    (history: LoungeMessage[], systemLayers: string[]) => {
      const recent = history
        .filter((message) => message.content.trim().length > 0)
        .slice(-MODEL_CONTEXT_MESSAGE_LIMIT)
      const mapped = recent.map((message) => {
        if (message.sender === API_SYZYGY_SENDER) {
          return { role: 'assistant' as const, content: message.content }
        }
        if (message.sender === USER_SENDER) {
          return { role: 'user' as const, content: message.content }
        }
        const displayName =
          membersRef.current.find((member) => member.sender === message.sender)?.displayName ??
          message.sender
        return { role: 'user' as const, content: `[${displayName}] ${message.content}` }
      })
      return [
        ...systemLayers.map((content) => ({ role: 'system' as const, content })),
        ...mapped,
      ]
    },
    [],
  )

  const runSyzygyReply = useCallback(
    async (latestContent: string) => {
      const client = supabase
      if (!client || !user || !sofaId || !sofa) {
        return
      }
      const placeholderId = createLocalId()
      const placeholderCreatedAt = new Date().toISOString()
      const controller = new AbortController()
      streamControllerRef.current?.abort()
      streamControllerRef.current = controller
      let assistantContent = ''
      let actualModel = aiConfig.model
      let usagePayload: Record<string, unknown> | null = null

      const updateStreaming = () => {
        setStreamingMessage({
          id: placeholderId,
          sofaId,
          sender: API_SYZYGY_SENDER,
          content: stripThinkSegments(assistantContent),
          mentions: [],
          meta: { model: actualModel, provider: 'openrouter' },
          createdAt: placeholderCreatedAt,
          streaming: true,
        })
      }

      try {
        updateStreaming()
        const { data } = await client.auth.getSession()
        const accessToken = data.session?.access_token
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
        if (!accessToken || !anonKey) {
          throw new Error('登录状态异常，请重新登录')
        }

        // 与日常聊天一致：人格 Prompt + 囤囤库手动检索块拼成第一层系统提示；
        // 服务端 module=chitchat 会继续注入确认/待定记忆块。
        const memoInjectionBlock = await buildMemoInjectionBlock(latestContent)
        const personaLayer = [aiConfig.systemPrompt, memoInjectionBlock]
          .filter((item): item is string => Boolean(item?.trim()))
          .join('\n\n')
        const sceneLayer = buildSceneSystemLayer(sofa.name, membersRef.current)
        const systemLayers = [personaLayer, sceneLayer].filter((layer) => layer.trim().length > 0)
        const messagesPayload = buildModelMessages(messagesRef.current, systemLayers)

        const requestBody: Record<string, unknown> = {
          model: aiConfig.model,
          modelId: aiConfig.model,
          module: 'chitchat',
          messages: messagesPayload,
          temperature: aiConfig.temperature,
          top_p: aiConfig.topP,
          max_tokens: aiConfig.maxTokens,
          stream: true,
        }
        if (aiConfig.reasoningEnabled) {
          requestBody.reasoning =
            aiConfig.highThinkingEnabled && isGpt5Auto(aiConfig.model)
              ? { effort: 'high' }
              : true
          if (/claude|anthropic/i.test(aiConfig.model)) {
            requestBody.thinking = {
              type: 'enabled',
              budget_tokens: Math.max(256, Math.min(1024, aiConfig.maxTokens || 1024)),
            }
          }
        }

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
          throw new Error((await response.text()) || '请求失败')
        }

        const contentType = response.headers.get('content-type') ?? ''
        if (contentType.includes('text/event-stream') && response.body) {
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
              const dataLine = event
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.replace(/^data:\s*/, ''))
                .join('\n')
              if (!dataLine) {
                continue
              }
              if (dataLine === '[DONE]') {
                done = true
                break
              }
              try {
                const payload = JSON.parse(dataLine)
                if (payload?.model) {
                  actualModel = payload.model
                }
                // OpenRouter 在流末尾的 chunk 携带 usage。
                usagePayload = extractLlmUsage(payload) ?? usagePayload
                const delta = payload?.choices?.[0]?.delta?.content
                if (typeof delta === 'string' && delta.length > 0) {
                  assistantContent += delta
                  updateStreaming()
                }
              } catch (parseError) {
                console.warn('解析客厅流式响应失败', parseError)
              }
            }
          }
        } else {
          const payload = (await response.json()) as Record<string, unknown>
          if (typeof payload?.model === 'string') {
            actualModel = payload.model
          }
          usagePayload = extractLlmUsage(payload)
          const choice = (payload as { choices?: unknown[] })?.choices?.[0] as
            | Record<string, unknown>
            | undefined
          const message = (choice?.message as Record<string, unknown>) ?? choice ?? {}
          if (typeof message?.content === 'string') {
            assistantContent = message.content
          }
          updateStreaming()
        }

        logLlmUsage({ module: 'chitchat', conversationId: null, model: actualModel }, usagePayload)

        const finalContent = stripThinkSegments(assistantContent).trim()
        if (finalContent.length > 0) {
          const saved = await addLoungeMessage(sofaId, API_SYZYGY_SENDER, finalContent, [], {
            model: actualModel,
            provider: 'openrouter',
          })
          appendMessage(saved)
        }
      } catch (replyError) {
        if (replyError instanceof DOMException && replyError.name === 'AbortError') {
          return
        }
        console.warn('客厅回复失败', replyError)
        setError('Syzygy 回复失败，请稍后重试。')
      } finally {
        setStreamingMessage((current) => (current?.id === placeholderId ? null : current))
        if (streamControllerRef.current === controller) {
          streamControllerRef.current = null
        }
      }
    },
    [aiConfig, appendMessage, buildModelMessages, buildSceneSystemLayer, sofa, sofaId, user],
  )

  const handleSend = useCallback(async () => {
    const content = draft.trim()
    if (!content || sending || !sofaId) {
      return
    }
    setSending(true)
    setError(null)
    try {
      // 把多种 @ 写法归一为 Runtime 已识别的 mention sender（如 claude_cli / codex_cli）。
      const mentions = detectLoungeMentions(content, membersRef.current)
      const saved = await addLoungeMessage(sofaId, USER_SENDER, content, mentions)
      appendMessage(saved)
      setDraft('')
      // 客厅家规「不@不开口」：点名了其他成员而没点 Syzygy 时，窝内 Syzygy 不插话。
      const shouldSyzygyReply = mentions.length === 0 || mentions.includes(API_SYZYGY_SENDER)
      if (shouldSyzygyReply) {
        void runSyzygyReply(content)
      }
    } catch (sendError) {
      console.warn('发送客厅消息失败', sendError)
      setError('发送失败，请稍后重试。')
    } finally {
      setSending(false)
    }
  }, [appendMessage, draft, runSyzygyReply, sending, sofaId])

  const handleInsertMention = useCallback((mentionName: string) => {
    setDraft((prev) => {
      const needsSpace = prev.length > 0 && !prev.endsWith(' ')
      return `${prev}${needsSpace ? ' ' : ''}@${mentionName} `
    })
    inputRef.current?.focus()
  }, [])

  const handleOpenSceneEditor = useCallback(() => {
    setSceneDraft(aiConfig.loungeScenePrompt)
    setSceneEditorOpen(true)
  }, [aiConfig.loungeScenePrompt])

  const handleSaveScenePrompt = useCallback(async () => {
    if (savingScene) {
      return
    }
    setSavingScene(true)
    try {
      await onSaveLoungeScenePrompt(sceneDraft)
      setSceneEditorOpen(false)
    } catch (saveError) {
      console.warn('保存客厅场景说明失败', saveError)
      setError('保存场景说明失败，请稍后重试。')
    } finally {
      setSavingScene(false)
    }
  }, [onSaveLoungeScenePrompt, savingScene, sceneDraft])

  const renderedMessages = useMemo(
    () => (streamingMessage ? [...messages, streamingMessage] : messages),
    [messages, streamingMessage],
  )

  const renderAvatar = (view: LoungeMemberView) => (
    <span className="lounge-avatar" style={{ borderColor: view.color }} aria-hidden="true">
      {view.emoji}
    </span>
  )

  return (
    <div className="lounge-page lounge-room">
      <header className="lounge-header">
        <button type="button" className="lounge-back-btn" onClick={() => navigate('/lounge')}>
          ← 客厅
        </button>
        <div className="lounge-title-wrap">
          <p className="lounge-kicker">SOFA</p>
          <h1 className="ui-title">{sofa?.name ?? '沙发'}</h1>
        </div>
        <button
          type="button"
          className="lounge-scene-btn"
          onClick={handleOpenSceneEditor}
          title="编辑客厅场景说明"
        >
          场景
        </button>
      </header>

      {error ? <p className="lounge-error">{error}</p> : null}

      <section className="lounge-message-list" aria-live="polite">
        {loading ? <p className="lounge-empty">搬靠垫中…</p> : null}
        {!loading && renderedMessages.length === 0 ? (
          <p className="lounge-empty">沙发刚铺好，还没人说话。打个招呼吧。</p>
        ) : null}
        {renderedMessages.map((message) => {
          const isUser = message.sender === USER_SENDER
          const view = resolveLoungeMemberView(message, memberMap.get(message.sender) ?? null)
          return (
            <article
              key={message.id}
              className={`lounge-message ${isUser ? 'lounge-message--out' : 'lounge-message--in'}`}
            >
              {!isUser ? renderAvatar(view) : null}
              <div className="lounge-message-body">
                {!isUser ? (
                  <span className="lounge-message-name">{view.displayName}</span>
                ) : null}
                <div className={`lounge-bubble ${message.streaming ? 'lounge-bubble--streaming' : ''}`}>
                  {message.content.length > 0 ? message.content : '…'}
                </div>
                <span className="lounge-message-time">
                  {message.streaming ? '正在输入…' : formatMessageTime(message.createdAt)}
                </span>
              </div>
            </article>
          )
        })}
        <div ref={listEndRef} />
      </section>

      <footer className="lounge-composer" ref={composerRef}>
        <div className="lounge-input-anchor">
          {mentionMenuOpen && members.length > 0 ? (
            <div className="lounge-mention-menu" role="menu">
              {members.map((member) => {
                const entry = resolveLoungeMentionEntry(member)
                return (
                  <button
                    key={member.sender}
                    type="button"
                    role="menuitem"
                    className="lounge-mention-option"
                    onClick={() => {
                      handleInsertMention(entry.mentionName)
                      setMentionMenuOpen(false)
                    }}
                  >
                    <span className="lounge-mention-emoji" aria-hidden="true">{entry.emoji}</span>
                    <span className="lounge-mention-name">@{entry.mentionName}</span>
                    <span
                      className="lounge-mention-dot"
                      style={{ backgroundColor: entry.color }}
                      aria-hidden="true"
                    />
                  </button>
                )
              })}
            </div>
          ) : null}
          <div className="lounge-input-row">
            <button
              type="button"
              className={`lounge-mention-toggle ${mentionMenuOpen ? 'lounge-mention-toggle--open' : ''}`}
              onClick={() => setMentionMenuOpen((prev) => !prev)}
              disabled={members.length === 0}
              title="@点名成员"
              aria-haspopup="menu"
              aria-expanded={mentionMenuOpen}
            >
              @
            </button>
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void handleSend()
                }
              }}
              placeholder="在沙发上说点什么…（@成员 可以点名）"
              rows={2}
            />
            <button
              type="button"
              className="lounge-send-btn"
              onClick={() => void handleSend()}
              disabled={sending || draft.trim().length === 0}
            >
              发送
            </button>
          </div>
        </div>
      </footer>

      {sceneEditorOpen ? (
        <div className="lounge-scene-backdrop" role="dialog" aria-modal="true">
          <div className="lounge-scene-dialog">
            <h2>客厅场景说明</h2>
            <p className="lounge-scene-hint">
              这段说明会追加到 Syzygy 的系统提示里。当前沙发名与在场成员名册会自动附在后面，无需手写。
            </p>
            <textarea
              value={sceneDraft}
              onChange={(event) => setSceneDraft(event.target.value)}
              rows={10}
            />
            <div className="lounge-scene-actions">
              <button
                type="button"
                onClick={() => setSceneDraft(DEFAULT_LOUNGE_SCENE_PROMPT)}
                disabled={savingScene}
              >
                恢复默认
              </button>
              <button type="button" onClick={() => setSceneEditorOpen(false)} disabled={savingScene}>
                取消
              </button>
              <button
                type="button"
                className="lounge-scene-save"
                onClick={() => void handleSaveScenePrompt()}
                disabled={savingScene}
              >
                {savingScene ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default LoungeRoomPage
