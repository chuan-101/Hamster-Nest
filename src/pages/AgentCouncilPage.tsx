import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  createAgentCouncilProposal,
  createAgentCouncilReview,
  decideAgentCouncilProposal,
  deleteAgentCouncilProposal,
  deleteAgentCouncilTopic,
  listAgentCouncilMessages,
} from '../storage/supabaseSync'
import type {
  AgentCouncilMessage,
  AgentCouncilProposalStatus,
  AgentCouncilSpeaker,
  AgentCouncilVote,
} from '../types'
import './AgentCouncilPage.css'

const SPEAKER_META: Record<AgentCouncilSpeaker, { label: string; className: string }> = {
  claude: { label: 'Syzygy·Claude', className: 'speaker-claude' },
  gpt: { label: 'Syzygy·GPT', className: 'speaker-gpt' },
  gemini: { label: 'Syzygy·Gemini', className: 'speaker-gemini' },
  chuanchuan: { label: '串串', className: 'speaker-chuanchuan' },
  codex_cli: { label: 'Codex CLI', className: 'speaker-codex' },
  claude_code_cli: { label: 'Claude Code CLI', className: 'speaker-claude-code' },
}

// 旧数据可能出现未知 speaker，做一次兜底，避免页面崩溃。
const getSpeakerMeta = (speaker: string) =>
  SPEAKER_META[speaker as AgentCouncilSpeaker] ?? { label: speaker || '未知', className: 'speaker-unknown' }

const SPEAKER_OPTIONS: AgentCouncilSpeaker[] = [
  'chuanchuan',
  'claude',
  'gpt',
  'gemini',
  'codex_cli',
  'claude_code_cli',
]

const STATUS_META: Record<AgentCouncilProposalStatus, { label: string; className: string }> = {
  open: { label: '待讨论', className: 'status-open' },
  approved: { label: '已拍板，待生成执行案', className: 'status-approved' },
  rejected: { label: '已拒绝', className: 'status-rejected' },
  deferred: { label: '暂缓', className: 'status-deferred' },
  plan_generated: { label: '执行案已生成', className: 'status-plan' },
}

const getStatusMeta = (status: AgentCouncilProposalStatus | null) =>
  status ? STATUS_META[status] : STATUS_META.open

const VOTE_META: Record<AgentCouncilVote, { label: string; className: string }> = {
  support: { label: '支持', className: 'vote-support' },
  neutral: { label: '中立', className: 'vote-neutral' },
  against: { label: '反对', className: 'vote-against' },
}

const VOTE_OPTIONS: AgentCouncilVote[] = ['support', 'neutral', 'against']

type DecisionAction = 'approved' | 'rejected' | 'deferred'

const DECISION_META: Record<DecisionAction, { label: string; className: string }> = {
  approved: { label: '拍板执行', className: 'decision-approved' },
  rejected: { label: '拒绝', className: 'decision-rejected' },
  deferred: { label: '暂缓', className: 'decision-deferred' },
}

const formatTime = (value: string | null) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'

const summarize = (text: string, max = 80) => {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized
}

