import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'
import MarkdownRenderer from '../components/MarkdownRenderer'
import {
  createAgentCouncilProposal,
  createAgentCouncilReview,
  decideAgentCouncilProposal,
  deleteAgentCouncilProposal,
  deleteAgentCouncilTopic,
  listAgentCouncilMessages,
  submitAgentCouncilReport,
} from '../storage/supabaseSync'
import type {
  AgentCouncilCategory,
  AgentCouncilExecutor,
  AgentCouncilMessage,
  AgentCouncilProposalStatus,
  AgentCouncilReportResult,
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
  approved: { label: '已拍板，待执行', className: 'status-approved' },
  rejected: { label: '已拒绝', className: 'status-rejected' },
  deferred: { label: '暂缓', className: 'status-deferred' },
  plan_generated: { label: '执行案已生成', className: 'status-plan' },
  done: { label: '已完成', className: 'status-done' },
  failed: { label: '执行失败', className: 'status-failed' },
}

const getStatusMeta = (status: AgentCouncilProposalStatus | null) =>
  status ? STATUS_META[status] : STATUS_META.open

// 状态分组：列表第一维筛选。进行中=还没闭环的；失败单列出来等改派。
const STATUS_GROUPS = [
  { key: 'all', label: '全部', statuses: null },
  { key: 'active', label: '进行中', statuses: ['open', 'approved', 'plan_generated'] },
  { key: 'done', label: '已完成', statuses: ['done'] },
  { key: 'failed', label: '失败', statuses: ['failed'] },
  { key: 'closed', label: '已关闭', statuses: ['rejected', 'deferred'] },
] as const

type StatusGroupKey = (typeof STATUS_GROUPS)[number]['key']

// 分类值域由 MCP 工具层维护；这里只管展示文案，未知分类原样显示不崩。
const CATEGORY_META: Record<string, string> = {
  app: 'App 施工',
  memory: '记忆机制',
  infra: '基建运维',
  ritual: '仪式',
  reading: '阅读线',
  game: '游戏区',
  council: '议事厅',
  other: '其他',
}

const getCategoryLabel = (category: string | null) =>
  category ? (CATEGORY_META[category] ?? category) : null

const CATEGORY_OPTIONS: AgentCouncilCategory[] = [
  'app',
  'memory',
  'infra',
  'ritual',
  'reading',
  'game',
  'council',
  'other',
]

const EXECUTOR_META: Record<AgentCouncilExecutor, string> = {
  codex_cli: 'Codex CLI',
  claude_code_cli: 'Claude Code CLI',
  client: '客户端聊天',
  chuanchuan: '串串手工',
}

const EXECUTOR_OPTIONS: AgentCouncilExecutor[] = ['codex_cli', 'claude_code_cli', 'client', 'chuanchuan']

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

const REPORT_RESULT_META: Record<AgentCouncilReportResult, { label: string; className: string }> = {
  succeeded: { label: '成功', className: 'report-succeeded' },
  partial: { label: '部分完成', className: 'report-partial' },
  failed: { label: '失败', className: 'report-failed' },
}

const REPORT_RESULT_OPTIONS: AgentCouncilReportResult[] = ['succeeded', 'partial', 'failed']

// 回执表单只对拍板后的提案开放；done 时用于补发修正回执（家规：不改写历史，再发一条）。
const REPORTABLE_STATUSES: AgentCouncilProposalStatus[] = ['approved', 'plan_generated', 'failed', 'done']

const formatTime = (value: string | null) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'

const summarize = (text: string, max = 80) => {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized
}

// 提案正文普遍是密集长文：超过阈值默认折叠，展开后再读全文。
const COLLAPSE_THRESHOLD = 360

