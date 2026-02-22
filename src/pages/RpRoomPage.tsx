import { useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useNavigate, useParams } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'
import { useEnabledModels } from '../hooks/useEnabledModels'
import {
  createRpMessage,
  createRpNpcCard,
  deleteRpMessage,
  deleteRpNpcCard,
  fetchRpMessages,
  fetchRpNpcCards,
  fetchRpSessionById,
  updateRpNpcCard,
  updateRpSessionDashboard,
} from '../storage/supabaseSync'
import type { RpMessage, RpNpcCard, RpSession } from '../types'
import './RpRoomPage.css'

type RpRoomPageProps = {
  user: User | null
  mode?: 'chat' | 'dashboard'
}

type NpcFormState = {
  displayName: string
  systemPrompt: string
  model: string
  temperature: string
  topP: string
  apiBaseUrl: string
  enabled: boolean
}

const NPC_MAX_ENABLED = 3

const createEmptyNpcForm = (): NpcFormState => ({
  displayName: '',
  systemPrompt: '',
  model: '',
  temperature: '',
  topP: '',
  apiBaseUrl: '',
  enabled: false,
})

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
  const [npcCards, setNpcCards] = useState<RpNpcCard[]>([])
  const [npcLoading, setNpcLoading] = useState(false)
  const [editingNpcId, setEditingNpcId] = useState<string | null>(null)
  const [npcForm, setNpcForm] = useState<NpcFormState>(createEmptyNpcForm)
  const [savingNpc, setSavingNpc] = useState(false)
  const [pendingDeleteNpc, setPendingDeleteNpc] = useState<RpNpcCard | null>(null)
  const [deletingNpcId, setDeletingNpcId] = useState<string | null>(null)
  const [selectedNpcId, setSelectedNpcId] = useState('')
  const { enabledModelIds, enabledModelOptions } = useEnabledModels(user)
  const playerName = room?.playerDisplayName?.trim() ? room.playerDisplayName.trim() : '串串'
  const isDashboardPage = mode === 'dashboard'
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const enabledNpcCount = useMemo(() => npcCards.filter((card) => card.enabled).length, [npcCards])
  const enabledNpcCards = useMemo(() => npcCards.filter((card) => card.enabled), [npcCards])

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
    const loadNpcCards = async () => {
      if (!user || !room) {
        setNpcCards([])
        return
      }
      setNpcLoading(true)
      try {
        const rows = await fetchRpNpcCards(room.id, user.id)
        setNpcCards(rows)
      } catch (loadError) {
        console.warn('加载 NPC 角色卡失败', loadError)
        setError('加载 NPC 角色卡失败，请稍后重试。')
      } finally {
        setNpcLoading(false)
      }
    }

    void loadNpcCards()
  }, [room, user])

  useEffect(() => {
    resizeComposer()
  }, [draft])

  useEffect(() => {
    if (!selectedNpcId) {
      return
    }
    if (!enabledNpcCards.some((card) => card.id === selectedNpcId)) {
      setSelectedNpcId('')
    }
  }, [enabledNpcCards, selectedNpcId])

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

  const startCreateNpc = () => {
    setEditingNpcId('new')
    setNpcForm((current) => ({
      ...createEmptyNpcForm(),
      model: enabledModelIds[0] ?? current.model,
    }))
  }

  const startEditNpc = (card: RpNpcCard) => {
    setEditingNpcId(card.id)
    setNpcForm({
      displayName: card.displayName,
      systemPrompt: card.systemPrompt ?? '',
      model:
        typeof card.modelConfig.model_id === 'string'
          ? card.modelConfig.model_id
          : typeof card.modelConfig.model === 'string'
            ? card.modelConfig.model
            : '',
      temperature: typeof card.modelConfig.temperature === 'number' ? String(card.modelConfig.temperature) : '',
      topP: typeof card.modelConfig.top_p === 'number' ? String(card.modelConfig.top_p) : '',
      apiBaseUrl: typeof card.apiConfig.base_url === 'string' ? card.apiConfig.base_url : '',
      enabled: card.enabled,
    })
  }

  const handleSaveNpc = async () => {
    if (!room || !user || !editingNpcId || savingNpc) {
      return
    }
    const displayName = npcForm.displayName.trim()
    if (!displayName) {
      setError('NPC名称不能为空。')
      return
    }
    const nextEnabled = npcForm.enabled
    if (nextEnabled) {
      const enabledExcludingCurrent = npcCards.filter((card) => card.enabled && card.id !== editingNpcId).length
      if (enabledExcludingCurrent >= NPC_MAX_ENABLED) {
        setNotice(`最多只能启用 ${NPC_MAX_ENABLED} 个 NPC。`)
        return
      }
    }

    const modelConfig: Record<string, unknown> = {}
    if (npcForm.model.trim()) {
      modelConfig.model_id = npcForm.model.trim()
    }
    if (npcForm.temperature.trim()) {
      modelConfig.temperature = Number(npcForm.temperature)
    }
    if (npcForm.topP.trim()) {
      modelConfig.top_p = Number(npcForm.topP)
    }

    const apiConfig: Record<string, unknown> = {}
    if (npcForm.apiBaseUrl.trim()) {
      apiConfig.base_url = npcForm.apiBaseUrl.trim()
    }

    setSavingNpc(true)
    setError(null)
    setNotice(null)
    try {
      if (editingNpcId === 'new') {
        const created = await createRpNpcCard({
          sessionId: room.id,
          userId: user.id,
          displayName,
          systemPrompt: npcForm.systemPrompt,
          modelConfig,
          apiConfig,
          enabled: nextEnabled,
        })
        setNpcCards((current) => [...current, created])
      } else {
        const updated = await updateRpNpcCard(editingNpcId, {
          displayName,
          systemPrompt: npcForm.systemPrompt,
          modelConfig,
          apiConfig,
          enabled: nextEnabled,
        })
        setNpcCards((current) => current.map((item) => (item.id === editingNpcId ? updated : item)))
      }
      setEditingNpcId(null)
      setNpcForm((current) => ({
        ...createEmptyNpcForm(),
        model: enabledModelIds[0] ?? current.model,
      }))
      setNotice('保存成功')
    } catch (saveError) {
      console.warn('保存 NPC 角色卡失败', saveError)
      setError('保存 NPC 角色卡失败，请稍后重试。')
    } finally {
      setSavingNpc(false)
    }
  }

  const editingModelEnabled = npcForm.model.trim() ? enabledModelIds.includes(npcForm.model.trim()) : true

  const handleToggleNpcEnabled = async (card: RpNpcCard) => {
    if (card.enabled) {
      try {
        const updated = await updateRpNpcCard(card.id, { enabled: false })
        setNpcCards((current) => current.map((item) => (item.id === card.id ? updated : item)))
        setNotice('已禁用 NPC')
      } catch (toggleError) {
        console.warn('禁用 NPC 失败', toggleError)
        setError('禁用 NPC 失败，请稍后重试。')
      }
      return
    }

    if (enabledNpcCount >= NPC_MAX_ENABLED) {
      setNotice(`最多只能启用 ${NPC_MAX_ENABLED} 个 NPC。`)
      return
    }

    try {
      const updated = await updateRpNpcCard(card.id, { enabled: true })
      setNpcCards((current) => current.map((item) => (item.id === card.id ? updated : item)))
      setNotice('已启用 NPC')
    } catch (toggleError) {
      console.warn('启用 NPC 失败', toggleError)
      setError('启用 NPC 失败，请稍后重试。')
    }
  }

  const handleConfirmDeleteNpc = async () => {
    if (!pendingDeleteNpc || deletingNpcId) {
      return
    }
    setDeletingNpcId(pendingDeleteNpc.id)
    setError(null)
    setNotice(null)
    try {
      await deleteRpNpcCard(pendingDeleteNpc.id)
      setNpcCards((current) => current.filter((item) => item.id !== pendingDeleteNpc.id))
      setPendingDeleteNpc(null)
      setNotice('NPC 已删除')
    } catch (deleteError) {
      console.warn('删除 NPC 失败', deleteError)
      setError('删除 NPC 失败，请稍后重试。')
    } finally {
      setDeletingNpcId(null)
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
        <button type="button" className="primary" onClick={() => void handleSaveRoomSettings()} disabled={savingRoomSettings}>
          {savingRoomSettings ? '保存中…' : '保存'}
        </button>
      </section>

      <section className="rp-dashboard-section">
        <h3>NPC 角色卡</h3>
        <p className="rp-dashboard-helper">已启用 {enabledNpcCount} / {NPC_MAX_ENABLED} 个 NPC</p>
        <button type="button" className="primary" onClick={startCreateNpc}>
          新增NPC
        </button>
        {npcLoading ? <p className="tips">NPC 列表加载中…</p> : null}
        {!npcLoading && npcCards.length === 0 ? <p className="tips">还没有 NPC，先创建一个吧。</p> : null}
        <ul className="rp-npc-list">
          {npcCards.map((card) => (
            <li key={card.id} className="rp-npc-item">
              <div>
                <p className="rp-npc-name">{card.displayName}</p>
                <p className="rp-dashboard-helper">状态：{card.enabled ? '已启用' : '已禁用'}</p>
                <p className="rp-dashboard-helper">模型：{typeof card.modelConfig.model_id === 'string' ? card.modelConfig.model_id : typeof card.modelConfig.model === 'string' ? card.modelConfig.model : '未设置'}</p>
              </div>
              <div className="rp-npc-actions">
                <button type="button" className="ghost" onClick={() => void handleToggleNpcEnabled(card)}>
                  {card.enabled ? '禁用' : '启用'}
                </button>
                <button type="button" className="ghost" onClick={() => startEditNpc(card)}>
                  编辑
                </button>
                <button type="button" className="ghost danger-text" onClick={() => setPendingDeleteNpc(card)}>
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>

        {editingNpcId ? (
          <div className="rp-npc-form">
            <h4>{editingNpcId === 'new' ? '新增 NPC' : '编辑 NPC'}</h4>
            <label>
              NPC名称
              <input
                type="text"
                value={npcForm.displayName}
                onChange={(event) => setNpcForm((current) => ({ ...current, displayName: event.target.value }))}
                placeholder="例如：店主阿杰"
              />
            </label>
            <label>
              System Prompt
              <textarea
                value={npcForm.systemPrompt}
                onChange={(event) => setNpcForm((current) => ({ ...current, systemPrompt: event.target.value }))}
                rows={4}
                placeholder="可选：用于描述 NPC 设定"
              />
            </label>
            <label>
              模型
              <select
                value={npcForm.model}
                onChange={(event) => setNpcForm((current) => ({ ...current, model: event.target.value }))}
                disabled={enabledModelOptions.length === 0}
              >
                {enabledModelOptions.length === 0 ? <option value="">请先去模型库启用模型</option> : <option value="">未指定（按NPC调用时决定）</option>}
                {enabledModelOptions.map((model) => (
                  <option key={model.id} value={model.id}>{model.label}</option>
                ))}
              </select>
            </label>
            {!editingModelEnabled && npcForm.model.trim() ? (
              <p className="rp-model-warning">当前：{npcForm.model.trim()}（未启用）</p>
            ) : null}
            {enabledModelOptions.length === 0 ? (
              <div className="rp-model-empty-hint">
                <p className="rp-dashboard-helper">请先去模型库启用模型</p>
                <button type="button" className="ghost" onClick={() => navigate('/settings')}>
                  前往模型库
                </button>
              </div>
            ) : null}
            <div className="rp-npc-form-grid">
              <label>
                temperature
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={npcForm.temperature}
                  onChange={(event) => setNpcForm((current) => ({ ...current, temperature: event.target.value }))}
                  placeholder="可选"
                />
              </label>
              <label>
                top_p
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  value={npcForm.topP}
                  onChange={(event) => setNpcForm((current) => ({ ...current, topP: event.target.value }))}
                  placeholder="可选"
                />
              </label>
            </div>
            <label>
              API Base URL
              <input
                type="url"
                value={npcForm.apiBaseUrl}
                onChange={(event) => setNpcForm((current) => ({ ...current, apiBaseUrl: event.target.value }))}
                placeholder="可选"
              />
            </label>
            <label className="rp-npc-enabled-toggle">
              <input
                type="checkbox"
                checked={npcForm.enabled}
                onChange={(event) => setNpcForm((current) => ({ ...current, enabled: event.target.checked }))}
              />
              启用
            </label>
            <div className="rp-npc-form-actions">
              <button type="button" className="ghost" onClick={() => setEditingNpcId(null)}>
                取消
              </button>
              <button type="button" className="primary" onClick={() => void handleSaveNpc()} disabled={savingNpc}>
                {savingNpc ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        ) : null}
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
              <div className="rp-trigger-row" aria-label="NPC 选择区域">
                <label htmlFor="rp-npc-selector">选择NPC（预留）</label>
                <select
                  id="rp-npc-selector"
                  value={selectedNpcId}
                  disabled={enabledNpcCards.length === 0}
                  onChange={(event) => setSelectedNpcId(event.target.value)}
                >
                  {enabledNpcCards.length === 0 ? <option value="">暂无可用NPC</option> : <option value="">请选择 NPC</option>}
                  {enabledNpcCards.map((card) => (
                    <option key={card.id} value={card.id}>{card.displayName}</option>
                  ))}
                </select>
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

      <ConfirmDialog
        open={pendingDeleteNpc !== null}
        title="确认删除？"
        description="删除后无法恢复。"
        cancelLabel="取消"
        confirmLabel="删除"
        confirmDisabled={Boolean(deletingNpcId)}
        onCancel={() => setPendingDeleteNpc(null)}
        onConfirm={handleConfirmDeleteNpc}
      />
    </div>
  )
}

export default RpRoomPage
