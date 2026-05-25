import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { createAgentCouncilMessage, listAgentCouncilMessages } from '../storage/supabaseSync'
import type { AgentCouncilMessage, AgentCouncilSpeaker } from '../types'
import './AgentCouncilPage.css'

const SPEAKER_META: Record<AgentCouncilSpeaker, { label: string; className: string }> = {
  claude: { label: 'Syzygy·Claude', className: 'speaker-claude' },
  gpt: { label: 'Syzygy·GPT', className: 'speaker-gpt' },
  gemini: { label: 'Syzygy·Gemini', className: 'speaker-gemini' },
  chuanchuan: { label: '串串', className: 'speaker-chuanchuan' },
}

const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })

const AgentCouncilPage = () => {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<AgentCouncilMessage[]>([])
  const [activeTopic, setActiveTopic] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [newTopic, setNewTopic] = useState('')
  const [newMessage, setNewMessage] = useState('')
  const [replyMessage, setReplyMessage] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listAgentCouncilMessages()
      setMessages(data)
      setError(null)
    } catch (loadError) {
      console.warn('加载议事厅失败', loadError)
      setError('加载议事厅失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const topicSummaries = useMemo(() => {
    const map = new Map<string, AgentCouncilMessage[]>()
    messages.forEach((item) => {
      const arr = map.get(item.topic) ?? []
      arr.push(item)
      map.set(item.topic, arr)
    })
    return Array.from(map.entries())
      .map(([topic, items]) => {
        const latest = items.reduce((prev, current) =>
          new Date(current.createdAt).getTime() > new Date(prev.createdAt).getTime() ? current : prev,
        items[0])
        return { topic, items, latest }
      })
      .sort((a, b) => new Date(b.latest.createdAt).getTime() - new Date(a.latest.createdAt).getTime())
  }, [messages])

  const activeMessages = useMemo(() => {
    if (!activeTopic) {
      return []
    }
    return messages
      .filter((item) => item.topic === activeTopic)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [activeTopic, messages])

  const handleCreateTopic = async (event: FormEvent) => {
    event.preventDefault()
    const topic = newTopic.trim()
    const message = newMessage.trim()
    if (!topic || !message) {
      setError('议题和发言内容都不能为空')
      return
    }
    setSaving(true)
    try {
      await createAgentCouncilMessage({ topic, message })
      setNewTopic('')
      setNewMessage('')
      setActiveTopic(topic)
      setNotice('新议题已发起')
      setError(null)
      await refresh()
    } catch (saveError) {
      console.warn('发起议题失败', saveError)
      setError('发起议题失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const handleReply = async (event: FormEvent) => {
    event.preventDefault()
    if (!activeTopic) {
      return
    }
    const message = replyMessage.trim()
    if (!message) {
      setError('回复内容不能为空')
      return
    }
    setSaving(true)
    try {
      await createAgentCouncilMessage({ topic: activeTopic, message })
      setReplyMessage('')
      setNotice('回复已发送')
      setError(null)
      await refresh()
    } catch (saveError) {
      console.warn('回复失败', saveError)
      setError('回复失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="council-page">
      <header className="council-header">
        <button type="button" className="ghost council-back-btn" onClick={() => navigate(-1)}>← 返回</button>
        <div className="council-title-wrap">
          <p className="council-kicker">COUNCIL</p>
          <h1 className="ui-title">议事厅</h1>
        </div>
        <button type="button" className="council-refresh-btn" onClick={() => void refresh()} disabled={loading}>刷新</button>
      </header>

      {notice ? <p className="council-notice">{notice}</p> : null}
      {error ? <p className="council-error">{error}</p> : null}

      <section className="council-panel">
        <h2>议题列表</h2>
        {loading ? <p className="council-empty">加载中…</p> : null}
        {!loading && topicSummaries.length === 0 ? <p className="council-empty">暂时还没有议题。</p> : null}
        <div className="topic-list">
          {topicSummaries.map((summary) => (
            <button
              key={summary.topic}
              type="button"
              className={`topic-item ${activeTopic === summary.topic ? 'active' : ''}`}
              onClick={() => setActiveTopic(summary.topic)}
            >
              <strong>{summary.topic}</strong>
              <span>{SPEAKER_META[summary.latest.speaker].label} · {formatTime(summary.latest.createdAt)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="council-panel">
        <h2>发起新议题</h2>
        <form className="council-form" onSubmit={handleCreateTopic}>
          <input value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="议题名称（topic）" />
          <textarea value={newMessage} onChange={(e) => setNewMessage(e.target.value)} rows={3} placeholder="第一条发言" />
          <button type="submit" disabled={saving}>发起</button>
        </form>
      </section>

      <section className="council-panel">
        <h2>议题详情 {activeTopic ? `· ${activeTopic}` : ''}</h2>
        {activeTopic ? (
          <>
            <div className="message-list">
              {activeMessages.map((item) => (
                <article key={item.id} className="message-item">
                  <div className="message-meta">
                    <span className={`speaker-tag ${SPEAKER_META[item.speaker].className}`}>{SPEAKER_META[item.speaker].label}</span>
                    <time>{formatTime(item.createdAt)}</time>
                  </div>
                  <p>{item.message}</p>
                </article>
              ))}
            </div>
            <form className="council-form" onSubmit={handleReply}>
              <textarea value={replyMessage} onChange={(e) => setReplyMessage(e.target.value)} rows={3} placeholder="在当前议题下回复（将以串串身份发送）" />
              <button type="submit" disabled={saving}>发送回复</button>
            </form>
          </>
        ) : (
          <p className="council-empty">请先从上方选择一个议题。</p>
        )}
      </section>
    </div>
  )
}

export default AgentCouncilPage