const CollapsibleMarkdown = ({ content }: { content: string }) => {
  const [expanded, setExpanded] = useState(false)
  const needsCollapse = content.length > COLLAPSE_THRESHOLD
  return (
    <div className="council-markdown">
      <div className={`council-markdown__body ${needsCollapse && !expanded ? 'is-collapsed' : ''}`}>
        <MarkdownRenderer content={content} />
      </div>
      {needsCollapse ? (
        <button type="button" className="collapse-toggle" onClick={() => setExpanded((prev) => !prev)}>
          {expanded ? '收起' : '展开全文'}
        </button>
      ) : null}
    </div>
  )
}

// 每行一条 → string[]，供回执的产出物/遗留项输入。
const splitLines = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value)

const AgentCouncilPage = () => {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<AgentCouncilMessage[]>([])
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // 列表两维筛选：状态分组 × 分类
  const [statusGroup, setStatusGroup] = useState<StatusGroupKey>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  // 发起提案表单
  const [newSpeaker, setNewSpeaker] = useState<AgentCouncilSpeaker>('chuanchuan')
  const [newTopic, setNewTopic] = useState('')
  const [newMessage, setNewMessage] = useState('')
  const [newCategory, setNewCategory] = useState<AgentCouncilCategory>('other')
  const [newRiskLevel, setNewRiskLevel] = useState('')
  const [newTargetModule, setNewTargetModule] = useState('')

  // 评估回复表单
  const [reviewSpeaker, setReviewSpeaker] = useState<AgentCouncilSpeaker>('chuanchuan')
  const [reviewVote, setReviewVote] = useState<AgentCouncilVote>('support')
  const [reviewMessage, setReviewMessage] = useState('')

  // 拍板：说明 + 执行方指派（'' = 暂不指派，不唤醒任何脚本）
  const [decisionNote, setDecisionNote] = useState('')
  const [decisionExecutor, setDecisionExecutor] = useState<AgentCouncilExecutor | ''>('')

  // 执行回执表单
  const [reportSpeaker, setReportSpeaker] = useState<AgentCouncilSpeaker>('chuanchuan')
  const [reportResult, setReportResult] = useState<AgentCouncilReportResult>('succeeded')
  const [reportMessage, setReportMessage] = useState('')
  const [reportArtifacts, setReportArtifacts] = useState('')
  const [reportFollowUps, setReportFollowUps] = useState('')

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

  // 分类筛选 chips 只列实际出现过的分类，避免一排空标签。
  const presentCategories = useMemo(() => {
    const set = new Set<string>()
    proposals.forEach((item) => {
      if (item.category) set.add(item.category)
    })
    return Array.from(set).sort()
  }, [proposals])

  const filteredProposals = useMemo(() => {
    const group = STATUS_GROUPS.find((item) => item.key === statusGroup)
    return proposals.filter((item) => {
      if (group?.statuses) {
        const status = item.proposalStatus ?? 'open'
        if (!(group.statuses as readonly string[]).includes(status)) return false
      }
      if (categoryFilter !== 'all' && (item.category ?? 'other') !== categoryFilter) return false
      return true
    })
  }, [proposals, statusGroup, categoryFilter])

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

  // 切换提案时，把拍板指派复位为当前主行的 executor，回执表单清空。
  useEffect(() => {
    setDecisionExecutor(activeProposal?.executor ?? '')
    setReportMessage('')
    setReportArtifacts('')
    setReportFollowUps('')
    setReportResult('succeeded')
  }, [activeProposal?.id, activeProposal?.executor])

  const activeChildren = useCallback(
    (entryType: AgentCouncilMessage['entryType']) => {
      if (!activeProposalId) return []
      return messages
        .filter((item) => item.parentId === activeProposalId && item.entryType === entryType)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    },
    [activeProposalId, messages],
  )

  const activeReviews = useMemo(() => activeChildren('review'), [activeChildren])
  const activeDecisions = useMemo(() => activeChildren('decision'), [activeChildren])
  const activeReports = useMemo(() => activeChildren('report'), [activeChildren])

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
        category: newCategory,
        metadata,
      })
      setNewTopic('')
      setNewMessage('')
      setNewRiskLevel('')
      setNewTargetModule('')
      setNewCategory('other')
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
        category: activeProposal.category,
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
      const executor = status === 'approved' && decisionExecutor ? decisionExecutor : null
      await decideAgentCouncilProposal({
        proposalId: activeProposal.id,
        topic: activeProposal.topic,
        status,
        note: decisionNote,
        speaker: 'chuanchuan',
        executor,
        category: activeProposal.category,
      })
      setDecisionNote('')
      setNotice(
        status === 'approved' && executor
          ? `串串已拍板：${DECISION_META[status].label}，指派 ${EXECUTOR_META[executor]}`
          : `串串已拍板：${DECISION_META[status].label}`,
      )
      setError(null)
      await refresh()
    } catch (decideError) {
      console.warn('拍板失败', decideError)
      setError('拍板失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const handleSubmitReport = async (event: FormEvent) => {
    event.preventDefault()
    if (!activeProposal) {
      return
    }
    const message = reportMessage.trim()
    if (!message) {
      setError('回执正文不能为空：干了什么 / 怎么验证的 / 遗留什么')
      return
    }
    setSaving(true)
    try {
      await submitAgentCouncilReport({
        proposalId: activeProposal.id,
        speaker: reportSpeaker,
        message,
        result: reportResult,
        artifacts: splitLines(reportArtifacts),
        followUps: splitLines(reportFollowUps),
      })
      setReportMessage('')
      setReportArtifacts('')
      setReportFollowUps('')
      setNotice(`执行回执已提交（${REPORT_RESULT_META[reportResult].label}）`)
      setError(null)
      await refresh()
    } catch (reportError) {
      console.warn('提交回执失败', reportError)
      setError('提交回执失败，请稍后重试')
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

  const canReport = activeProposal
    ? REPORTABLE_STATUSES.includes(activeProposal.proposalStatus ?? 'open')
    : false

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
          <div className="council-field-row">
            <label className="council-field">
              <span>发起身份</span>
              <select value={newSpeaker} onChange={(e) => setNewSpeaker(e.target.value as AgentCouncilSpeaker)}>
                {SPEAKER_OPTIONS.map((speaker) => (
                  <option key={speaker} value={speaker}>{SPEAKER_META[speaker].label}</option>
                ))}
              </select>
            </label>
            <label className="council-field">
              <span>主题分类</span>
              <select value={newCategory} onChange={(e) => setNewCategory(e.target.value as AgentCouncilCategory)}>
                {CATEGORY_OPTIONS.map((category) => (
                  <option key={category} value={category}>{CATEGORY_META[category]}</option>
                ))}
              </select>
            </label>
          </div>
          <input value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="议题名称（topic）" />
          <textarea value={newMessage} onChange={(e) => setNewMessage(e.target.value)} rows={4} placeholder="提案全文（支持 Markdown）" />
          <div className="council-field-row">
            <input value={newRiskLevel} onChange={(e) => setNewRiskLevel(e.target.value)} placeholder="风险等级（可选）" />
            <input value={newTargetModule} onChange={(e) => setNewTargetModule(e.target.value)} placeholder="目标模块（可选）" />
          </div>
          <button type="submit" disabled={saving}>发起提案</button>
        </form>
      </section>

      <section className="council-panel">
        <h2>主提案列表</h2>
        <div className="council-filters">
          <div className="filter-row">
            {STATUS_GROUPS.map((group) => (
              <button
                key={group.key}
                type="button"
                className={`filter-chip ${statusGroup === group.key ? 'active' : ''}`}
                onClick={() => setStatusGroup(group.key)}
              >
                {group.label}
              </button>
            ))}
          </div>
          {presentCategories.length > 0 ? (
            <div className="filter-row">
              <button
                type="button"
                className={`filter-chip filter-chip--category ${categoryFilter === 'all' ? 'active' : ''}`}
                onClick={() => setCategoryFilter('all')}
              >
                全部分类
              </button>
              {presentCategories.map((category) => (
                <button
                  key={category}
                  type="button"
                  className={`filter-chip filter-chip--category ${categoryFilter === category ? 'active' : ''}`}
                  onClick={() => setCategoryFilter(category)}
                >
                  {getCategoryLabel(category)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {loading ? <p className="council-empty">加载中…</p> : null}
        {!loading && proposals.length === 0 ? <p className="council-empty">暂时还没有正式提案。</p> : null}
        {!loading && proposals.length > 0 && filteredProposals.length === 0 ? (
          <p className="council-empty">这个筛选条件下没有提案。</p>
        ) : null}
        <div className="proposal-list">
          {filteredProposals.map((proposal) => {
            const statusMeta = getStatusMeta(proposal.proposalStatus)
            const speakerMeta = getSpeakerMeta(proposal.speaker)
            const categoryLabel = getCategoryLabel(proposal.category)
            const riskLevel = proposal.metadata?.risk_level
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
                    {categoryLabel ? <span className="category-tag">{categoryLabel}</span> : null}
                    {proposal.executor ? (
                      <span className="executor-tag">→ {EXECUTOR_META[proposal.executor]}</span>
                    ) : null}
                    {typeof riskLevel === 'string' && riskLevel ? (
                      <span className="meta-chip">风险：{riskLevel}</span>
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
            <CollapsibleMarkdown content={activeProposal.message} />
            <div className="proposal-item__meta">
              {getCategoryLabel(activeProposal.category) ? (
                <span className="category-tag">{getCategoryLabel(activeProposal.category)}</span>
              ) : null}
              {activeProposal.executor ? (
                <span className="executor-tag">执行方：{EXECUTOR_META[activeProposal.executor]}</span>
              ) : null}
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
                    <CollapsibleMarkdown content={review.message} />
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
              <textarea value={reviewMessage} onChange={(e) => setReviewMessage(e.target.value)} rows={3} placeholder="评估意见（支持 Markdown）" />
              <button type="submit" disabled={saving}>提交评估</button>
            </form>
          </div>

          <div className="detail-section">
            <h3>串串拍板记录（{activeDecisions.length}）</h3>
            {activeDecisions.length === 0 ? <p className="council-empty">还没有拍板记录。</p> : null}
            <div className="message-list">
              {activeDecisions.map((decision) => {
                const speakerMeta = getSpeakerMeta(decision.speaker)
                // Web 旧写法把拍板状态放 metadata.decision_status；MCP 写在行内 proposal_status。两处都认。
                const rawStatus = decision.proposalStatus ?? decision.metadata?.decision_status
                const statusLabel =
                  typeof rawStatus === 'string' && rawStatus in STATUS_META
                    ? STATUS_META[rawStatus as AgentCouncilProposalStatus].label
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
              <label className="council-field">
                <span>指派执行方（仅「拍板执行」时生效）</span>
                <select
                  value={decisionExecutor}
                  onChange={(e) => setDecisionExecutor(e.target.value as AgentCouncilExecutor | '')}
                >
                  <option value="">暂不指派（不唤醒任何脚本）</option>
                  {EXECUTOR_OPTIONS.map((executor) => (
                    <option key={executor} value={executor}>{EXECUTOR_META[executor]}</option>
                  ))}
                </select>
              </label>
              <textarea
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                rows={2}
                placeholder="拍板说明（可选）"
              />
              <p className="decision-hint">
                只有指派 Codex CLI / Claude Code CLI 才会唤醒 Mac mini 接单脚本；「暂不指派」「客户端聊天」「串串手工」都不会触发任何自动执行。再次拍板即可改派。
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

          <div className="detail-section">
            <h3>执行回执（{activeReports.length}）</h3>
            {activeReports.length === 0 ? <p className="council-empty">还没有执行回执。</p> : null}
            <div className="message-list">
              {activeReports.map((report) => {
                const speakerMeta = getSpeakerMeta(report.speaker)
                const result = report.metadata?.result
                const resultMeta =
                  typeof result === 'string' && result in REPORT_RESULT_META
                    ? REPORT_RESULT_META[result as AgentCouncilReportResult]
                    : null
                const artifacts = Array.isArray(report.metadata?.artifacts)
                  ? (report.metadata.artifacts as unknown[]).filter((item): item is string => typeof item === 'string')
                  : []
                const followUps = Array.isArray(report.metadata?.follow_ups)
                  ? (report.metadata.follow_ups as unknown[]).filter((item): item is string => typeof item === 'string')
                  : []
                return (
                  <article key={report.id} className="message-item report-item">
                    <div className="message-meta">
                      <span className={`speaker-tag ${speakerMeta.className}`}>{speakerMeta.label}</span>
                      <div className="message-meta__right">
                        {resultMeta ? <span className={`report-tag ${resultMeta.className}`}>{resultMeta.label}</span> : null}
                        <time>{formatTime(report.createdAt)}</time>
                      </div>
                    </div>
                    <CollapsibleMarkdown content={report.message} />
                    {artifacts.length > 0 ? (
                      <div className="report-extras">
                        <span className="report-extras__label">产出物</span>
                        <ul>
                          {artifacts.map((item, index) => (
                            <li key={`${report.id}-artifact-${index}`}>
                              {isHttpUrl(item) ? <a href={item} target="_blank" rel="noreferrer">{item}</a> : item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {followUps.length > 0 ? (
                      <div className="report-extras">
                        <span className="report-extras__label">遗留事项</span>
                        <ul>
                          {followUps.map((item, index) => (
                            <li key={`${report.id}-followup-${index}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>
            {canReport ? (
              <form className="council-form report-form" onSubmit={handleSubmitReport}>
                <div className="council-field-row">
                  <label className="council-field">
                    <span>执行方（谁执行谁执笔）</span>
                    <select value={reportSpeaker} onChange={(e) => setReportSpeaker(e.target.value as AgentCouncilSpeaker)}>
                      {SPEAKER_OPTIONS.map((speaker) => (
                        <option key={speaker} value={speaker}>{SPEAKER_META[speaker].label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="council-field">
                    <span>执行结果</span>
                    <select value={reportResult} onChange={(e) => setReportResult(e.target.value as AgentCouncilReportResult)}>
                      {REPORT_RESULT_OPTIONS.map((result) => (
                        <option key={result} value={result}>{REPORT_RESULT_META[result].label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <textarea
                  value={reportMessage}
                  onChange={(e) => setReportMessage(e.target.value)}
                  rows={3}
                  placeholder="回执正文：干了什么 / 怎么验证的 / 遗留什么（支持 Markdown）"
                />
                <textarea
                  value={reportArtifacts}
                  onChange={(e) => setReportArtifacts(e.target.value)}
                  rows={2}
                  placeholder="产出物（可选，每行一条：PR 链接 / migration 版本 / 文件路径）"
                />
                <textarea
                  value={reportFollowUps}
                  onChange={(e) => setReportFollowUps(e.target.value)}
                  rows={2}
                  placeholder="遗留事项（可选，每行一条；部分完成时建议填写）"
                />
                <p className="decision-hint">
                  提交后自动闭环：成功/部分完成 → 已完成；失败 → 执行失败（等改派或重试），并推送横幅通知。回执写错不改写，再发一条修正即可。
                </p>
                <button type="submit" disabled={saving}>提交回执</button>
              </form>
            ) : (
              <p className="council-empty">拍板执行后才能提交回执。</p>
            )}
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
        description="确定要删除这条提案吗？该提案下的全部评估、拍板与回执记录都会一并删除，且无法恢复。"
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
