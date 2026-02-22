import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate, useParams } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  createRpMessage,
  deleteRpMessage,
  fetchRpMessages,
  fetchRpSessionById,
} from '../storage/supabaseSync'
import type { RpMessage, RpSession } from '../types'
import './RpRoomPage.css'

type RpRoomPageProps = {
  user: User | null
}

const RpRoomPage = ({ user }: RpRoomPageProps) => {
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
      const message = await createRpMessage(
        room.id,
        user.id,
        room.playerDisplayName?.trim() ? room.playerDisplayName : '串串',
        content,
      )
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

  return (
    <div className="rp-room-page">
      <header className="rp-room-header">
        <div>
          <h1>{room.title || '未命名房间'}</h1>
        </div>
        <button type="button" className="ghost" onClick={() => navigate('/rp')}>
          返回
        </button>
      </header>

      <section className="rp-room-timeline">
        {notice ? <p className="tips">{notice}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        {messagesLoading ? <p className="tips">时间线加载中…</p> : null}
        {!messagesLoading && messages.length === 0 ? <p className="tips">还没有消息，先说点什么吧。</p> : null}

        <ul className="rp-message-list">
          {messages.map((message) => (
            <li key={message.id} className="rp-message-item">
              <div className="rp-message-top">
                <strong>{message.role}</strong>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setPendingDelete(message)}
                  disabled={Boolean(deletingMessageId)}
                >
                  删除
                </button>
              </div>
              <p>{message.content}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rp-composer">
        <textarea
          placeholder="输入消息内容"
          rows={3}
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
