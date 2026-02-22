import { useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate, useParams } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  createRpMessage,
  deleteRpMessage,
  fetchRpMessages,
  fetchRpSessionById,
  updateRpSessionDashboard,
} from '../storage/supabaseSync'
import type { RpMessage, RpSession } from '../types'
import './RpRoomPage.css'

type RpRoomPageProps = {
  user: User | null
  mode?: 'chat' | 'dashboard'
}

const RpRoomPage = ({ user, mode = 'chat' }: RpRoomPageProps) => {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const [room, setRoom] = useState<RpSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [messages, setMessages] = useState<RpMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<RpMessage | null>(null)
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null)
  const [playerDisplayNameInput, setPlayerDisplayNameInput] = useState('串串')
  const [playerAvatarUrlInput, setPlayerAvatarUrlInput] = useState('')
  const [worldbookTextInput, setWorldbookTextInput] = useState('')
  const [savingRoomSettings, setSavingRoomSettings] = useState(false)
  const [savingWorldbook, setSavingWorldbook] = useState(false)
  const playerName = room?.playerDisplayName?.trim() ? room.playerDisplayName.trim() : '串串'
  const isDashboardPage = mode === 'dashboard'
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const resizeComposer = () => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    textarea.style.height = 'auto'
    const nextHeight = Math.min(textarea.scrollHeight, 144)
    textarea.style.height = `${nextHeight}px`
  }

  useEffect(() => {
    const loadRoom = async () => {
      if (!user || !sessionId) {
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const data = await fetchRpSessionById(sessionId, user.id)
        if (!data) {
          setError('房间不存在，或你无权访问该房间。')
          setRoom(null)
          return
        }
        setRoom(data)
      } catch (loadError) {
        console.warn('加载 RP 房间失败', loadError)
        setError('加载房间失败，请稍后重试。')
      } finally {
        setLoading(false)
      }
    }

    void loadRoom()
  }, [sessionId, user])

  useEffect(() => {
    if (!room) {
      return
    }
    setPlayerDisplayNameInput(room.playerDisplayName?.trim() || '串串')
    setPlayerAvatarUrlInput(room.playerAvatarUrl ?? '')
    setWorldbookTextInput(room.worldbookText ?? '')
  }, [room])

  useEffect(() => {
    const loadMessages = async () => {
      if (!user || !room) {
        setMessages([])
        return
      }
      setMessagesLoading(true)
      setError(null)
      try {
        const rows = await fetchRpMessages(room.id, user.id)
        setMessages(rows)
      } catch (loadError) {
        console.warn('加载 RP 时间线失败', loadError)
        setError('加载时间线失败，请稍后重试。')
      } finally {
        setMessagesLoading(false)
      }
    }

    void loadMessages()
  }, [room, user])

  useEffect(() => {
    resizeComposer()
  }, [draft])

  const handleSend = async () => {
    if (!room || !user || sending) {
      return
    }
    const content = draft.trim()
    if (!content) {
      return
    }
    setSending(true)
    setError(null)
    setNotice(null)
    try {
      const message = await createRpMessage(room.id, user.id, playerName, content)
      setMessages((current) => [...current, message])
      setDraft('')
      setNotice('发送成功')
    } catch (sendError) {
      console.warn('发送 RP 消息失败', sendError)
      setError('发送失败，请稍后重试。')
    } finally {
      setSending(false)
    }
  }

  const handleSaveRoomSettings = async () => {
    if (!room || savingRoomSettings) {
      return
    }
    setSavingRoomSettings(true)
    setError(null)
    setNotice(null)
    const normalizedDisplayName = playerDisplayNameInput.trim() || '串串'
    const normalizedAvatar = playerAvatarUrlInput.trim()
    try {
      const updated = await updateRpSessionDashboard(room.id, {
        playerDisplayName: normalizedDisplayName,
        playerAvatarUrl: normalizedAvatar,
        settings: room.settings ?? {},
      })
      setRoom(updated)
      setNotice('保存成功')
    } catch (saveError) {
      console.warn('保存房间设置失败', saveError)
      setError('保存失败，请稍后重试。')
    } finally {
      setSavingRoomSettings(false)
    }
  }

  const handleSaveWorldbook = async () => {
    if (!room || savingWorldbook) {
      return
    }
    setSavingWorldbook(true)
    setError(null)
    setNotice(null)
    try {
      const updated = await updateRpSessionDashboard(room.id, {
        worldbookText: worldbookTextInput,
      })
      setRoom(updated)
      setNotice('保存成功')
    } catch (saveError) {
      console.warn('保存世界书失败', saveError)
      setError('保存失败，请稍后重试。')
    } finally {
      setSavingWorldbook(false)
    }
  }

  const handleExportMessages = () => {
    if (!room) {
      return
    }
    const contentRows = messages
      .filter((item) => item.role.trim().toLowerCase() !== 'system')
      .map((item) => `${item.role}: ${item.content}`)

    const payload = contentRows.join('\n\n')
    const blob = new Blob([payload], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `rp-room-${room.id}.txt`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
    setNotice('导出成功')
  }

  const handleConfirmDelete = async () => {
    if (!pendingDelete || deletingMessageId) {
      return
    }
    setDeletingMessageId(pendingDelete.id)
    setError(null)
    setNotice(null)
    try {
      await deleteRpMessage(pendingDelete.id)
      setMessages((current) => current.filter((item) => item.id !== pendingDelete.id))
      setPendingDelete(null)
      setNotice('消息已删除')
    } catch (deleteError) {
      console.warn('删除 RP 消息失败', deleteError)
      setError('删除失败，请稍后重试。')
    } finally {
      setDeletingMessageId(null)
    }
  }

  if (loading) {
    return <div className="rp-room-page"><p className="tips">房间加载中…</p></div>
  }

  if (error || !room) {
    return (
      <div className="rp-room-page">
        <header className="rp-room-header">
          <button type="button" className="ghost" onClick={() => navigate('/rp')}>
            返回
          </button>
        </header>
        <div className="rp-room-card">
          <h1>无法进入房间</h1>
          <p className="error">{error ?? '未找到房间。'}</p>
        </div>
      </div>
    )
  }

  const dashboardContent = (
    <>
      <h2>仪表盘</h2>
      <section className="rp-dashboard-section">
        <h3>房间设置</h3>
        <label>
          玩家显示名
          <input
            type="text"
            value={playerDisplayNameInput}
            onChange={(event) => setPlayerDisplayNameInput(event.target.value)}
            placeholder="串串"
          />
        </label>
        <label>
          玩家头像URL
          <input
            type="url"
            value={playerAvatarUrlInput}
            onChange={(event) => setPlayerAvatarUrlInput(event.target.value)}
            placeholder="https://example.com/avatar.png"
          />
        </label>
        <p className="rp-dashboard-helper">默认模型/配置：当前为占位区，后续扩展房间级配置。</p>
        <button type="button" className="primary" onClick={() => void handleSaveRoomSettings()} disabled={savingRoomSettings}>
          {savingRoomSettings ? '保存中…' : '保存'}
        </button>
      </section>

      <section className="rp-dashboard-section">
        <h3>世界书（基础版）</h3>
        <p className="rp-dashboard-helper">房间级全量注入文本</p>
        <textarea
          value={worldbookTextInput}
          onChange={(event) => setWorldbookTextInput(event.target.value)}
          rows={8}
          placeholder="在这里输入世界书内容…"
        />
        <button type="button" className="primary" onClick={() => void handleSaveWorldbook()} disabled={savingWorldbook}>
          {savingWorldbook ? '保存中…' : '保存'}
        </button>
      </section>

      <section className="rp-dashboard-section">
        <h3>导出</h3>
        <p className="rp-dashboard-helper">仅导出 speaker(role) + 纯文本内容。</p>
        <button type="button" className="primary" onClick={handleExportMessages}>
          导出
        </button>
      </section>
    </>
  )

  return (
    <div className="rp-room-page">
      <header className="rp-room-header">
        <button
          type="button"
          className="ghost"
          onClick={() => navigate(isDashboardPage ? `/rp/${room.id}` : '/rp')}
        >
          返回
        </button>
        <h1>{room.title?.trim() || '新房间'}</h1>
        <div className="rp-room-header-slot">
          {!isDashboardPage ? (
            <button
              type="button"
              className="ghost rp-dashboard-open-btn"
              onClick={() => navigate(`/rp/${room.id}/dashboard`)}
            >
              仪表盘
            </button>
          ) : null}
        </div>
      </header>

      <div className={`rp-room-body ${isDashboardPage ? 'rp-room-body-dashboard' : ''}`}>
        {isDashboardPage ? (
          <main className="rp-dashboard-page" aria-label="RP 仪表盘页面">
            {notice ? <p className="tips">{notice}</p> : null}
            {error ? <p className="error">{error}</p> : null}
            {dashboardContent}
          </main>
        ) : (
          <section className="rp-room-main">
            <section className="rp-room-timeline">
                {notice ? <p className="tips">{notice}</p> : null}
                {error ? <p className="error">{error}</p> : null}

                {messagesLoading ? <p className="tips">时间线加载中…</p> : null}
                {!messagesLoading && messages.length === 0 ? <p className="tips">还没有消息，先说点什么吧。</p> : null}

                <ul className="rp-message-list">
                  {messages.map((message) => {
                    const isPlayer = message.role === playerName
                    return (
                      <li key={message.id} className={`rp-message ${isPlayer ? 'out' : 'in'}`}>
                        <div className="rp-bubble">
                          <p className="rp-speaker">{message.role}</p>
                          <p>{message.content}</p>
                        </div>
                        <div className="rp-message-actions">
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => setPendingDelete(message)}
                            disabled={Boolean(deletingMessageId)}
                          >
                            删除
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>

            <section className="rp-composer-wrap">
                <div className="rp-trigger-row" aria-label="NPC 触发按钮区域">
                  <span>NPC触发按钮（预留）</span>
                </div>
                <section className="rp-composer">
                  <textarea
                    ref={textareaRef}
                    placeholder="输入消息内容"
                    rows={1}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) {
                        return
                      }
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault()
                        void handleSend()
                      }
                    }}
                  />
                  <button type="button" className="primary" onClick={() => void handleSend()} disabled={sending}>
                    {sending ? '发送中…' : '发送'}
                  </button>
                </section>
            </section>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="确认删除？"
        description="删除后无法恢复。"
        cancelLabel="取消"
        confirmLabel="删除"
        confirmDisabled={Boolean(deletingMessageId)}
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}

export default RpRoomPage