const AgentCouncilPage = () => {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<AgentCouncilMessage[]>([])
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // 发起提案表单
  const [newSpeaker, setNewSpeaker] = useState<AgentCouncilSpeaker>('chuanchuan')
  const [newTopic, setNewTopic] = useState('')
  const [newMessage, setNewMessage] = useState('')
  const [newRiskLevel, setNewRiskLevel] = useState('')
  const [newTargetModule, setNewTargetModule] = useState('')

  // 评估回复表单
  const [reviewSpeaker, setReviewSpeaker] = useState<AgentCouncilSpeaker>('chuanchuan')
  const [reviewVote, setReviewVote] = useState<AgentCouncilVote>('support')
  const [reviewMessage, setReviewMessage] = useState('')

  // 拍板说明
  const [decisionNote, setDecisionNote] = useState('')

  // 删除确认
  const [pendingDeleteProposalId, setPendingDeleteProposalId] = useState<string | null>(null)
  const [pendingDeleteLegacyTopic, setPendingDeleteLegacyTopic] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showLegacy, setShowLegacy] = useState(false)

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

  // 主提案：parent_id 为空且 entry_type=proposal，按更新/创建时间倒序
  const proposals = useMemo(() => {
    return messages
      .filter((item) => !item.parentId && item.entryType === 'proposal')
      .sort((a, b) => {
        const at = new Date(a.updatedAt ?? a.createdAt).getTime()
        const bt = new Date(b.updatedAt ?? b.createdAt).getTime()
        return bt - at
      })
  }, [messages])

  // 旧历史消息：没有 entry_type（或非 proposal）且无 parent_id，按 topic 归组，单独展示避免崩溃
  const legacyTopics = useMemo(() => {
    const map = new Map<string, AgentCouncilMessage[]>()
    messages
      .filter((item) => !item.parentId && item.entryType !== 'proposal')
      .forEach((item) => {
        const arr = map.get(item.topic) ?? []
        arr.push(item)
        map.set(item.topic, arr)
      })
    return Array.from(map.entries())
      .map(([topic, items]) => {
        const sorted = [...items].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        )
        const latest = sorted[sorted.length - 1]
        return { topic, items: sorted, latest }
      })
      .sort((a, b) => new Date(b.latest.createdAt).getTime() - new Date(a.latest.createdAt).getTime())
  }, [messages])

  const activeProposal = useMemo(
    () => proposals.find((item) => item.id === activeProposalId) ?? null,
    [proposals, activeProposalId],
  )

  const activeReviews = useMemo(() => {
    if (!activeProposalId) {
      return []
    }
    return messages
      .filter((item) => item.parentId === activeProposalId && item.entryType === 'review')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [activeProposalId, messages])

  const activeDecisions = useMemo(() => {
    if (!activeProposalId) {
      return []
    }
    return messages
      .filter((item) => item.parentId === activeProposalId && item.entryType === 'decision')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [activeProposalId, messages])

  const handleCreateProposal = async (event: FormEvent) => {
    event.preventDefault()
    const topic = newTopic.trim()
    const message = newMessage.trim()
    if (!topic || !message) {
      setError('议题和提案内容都不能为空')
      return
    }
    const metadata: Record<string, string> = {}
    if (newRiskLevel.trim()) {
      metadata.risk_level = newRiskLevel.trim()
    }
    if (newTargetModule.trim()) {
      metadata.target_module = newTargetModule.trim()
    }
    setSaving(true)
    try {
      const created = await createAgentCouncilProposal({
        topic,
        message,
        speaker: newSpeaker,
        metadata,
      })
      setNewTopic('')
      setNewMessage('')
      setNewRiskLevel('')
      setNewTargetModule('')
      setActiveProposalId(created.id)
      setNotice('新提案已发起')
      setError(null)
      await refresh()
    } catch (saveError) {
      console.warn('发起提案失败', saveError)
      setError('发起提案失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const handleAddReview = async (event: FormEvent) => {
    event.preventDefault()
    if (!activeProposal) {
      return
    }
    const message = reviewMessage.trim()
    if (!message) {
      setError('评估内容不能为空')
      return
    }
    setSaving(true)
    try {
      await createAgentCouncilReview({
        parentId: activeProposal.id,
        topic: activeProposal.topic,
        message,
        vote: reviewVote,
        speaker: reviewSpeaker,
      })
      setReviewMessage('')
      setNotice('评估回复已提交')
      setError(null)
      await refresh()
    } catch (saveError) {
      console.warn('提交评估失败', saveError)
      setError('提交评估失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const handleDecide = async (status: DecisionAction) => {
    if (!activeProposal) {
      return
    }
    setSaving(true)
    try {
      await decideAgentCouncilProposal({
        proposalId: activeProposal.id,
        topic: activeProposal.topic,
        status,
        note: decisionNote,
        speaker: 'chuanchuan',
      })
      setDecisionNote('')
      setNotice(`串串已拍板：${DECISION_META[status].label}`)
      setError(null)
      await refresh()
    } catch (decideError) {
      console.warn('拍板失败', decideError)
      setError('拍板失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmDeleteProposal = async () => {
    if (!pendingDeleteProposalId) {
      return
    }
    const proposalId = pendingDeleteProposalId
    setDeleting(true)
    try {
      await deleteAgentCouncilProposal(proposalId)
      if (activeProposalId === proposalId) {
        setActiveProposalId(null)
      }
      setPendingDeleteProposalId(null)
      setNotice('提案已删除')
      setError(null)
      await refresh()
    } catch (deleteError) {
      console.warn('删除提案失败', deleteError)
      setError('删除提案失败，请稍后重试')
    } finally {
      setDeleting(false)
    }
  }

  const handleConfirmDeleteLegacy = async () => {
    if (!pendingDeleteLegacyTopic) {
      return
    }
    const topic = pendingDeleteLegacyTopic
    setDeleting(true)
    try {
      await deleteAgentCouncilTopic(topic)
      setPendingDeleteLegacyTopic(null)
      setNotice('历史消息已删除')
      setError(null)
      await refresh()
    } catch (deleteError) {
      console.warn('删除历史消息失败', deleteError)
      setError('删除历史消息失败，请稍后重试')
    } finally {
      setDeleting(false)
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
        <h2>发起新提案</h2>
        <form className="council-form" onSubmit={handleCreateProposal}>
          <label className="council-field">
            <span>发起身份</span>
            <select value={newSpeaker} onChange={(e) => setNewSpeaker(e.target.value as AgentCouncilSpeaker)}>
              {SPEAKER_OPTIONS.map((speaker) => (
                <option key={speaker} value={speaker}>{SPEAKER_META[speaker].label}</option>
              ))}
            </select>
          </label>
          <input value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="议题名称（topic）" />
          <textarea value={newMessage} onChange={(e) => setNewMessage(e.target.value)} rows={4} placeholder="提案全文" />
          <div className="council-field-row">
            <input value={newRiskLevel} onChange={(e) => setNewRiskLevel(e.target.value)} placeholder="风险等级（可选）" />
            <input value={newTargetModule} onChange={(e) => setNewTargetModule(e.target.value)} placeholder="目标模块（可选）" />
          </div>
          <button type="submit" disabled={saving}>发起提案</button>
        </form>
      </section>

      <section className="council-panel">
        <h2>主提案列表</h2>
        {loading ? <p className="council-empty">加载中…</p> : null}
        {!loading && proposals.length === 0 ? <p className="council-empty">暂时还没有正式提案。</p> : null}
        <div className="proposal-list">
          {proposals.map((proposal) => {
            const statusMeta = getStatusMeta(proposal.proposalStatus)
            const speakerMeta = getSpeakerMeta(proposal.speaker)
            const riskLevel = proposal.metadata?.risk_level
            const targetModule = proposal.metadata?.target_module
            return (
              <div
                key={proposal.id}
                className={`proposal-item ${activeProposalId === proposal.id ? 'active' : ''}`}
              >
                <button
                  type="button"
                  className="proposal-item__select"
                  onClick={() => setActiveProposalId((prev) => (prev === proposal.id ? null : proposal.id))}
                >
                  <div className="proposal-item__head">
                    <strong>{proposal.topic}</strong>
                    <span className={`status-tag ${statusMeta.className}`}>{statusMeta.label}</span>
                  </div>
                  <p className="proposal-item__summary">{summarize(proposal.message)}</p>
                  <div className="proposal-item__meta">
                    <span className={`speaker-tag ${speakerMeta.className}`}>{speakerMeta.label}</span>
                    {typeof riskLevel === 'string' && riskLevel ? (
                      <span className="meta-chip">风险：{riskLevel}</span>
                    ) : null}
                    {typeof targetModule === 'string' && targetModule ? (
                      <span className="meta-chip">模块：{targetModule}</span>
                    ) : null}
                  </div>
                  <div className="proposal-item__time">
                    <span>发起 {formatTime(proposal.createdAt)}</span>
                    {proposal.updatedAt && proposal.updatedAt !== proposal.createdAt ? (
                      <span>更新 {formatTime(proposal.updatedAt)}</span>
                    ) : null}
                  </div>
                </button>
                <button
                  type="button"
                  className="proposal-item__delete"
                  onClick={() => setPendingDeleteProposalId(proposal.id)}
                  aria-label={`删除提案 ${proposal.topic}`}
                >
                  删除
                </button>
              </div>
            )
          })}
        </div>
      </section>

      {activeProposal ? (
        <section className="council-panel proposal-detail">
          <h2>提案详情 · {activeProposal.topic}</h2>

          <article className="detail-proposal">
            <div className="message-meta">
              <span className={`speaker-tag ${getSpeakerMeta(activeProposal.speaker).className}`}>
                {getSpeakerMeta(activeProposal.speaker).label}
              </span>
              <span className={`status-tag ${getStatusMeta(activeProposal.proposalStatus).className}`}>
                {getStatusMeta(activeProposal.proposalStatus).label}
              </span>
            </div>
            <p className="detail-proposal__body">{activeProposal.message}</p>
            <div className="proposal-item__meta">
              {typeof activeProposal.metadata?.risk_level === 'string' && activeProposal.metadata.risk_level ? (
                <span className="meta-chip">风险：{activeProposal.metadata.risk_level}</span>
              ) : null}
              {typeof activeProposal.metadata?.target_module === 'string' && activeProposal.metadata.target_module ? (
                <span className="meta-chip">模块：{activeProposal.metadata.target_module}</span>
              ) : null}
            </div>
            <div className="proposal-item__time">
              <span>发起 {formatTime(activeProposal.createdAt)}</span>
              {activeProposal.updatedAt && activeProposal.updatedAt !== activeProposal.createdAt ? (
                <span>更新 {formatTime(activeProposal.updatedAt)}</span>
              ) : null}
            </div>
          </article>

          <div className="detail-section">
            <h3>评估回复（{activeReviews.length}）</h3>
            {activeReviews.length === 0 ? <p className="council-empty">还没有评估回复。</p> : null}
            <div className="message-list">
              {activeReviews.map((review) => {
                const speakerMeta = getSpeakerMeta(review.speaker)
                return (
                  <article key={review.id} className="message-item">
                    <div className="message-meta">
                      <span className={`speaker-tag ${speakerMeta.className}`}>{speakerMeta.label}</span>
                      <div className="message-meta__right">
                        {review.vote ? (
                          <span className={`vote-tag ${VOTE_META[review.vote].className}`}>{VOTE_META[review.vote].label}</span>
                        ) : null}
                        <time>{formatTime(review.createdAt)}</time>
                      </div>
                    </div>
                    <p>{review.message}</p>
                  </article>
                )
              })}
            </div>
            <form className="council-form" onSubmit={handleAddReview}>
              <div className="council-field-row">
                <label className="council-field">
                  <span>评估身份</span>
                  <select value={reviewSpeaker} onChange={(e) => setReviewSpeaker(e.target.value as AgentCouncilSpeaker)}>
                    {SPEAKER_OPTIONS.map((speaker) => (
                      <option key={speaker} value={speaker}>{SPEAKER_META[speaker].label}</option>
                    ))}
                  </select>
                </label>
                <label className="council-field">
                  <span>态度</span>
                  <select value={reviewVote} onChange={(e) => setReviewVote(e.target.value as AgentCouncilVote)}>
                    {VOTE_OPTIONS.map((vote) => (
                      <option key={vote} value={vote}>{VOTE_META[vote].label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <textarea value={reviewMessage} onChange={(e) => setReviewMessage(e.target.value)} rows={3} placeholder="评估意见" />
              <button type="submit" disabled={saving}>提交评估</button>
            </form>
          </div>

          <div className="detail-section">
            <h3>串串拍板记录（{activeDecisions.length}）</h3>
            {activeDecisions.length === 0 ? <p className="council-empty">还没有拍板记录。</p> : null}
            <div className="message-list">
              {activeDecisions.map((decision) => {
                const speakerMeta = getSpeakerMeta(decision.speaker)
                const decisionStatus = decision.metadata?.decision_status
                const statusLabel =
                  typeof decisionStatus === 'string' && decisionStatus in STATUS_META
                    ? STATUS_META[decisionStatus as AgentCouncilProposalStatus].label
                    : null
                return (
                  <article key={decision.id} className="message-item decision-item">
                    <div className="message-meta">
                      <span className={`speaker-tag ${speakerMeta.className}`}>{speakerMeta.label}</span>
                      <div className="message-meta__right">
                        {statusLabel ? <span className="status-tag status-decision">{statusLabel}</span> : null}
                        <time>{formatTime(decision.createdAt)}</time>
                      </div>
                    </div>
                    <p>{decision.message}</p>
                  </article>
                )
              })}
            </div>
            <div className="decision-box">
              <textarea
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                rows={2}
                placeholder="拍板说明（可选）"
              />
              <p className="decision-hint">
                拍板「{DECISION_META.approved.label}」只代表允许后续由 Mac mini 监听脚本生成本地执行方案，不会自动执行代码或数据库操作。
              </p>
              <div className="decision-actions">
                {(['approved', 'rejected', 'deferred'] as DecisionAction[]).map((action) => (
                  <button
                    key={action}
                    type="button"
                    className={`decision-btn ${DECISION_META[action].className}`}
                    onClick={() => void handleDecide(action)}
                    disabled={saving}
                  >
                    {DECISION_META[action].label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {legacyTopics.length > 0 ? (
        <section className="council-panel">
          <div className="legacy-header">
            <h2>历史消息（旧版）</h2>
            <button type="button" className="legacy-toggle" onClick={() => setShowLegacy((prev) => !prev)}>
              {showLegacy ? '收起' : `展开（${legacyTopics.length}）`}
            </button>
          </div>
          {showLegacy ? (
            <div className="legacy-list">
              {legacyTopics.map((group) => (
                <div key={group.topic} className="legacy-topic">
                  <div className="legacy-topic__head">
                    <strong>{group.topic}</strong>
                    <button
                      type="button"
                      className="proposal-item__delete"
                      onClick={() => setPendingDeleteLegacyTopic(group.topic)}
                      aria-label={`删除历史议题 ${group.topic}`}
                    >
                      删除
                    </button>
                  </div>
                  <div className="message-list">
                    {group.items.map((item) => {
                      const speakerMeta = getSpeakerMeta(item.speaker)
                      return (
                        <article key={item.id} className="message-item">
                          <div className="message-meta">
                            <span className={`speaker-tag ${speakerMeta.className}`}>{speakerMeta.label}</span>
                            <time>{formatTime(item.createdAt)}</time>
                          </div>
                          <p>{item.message}</p>
                        </article>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <ConfirmDialog
        open={pendingDeleteProposalId !== null}
        title="删除提案"
        description="确定要删除这条提案吗？该提案下的全部评估与拍板记录都会一并删除，且无法恢复。"
        confirmLabel={deleting ? '删除中…' : '删除'}
        cancelLabel="取消"
        confirmDisabled={deleting}
        cancelDisabled={deleting}
        onConfirm={() => void handleConfirmDeleteProposal()}
        onCancel={() => setPendingDeleteProposalId(null)}
      />

      <ConfirmDialog
        open={pendingDeleteLegacyTopic !== null}
        title="删除历史消息"
        description={pendingDeleteLegacyTopic ? `确定要删除历史议题「${pendingDeleteLegacyTopic}」下的全部消息吗？此操作无法恢复。` : undefined}
        confirmLabel={deleting ? '删除中…' : '删除'}
        cancelLabel="取消"
        confirmDisabled={deleting}
        cancelDisabled={deleting}
        onConfirm={() => void handleConfirmDeleteLegacy()}
        onCancel={() => setPendingDeleteLegacyTopic(null)}
      />
    </div>
  )
}

export default AgentCouncilPage
