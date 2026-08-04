import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { Link } from 'react-router-dom'
import {
  applyPromptRecommendation,
  getPromptRecommendationLabel,
  getPromptTemplateLabel,
} from '../lib/promptPresentation'
import { supabase } from '../supabase/client'
import type { Json } from '../supabase/database.types'
import './HamsterConsolePage.css'

type ChannelConfigRow = {
  user_id: string
  channel_name: string
  active_model: string | null
}

type AgentSettingsRow = {
  user_id: string
  checkin_enabled: boolean
  day_mode_start_hour: number
  day_mode_end_hour: number
  day_min_interval_minutes: number
  day_max_interval_minutes: number
  night_mode_start_hour: number
  night_mode_end_hour: number
  night_min_interval_minutes: number
  night_max_interval_minutes: number
  quiet_hours_start_hour: number | null
  quiet_hours_end_hour: number | null
  cooldown_after_interaction_minutes: number
  max_daily_checkins_day: number
  max_daily_checkins_night: number
  per_channel_schedule: Json
  wechat_context_summary_model: string | null
  wechat_context_window_rounds: number | null
  wechat_context_summary_trigger_rounds: number | null
  wechat_context_summary_refresh_rounds: number | null
  wechat_memory_search_min_length: number | null
  wechat_memory_search_enabled: boolean | null
  agent_mode: string | null
}

type PromptTemplateRow = {
  id: string
  name: string
  category: 'base' | 'scenario' | 'style' | string
  content: string
  version: number
  active: boolean
}

type SyzygyCommandRow = {
  id: string
  command_type: string
  status: string
  payload: unknown
  result: unknown
  created_at: string
  completed_at: string | null
}

type ProviderModelRow = {
  model_id: string
  enabled?: boolean | null
}

type WechatQueueSummary = {
  pending: number
  sending: number
  failed: number
  error: string | null
}

type AgentTaskRow = {
  id: string
  created_at: string | null
  source: string | null
  executor: string | null
  command: string | null
  status: string | null
  result_summary: string | null
  result_detail: unknown
  error: string | null
  payload_json: unknown
  correlation_id: string | null
  parent_task_id: string | null
  started_at: string | null
  completed_at: string | null
}

type ContextSnapshotRow = {
  id: string
  snapshot_type: string | null
  summary_text: string | null
  stale_after: string | null
  created_at: string | null
}

type DailyDigestRow = {
  id: string
  period_of_day: string
  summary_text: string | null
  created_at: string | null
}

type PrintCapsuleRow = {
  id: string
  title: string | null
  type: string | null
  paper_size: string | null
  status: string | null
  trigger_reason: string | null
  created_at: string | null
  scheduled_print_week: string | null
  sort_order: number | null
  hidden_until_printed: boolean | null
  content: string | null
}

type CapabilityRow = {
  id: string
  name: string | null
  description: string | null
  risk_level: string | null
  enabled: boolean | null
  requires_confirmation: boolean | null
  output_channel: string | null
  last_used_at: string | null
  cooldown_until: string | null
  usage_count: number | null
  failure_count: number | null
}

type CodexControlRow = {
  id: string
  action: 'wake' | 'sleep' | string
  status: 'pending' | 'executed' | string
  created_at: string
}

type CodexControlViewState = {
  tone: 'green' | 'gray' | 'yellow'
  label: string
  isRunning: boolean
}

const categoryLabelMap: Record<string, string> = {
  base: '基础',
  scenario: '场景',
  style: '风格',
}

const companionPromptNames = [
  'syzygy_base',
  'app_companion_reply_style',
  'checkin_day',
  'checkin_night',
] as const

const wechatPromptNames = ['wechat_reply_style'] as const
const companionPromptNameSet = new Set<string>(companionPromptNames)
const wechatPromptNameSet = new Set<string>(wechatPromptNames)

const formatJson = (value: unknown) => JSON.stringify(value ?? {}, null, 2)

const formatDateTime = (value: string | null) => {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const getTodayIsoRange = () => {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

const getCurrentWeekStart = () => {
  const now = new Date()
  const day = now.getDay() || 7
  now.setDate(now.getDate() - day + 1)
  now.setHours(0, 0, 0, 0)
  return now.toISOString().slice(0, 10)
}

function parseNumberField(value: string, fallback: number): number
function parseNumberField(value: string, fallback?: null): number | null
function parseNumberField(value: string, fallback: number | null = null) {
  if (value.trim() === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const toCodexControlViewState = (row: CodexControlRow | null): CodexControlViewState => {
  if (!row) return { tone: 'gray', label: '已关闭', isRunning: false }
  if (row.status === 'pending') return { tone: 'yellow', label: '执行中...', isRunning: row.action === 'wake' }
  if (row.action === 'wake' && row.status === 'executed') return { tone: 'green', label: '运行中', isRunning: true }
  if (row.action === 'sleep' && row.status === 'executed') return { tone: 'gray', label: '已关闭', isRunning: false }
  return { tone: 'gray', label: '已关闭', isRunning: false }
}

// CLI Syzygy Runtime（Mac mini 本地 Runtime）唤醒目标。点击后向 syzygy_commands 写入 wake 请求。
// working_dir 由本地 Runtime 的受控配置决定，前端不公开或覆盖本机路径。
const cliRuntimeTargets = [
  { role: 'codex_cli_syzygy', label: '唤醒 Codex CLI', taskContent: '唤醒 Codex CLI' },
  { role: 'claude_code_cli_syzygy', label: '唤醒 Claude Code CLI', taskContent: '唤醒 Claude Code CLI' },
] as const
type CliRuntimeRole = (typeof cliRuntimeTargets)[number]['role']
const cliRuntimeRoles = new Set<string>(cliRuntimeTargets.map((target) => target.role))
const cliRoleLabels: Record<string, string> = {
  codex_cli_syzygy: 'Codex CLI',
  claude_code_cli_syzygy: 'Claude Code CLI',
}

const HamsterConsolePage = ({ user }: { user: User | null }) => {
  const scopedUserId = user?.id ?? ''
  const [loading, setLoading] = useState(true)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [channels, setChannels] = useState<ChannelConfigRow[]>([])
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [savingChannelName, setSavingChannelName] = useState<string | null>(null)
  const [manualModelId, setManualModelId] = useState('')
  const [addingModel, setAddingModel] = useState(false)

  const [agentSettings, setAgentSettings] = useState<AgentSettingsRow | null>(null)
  const [agentForm, setAgentForm] = useState<Record<string, string>>({})
  const [perChannelScheduleText, setPerChannelScheduleText] = useState('{}')
  const [savingAgentSettings, setSavingAgentSettings] = useState(false)
  const [savingWechatContextSettings, setSavingWechatContextSettings] = useState(false)

  const [promptTemplates, setPromptTemplates] = useState<PromptTemplateRow[]>([])
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)
  const [templateDraft, setTemplateDraft] = useState('')
  const [savingTemplateId, setSavingTemplateId] = useState<string | null>(null)

  const [commands, setCommands] = useState<SyzygyCommandRow[]>([])
  const [expandedCommandId, setExpandedCommandId] = useState<string | null>(null)
  const [commandsLoading, setCommandsLoading] = useState(false)
  const [expandedSection, setExpandedSection] = useState('mini-control')
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    mini: true,
    companion: true,
    prompts: false,
    wechat: false,
    v3: true,
  })
  const [codexControlRow, setCodexControlRow] = useState<CodexControlRow | null>(null)
  const [codexActionLoading, setCodexActionLoading] = useState<'wake' | 'sleep' | null>(null)
  const [cliWakeLoading, setCliWakeLoading] = useState<CliRuntimeRole | null>(null)
  const [cliWakeFeedback, setCliWakeFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)

  const [wechatQueueSummary, setWechatQueueSummary] = useState<WechatQueueSummary>({ pending: 0, sending: 0, failed: 0, error: null })
  const [agentTasks, setAgentTasks] = useState<AgentTaskRow[]>([])
  const [agentTasksError, setAgentTasksError] = useState<string | null>(null)
  const [agentTaskStatusFilter, setAgentTaskStatusFilter] = useState('all')
  const [expandedAgentTaskId, setExpandedAgentTaskId] = useState<string | null>(null)
  const [contextSnapshot, setContextSnapshot] = useState<ContextSnapshotRow | null>(null)
  const [contextSnapshotError, setContextSnapshotError] = useState<string | null>(null)
  const [dailyDigests, setDailyDigests] = useState<DailyDigestRow[]>([])
  const [printCapsules, setPrintCapsules] = useState<PrintCapsuleRow[]>([])
  const [printCapsulesError, setPrintCapsulesError] = useState<string | null>(null)
  const [capsuleStatusFilter, setCapsuleStatusFilter] = useState('all')
  const [capsuleWeekFilter, setCapsuleWeekFilter] = useState(getCurrentWeekStart())
  const [expandedCapsuleId, setExpandedCapsuleId] = useState<string | null>(null)
  const [capabilities, setCapabilities] = useState<CapabilityRow[]>([])
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null)
  const activeTemplate = useMemo(
    () => promptTemplates.find((item) => item.id === activeTemplateId) ?? null,
    [promptTemplates, activeTemplateId],
  )
  const hasPromptDraftChanges = Boolean(
    activeTemplate &&
      templateDraft.trim() &&
      templateDraft !== activeTemplate.content,
  )
  const codexControlState = useMemo(() => toCodexControlViewState(codexControlRow), [codexControlRow])

  const recentCliRequests = useMemo(
    () =>
      commands
        .filter((command) => {
          const payload = (command.payload ?? {}) as { target_role?: string }
          return payload.target_role ? cliRuntimeRoles.has(payload.target_role) : false
        })
        .slice(0, 5),
    [commands],
  )

  const agentModeLabel = agentSettings?.agent_mode === 'quiet' ? '静默模式' : agentSettings?.agent_mode === 'paused' ? '自动化暂停' : '正常运行'
  const miniRunnerLabel = codexControlRow ? codexControlState.label : '等待接入'
  const agentModeTone = agentSettings?.agent_mode === 'quiet' ? 'yellow' : agentSettings?.agent_mode === 'paused' ? 'gray' : 'green'
  const wechatQueueHasFailed = wechatQueueSummary.failed > 0
  const todayTaskSummary = useMemo(() => {
    const counts = { completed: 0, failed: 0, running: 0 }
    agentTasks.forEach((task) => {
      if (task.status === 'completed') counts.completed += 1
      if (task.status === 'failed') counts.failed += 1
      if (task.status === 'running') counts.running += 1
    })
    return counts
  }, [agentTasks])
  const filteredAgentTasks = agentTaskStatusFilter === 'all' ? agentTasks : agentTasks.filter((task) => task.status === agentTaskStatusFilter)
  const filteredCapsules = printCapsules.filter((item) => (capsuleStatusFilter === 'all' || item.status === capsuleStatusFilter) && (!capsuleWeekFilter || item.scheduled_print_week === capsuleWeekFilter))
  const weeklyQueuedCount = printCapsules.filter((item) => item.scheduled_print_week === capsuleWeekFilter && item.status === 'queued').length
  const weeklyPrintedCount = printCapsules.filter((item) => item.scheduled_print_week === capsuleWeekFilter && item.status === 'printed').length
  const snapshotExpired = contextSnapshot?.stale_after ? new Date(contextSnapshot.stale_after).getTime() < nowMs : false

  const modelOptions = useMemo(() => {
    const merged = new Set<string>(availableModels)
    channels.forEach((item) => {
      if (item.active_model) merged.add(item.active_model)
    })
    const summaryModel = agentForm.wechat_context_summary_model?.trim()
    if (summaryModel) merged.add(summaryModel)
    return Array.from(merged)
  }, [availableModels, channels, agentForm.wechat_context_summary_model])
  const companionChannel = channels.find((item) => item.channel_name === 'app_companion') ?? null
  const backupChannels = channels.filter((item) => item.channel_name !== 'app_companion')
  const companionPromptTemplates = companionPromptNames
    .map((name) => promptTemplates.find((template) => template.name === name))
    .filter((template): template is PromptTemplateRow => Boolean(template))
  const otherPromptTemplates = promptTemplates.filter(
    (template) =>
      !companionPromptNameSet.has(template.name) &&
      !wechatPromptNameSet.has(template.name),
  )
  const wechatPromptTemplates = wechatPromptNames
    .map((name) => promptTemplates.find((template) => template.name === name))
    .filter((template): template is PromptTemplateRow => Boolean(template))
  const activeCompanionTemplate = activeTemplate && companionPromptNameSet.has(activeTemplate.name)
    ? activeTemplate
    : null
  const activeOtherTemplate = activeTemplate && otherPromptTemplates.some(
      (template) => template.id === activeTemplate.id,
    )
    ? activeTemplate
    : null
  const activeWechatTemplate = activeTemplate && wechatPromptNameSet.has(activeTemplate.name)
    ? activeTemplate
    : null

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => {
      setToast((current) => (current === message ? null : current))
    }, 2200)
  }, [])

  const loadCommands = useCallback(async () => {
    if (!supabase) {
      setErrorMessage('Supabase 未配置，请检查环境变量。')
      return
    }
    setCommandsLoading(true)
    const { data, error } = await supabase
      .from('syzygy_commands')
      .select('id, command_type, status, payload, result, created_at, completed_at')
      .eq('user_id', scopedUserId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      setErrorMessage(error.message)
      setCommandsLoading(false)
      return
    }

    setCommands(data ?? [])
    setCommandsLoading(false)
  }, [scopedUserId])

  const loadAll = useCallback(async () => {
    if (!supabase) {
      setErrorMessage('Supabase 未配置，请检查环境变量。')
      setLoading(false)
      return
    }

    setLoading(true)
    setNowMs(Date.now())
    setErrorMessage(null)

    const { start: todayStart, end: todayEnd } = getTodayIsoRange()
    const [channelRes, settingsRes, templateRes, commandsRes, modelRes, codexRes, wechatRes, taskRes, snapshotRes, digestRes, capsuleRes, capabilityRes] = await Promise.all([
      supabase
        .from('channel_config')
        .select('user_id, channel_name, active_model')
        .eq('user_id', scopedUserId)
        .order('channel_name', { ascending: true }),
      supabase
        .from('agent_settings')
        .select(
          'user_id, checkin_enabled, day_mode_start_hour, day_mode_end_hour, day_min_interval_minutes, day_max_interval_minutes, night_mode_start_hour, night_mode_end_hour, night_min_interval_minutes, night_max_interval_minutes, quiet_hours_start_hour, quiet_hours_end_hour, cooldown_after_interaction_minutes, max_daily_checkins_day, max_daily_checkins_night, per_channel_schedule, wechat_context_summary_model, wechat_context_window_rounds, wechat_context_summary_trigger_rounds, wechat_context_summary_refresh_rounds, wechat_memory_search_min_length, wechat_memory_search_enabled, agent_mode',
        )
        .eq('user_id', scopedUserId)
        .maybeSingle(),
      supabase
        .from('prompt_templates')
        .select('id, name, category, content, version, active')
        .eq('user_id', scopedUserId)
        .eq('active', true)
        .order('name', { ascending: true }),
      supabase
        .from('syzygy_commands')
        .select('id, command_type, status, payload, result, created_at, completed_at')
        .eq('user_id', scopedUserId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('provider_models')
        .select('model_id')
        .eq('enabled', true)
        .order('model_id', { ascending: true }),
      supabase
        .from('codex_control')
        .select('id, action, status, created_at')
        .eq('user_id', scopedUserId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('pending_wechat_messages').select('status').eq('user_id', scopedUserId).in('status', ['pending', 'sending', 'failed']),
      supabase.from('agent_tasks').select('id, created_at, source, executor, command, status, result_summary, result_detail, error, payload_json, correlation_id, parent_task_id, started_at, completed_at').gte('created_at', todayStart).lt('created_at', todayEnd).order('created_at', { ascending: false }).limit(50),
      supabase.from('current_context_snapshot').select('id, snapshot_type, summary_text, stale_after, created_at').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('daily_status_digest').select('id, period_of_day, summary_text, created_at').gte('created_at', todayStart).lt('created_at', todayEnd),
      supabase.from('print_capsules').select('id, title, type, paper_size, status, trigger_reason, created_at, scheduled_print_week, sort_order, hidden_until_printed, content').order('created_at', { ascending: false }).limit(80),
      supabase.from('capabilities').select('id, name, description, risk_level, enabled, requires_confirmation, output_channel, last_used_at, cooldown_until, usage_count, failure_count').order('name', { ascending: true }),
    ])

    if (channelRes.error || settingsRes.error || templateRes.error || commandsRes.error || modelRes.error || codexRes.error) {
      setErrorMessage(
        channelRes.error?.message ||
          settingsRes.error?.message ||
          templateRes.error?.message ||
          commandsRes.error?.message ||
          modelRes.error?.message ||
          codexRes.error?.message ||
          '加载失败',
      )
      setLoading(false)
      return
    }

    const channelRows = channelRes.data ?? []
    setChannels(channelRows)

    const modelRows = (modelRes.data ?? []) as ProviderModelRow[]
    setAvailableModels(modelRows.map((item) => item.model_id).filter((item) => item.trim().length > 0))
    setCodexControlRow((codexRes.data as CodexControlRow | null) ?? null)

    const settingsRow = settingsRes.data
    setAgentSettings(settingsRow)
    if (settingsRow) {
      setAgentForm({
        day_mode_start_hour: String(settingsRow.day_mode_start_hour ?? 8),
        day_mode_end_hour: String(settingsRow.day_mode_end_hour ?? 23),
        day_min_interval_minutes: String(settingsRow.day_min_interval_minutes ?? 3),
        day_max_interval_minutes: String(settingsRow.day_max_interval_minutes ?? 60),
        night_mode_start_hour: String(settingsRow.night_mode_start_hour ?? 23),
        night_mode_end_hour: String(settingsRow.night_mode_end_hour ?? 8),
        night_min_interval_minutes: String(settingsRow.night_min_interval_minutes ?? 60),
        night_max_interval_minutes: String(settingsRow.night_max_interval_minutes ?? 180),
        quiet_hours_start_hour: settingsRow.quiet_hours_start_hour == null ? '' : String(settingsRow.quiet_hours_start_hour),
        quiet_hours_end_hour: settingsRow.quiet_hours_end_hour == null ? '' : String(settingsRow.quiet_hours_end_hour),
        cooldown_after_interaction_minutes: String(settingsRow.cooldown_after_interaction_minutes ?? 15),
        max_daily_checkins_day: String(settingsRow.max_daily_checkins_day ?? 10),
        max_daily_checkins_night: String(settingsRow.max_daily_checkins_night ?? 3),
        wechat_context_summary_model: settingsRow.wechat_context_summary_model ?? 'deepseek/deepseek-chat',
        wechat_context_window_rounds: String(settingsRow.wechat_context_window_rounds ?? 20),
        wechat_context_summary_trigger_rounds: String(settingsRow.wechat_context_summary_trigger_rounds ?? 30),
        wechat_context_summary_refresh_rounds: String(settingsRow.wechat_context_summary_refresh_rounds ?? 10),
        wechat_memory_search_min_length: String(settingsRow.wechat_memory_search_min_length ?? 5),
      })
      setPerChannelScheduleText(JSON.stringify(settingsRow.per_channel_schedule ?? {}, null, 2))
    }

    const templates = templateRes.data ?? []
    setPromptTemplates(templates)
    const firstTemplate = templates[0] ?? null
    setActiveTemplateId(firstTemplate?.id ?? null)
    setTemplateDraft(firstTemplate?.content ?? '')

    setCommands(commandsRes.data ?? [])

    setWechatQueueSummary(wechatRes.error ? { pending: 0, sending: 0, failed: 0, error: wechatRes.error.message } : {
      pending: (wechatRes.data ?? []).filter((item: { status: string }) => item.status === 'pending').length,
      sending: (wechatRes.data ?? []).filter((item: { status: string }) => item.status === 'sending').length,
      failed: (wechatRes.data ?? []).filter((item: { status: string }) => item.status === 'failed').length,
      error: null,
    })
    setAgentTasks((taskRes.data ?? []) as AgentTaskRow[])
    setAgentTasksError(taskRes.error?.message ?? null)
    setContextSnapshot((snapshotRes.data as ContextSnapshotRow | null) ?? null)
    setContextSnapshotError(snapshotRes.error?.message ?? digestRes.error?.message ?? null)
    setDailyDigests((digestRes.data ?? []) as DailyDigestRow[])
    setPrintCapsules((capsuleRes.data ?? []) as PrintCapsuleRow[])
    setPrintCapsulesError(capsuleRes.error?.message ?? null)
    setCapabilities((capabilityRes.data ?? []) as CapabilityRow[])
    setCapabilitiesError(capabilityRes.error?.message ?? null)

    setLoading(false)
  }, [scopedUserId])

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    const channel = client
      .channel(`codex-control-${scopedUserId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'codex_control', filter: `user_id=eq.${scopedUserId}` },
        () => {
          void client
            .from('codex_control')
            .select('id, action, status, created_at')
            .eq('user_id', scopedUserId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
            .then(({ data }) => {
              setCodexControlRow((data as CodexControlRow | null) ?? null)
              setCodexActionLoading(null)
            })
        },
      )
      .subscribe()
    return () => {
      void client.removeChannel(channel)
    }
  }, [scopedUserId])

  const handleCodexControl = async (action: 'wake' | 'sleep') => {
    if (!supabase) return
    setCodexActionLoading(action)
    setErrorMessage(null)
    const { error } = await supabase.from('codex_control').insert({ user_id: scopedUserId, action, source: 'manual' })
    if (error) {
      setCodexActionLoading(null)
      setErrorMessage(error.message)
    }
  }

  const handleCliRuntimeWake = async (target: (typeof cliRuntimeTargets)[number]) => {
    if (!supabase) {
      setCliWakeFeedback({ tone: 'error', message: 'Supabase 未配置，请检查环境变量。' })
      return
    }
    setCliWakeLoading(target.role)
    setCliWakeFeedback(null)
    const { error } = await supabase.from('syzygy_commands').insert({
      user_id: scopedUserId,
      command_type: 'wake',
      status: 'pending',
      payload: {
        target_role: target.role,
        source: 'frontend',
        task_content: target.taskContent,
      },
    })
    setCliWakeLoading(null)
    if (error) {
      setCliWakeFeedback({ tone: 'error', message: `发送失败：${error.message}` })
      return
    }
    setCliWakeFeedback({ tone: 'success', message: `已发送唤醒请求（${cliRoleLabels[target.role]}）` })
    void loadCommands()
  }

  useEffect(() => {
    const handle = window.setTimeout(() => void loadAll(), 0)
    return () => window.clearTimeout(handle)
  }, [loadAll])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadCommands()
    }, 30_000)

    return () => window.clearInterval(timer)
  }, [loadCommands])

  const handleChannelModelChange = (channelName: string, model: string) => {
    setChannels((current) =>
      current.map((row) => (row.channel_name === channelName ? { ...row, active_model: model } : row)),
    )
  }

  const handleSaveChannelModel = async (channelName: string) => {
    if (!supabase) return
    const row = channels.find((item) => item.channel_name === channelName)
    if (!row?.active_model) return

    setSavingChannelName(channelName)
    const { error } = await supabase
      .from('channel_config')
      .update({ active_model: row.active_model })
      .eq('user_id', scopedUserId)
      .eq('channel_name', channelName)

    setSavingChannelName(null)
    if (error) {
      setErrorMessage(error.message)
      return
    }

    showToast(`模型已更新：${channelName}`)
  }

  const handleAgentFieldChange = (field: string, value: string) => {
    setAgentForm((current) => ({ ...current, [field]: value }))
  }

  const handleAddModel = async () => {
    if (!supabase || !scopedUserId) return
    const normalizedModelId = manualModelId.trim()
    if (!normalizedModelId) {
      setErrorMessage('请先输入 model_id')
      return
    }

    setAddingModel(true)
    setErrorMessage(null)
    const { data: provider, error: providerError } = await supabase
      .from('providers')
      .select('id')
      .eq('user_id', scopedUserId)
      .eq('enabled', true)
      .order('priority', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (providerError || !provider) {
      setAddingModel(false)
      setErrorMessage(providerError?.message ?? '没有可用的模型 Provider，请先在设置中配置。')
      return
    }

    const { error } = await supabase
      .from('provider_models')
      .upsert(
        {
          provider_id: provider.id,
          user_id: scopedUserId,
          model_id: normalizedModelId,
          enabled: true,
        },
        { onConflict: 'provider_id,model_id,model_type' },
      )

    setAddingModel(false)
    if (error) {
      setErrorMessage(error.message)
      return
    }

    setManualModelId('')
    void loadAll()
    showToast(`模型已添加：${normalizedModelId}`)
  }

  const handleSaveAgentSettings = async () => {
    if (!supabase || !agentSettings) return

    let parsedSchedule: Json = {}
    if (perChannelScheduleText.trim()) {
      try {
        const parsed = JSON.parse(perChannelScheduleText) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setErrorMessage('每渠道计划必须是 JSON 对象。')
          return
        }
        parsedSchedule = parsed as Json
      } catch {
        setErrorMessage('每渠道计划 JSON 解析失败，请检查格式。')
        return
      }
    }

    setSavingAgentSettings(true)
    const { error } = await supabase
      .from('agent_settings')
      .update({
        checkin_enabled: agentSettings.checkin_enabled,
        day_mode_start_hour: parseNumberField(agentForm.day_mode_start_hour, 8),
        day_mode_end_hour: parseNumberField(agentForm.day_mode_end_hour, 23),
        day_min_interval_minutes: parseNumberField(agentForm.day_min_interval_minutes, 3),
        day_max_interval_minutes: parseNumberField(agentForm.day_max_interval_minutes, 60),
        night_mode_start_hour: parseNumberField(agentForm.night_mode_start_hour, 23),
        night_mode_end_hour: parseNumberField(agentForm.night_mode_end_hour, 8),
        night_min_interval_minutes: parseNumberField(agentForm.night_min_interval_minutes, 60),
        night_max_interval_minutes: parseNumberField(agentForm.night_max_interval_minutes, 180),
        quiet_hours_start_hour: parseNumberField(agentForm.quiet_hours_start_hour),
        quiet_hours_end_hour: parseNumberField(agentForm.quiet_hours_end_hour),
        cooldown_after_interaction_minutes: parseNumberField(agentForm.cooldown_after_interaction_minutes, 15),
        max_daily_checkins_day: parseNumberField(agentForm.max_daily_checkins_day, 10),
        max_daily_checkins_night: parseNumberField(agentForm.max_daily_checkins_night, 3),
        per_channel_schedule: parsedSchedule,
      })
      .eq('user_id', scopedUserId)

    setSavingAgentSettings(false)
    if (error) {
      setErrorMessage(error.message)
      return
    }

    showToast('主动消息设置已保存')
  }

  const handleSaveWechatContextSettings = async () => {
    if (!supabase || !agentSettings) return

    setSavingWechatContextSettings(true)
    const { error } = await supabase
      .from('agent_settings')
      .update({
        wechat_context_summary_model: (agentForm.wechat_context_summary_model ?? '').trim() || null,
        wechat_context_window_rounds: parseNumberField(agentForm.wechat_context_window_rounds, 20),
        wechat_context_summary_trigger_rounds: parseNumberField(agentForm.wechat_context_summary_trigger_rounds, 30),
        wechat_context_summary_refresh_rounds: parseNumberField(agentForm.wechat_context_summary_refresh_rounds, 10),
        wechat_memory_search_min_length: parseNumberField(agentForm.wechat_memory_search_min_length, 5),
        wechat_memory_search_enabled: agentSettings.wechat_memory_search_enabled ?? true,
      })
      .eq('user_id', scopedUserId)

    setSavingWechatContextSettings(false)
    if (error) {
      setErrorMessage(error.message)
      return
    }

    showToast('上下文设置已保存')
  }

  const handleSelectTemplate = (templateId: string) => {
    const template = promptTemplates.find((item) => item.id === templateId)
    setActiveTemplateId(templateId)
    setTemplateDraft(template?.content ?? '')
  }

  const handleApplyPromptRecommendation = () => {
    if (!activeTemplate) return
    const recommendedDraft = applyPromptRecommendation(
      activeTemplate.name,
      templateDraft,
    )
    if (recommendedDraft === templateDraft) {
      showToast('当前草稿已经符合这项整理规则')
      return
    }
    setTemplateDraft(recommendedDraft)
    showToast('建议内容已填入草稿；确认后再发布新版本')
  }

  const handleSaveTemplate = async () => {
    if (!supabase || !activeTemplate) return
    if (!templateDraft.trim() || templateDraft === activeTemplate.content) return
    setSavingTemplateId(activeTemplate.id)

    const { data, error } = await supabase.rpc('prompt_template_publish', {
      p_name: activeTemplate.name,
      p_category: activeTemplate.category,
      p_content: templateDraft,
      p_expected_active_version: activeTemplate.version,
    })

    setSavingTemplateId(null)
    if (error || !data) {
      setErrorMessage(error?.message ?? 'Prompt 发布未返回新版本')
      return
    }

    setPromptTemplates((current) =>
      current
        .map((item) => (item.id === activeTemplate.id ? data : item))
        .sort((left, right) => left.name.localeCompare(right.name)),
    )
    setActiveTemplateId(data.id)
    setTemplateDraft(data.content)
    showToast(`Prompt 已发布：${getPromptTemplateLabel(data.name)} v${data.version}`)
  }

  const toggleSection = (sectionId: string) => {
    setExpandedSection((current) => (current === sectionId ? '' : sectionId))
  }

  const toggleGroup = (groupId: 'mini' | 'companion' | 'prompts' | 'wechat' | 'v3') => {
    setExpandedGroups((current) => ({ ...current, [groupId]: !current[groupId] }))
  }

  return (
    <div className="hamster-console-page">
      <header className="hamster-console-page__header">
        <Link to="/" className="hamster-console-page__back">← 返回小窝</Link>
        <div className="hamster-console-page__title-wrap">
          <p className="hamster-console-page__kicker">HAMSTER MACHINE</p>
          <h1 className="ui-title">仓鼠机</h1>
        </div>
        <p>远程控制 Mini Agent（用户：{scopedUserId.slice(0, 8)}...）</p>
      </header>

      {errorMessage ? <div className="hamster-console-alert">{errorMessage}</div> : null}
      {toast ? <div className="hamster-console-toast">{toast}</div> : null}

      {loading ? <div className="hamster-console-loading">正在加载仓鼠机面板...</div> : null}

      {!loading ? (
        <>
          <section className="hamster-console-status-grid" aria-label="顶部状态仪表盘">
            <article className="hamster-status-card hamster-status-card--agent">
              <div className="hamster-status-card__topline"><span className={`hamster-console-codex-dot ${agentModeTone}`} aria-hidden /><span>Agent 模式</span><span className="hamster-status-card__icon" aria-hidden>●</span></div>
              <strong>{agentModeLabel}</strong>
              <small>{agentSettings?.agent_mode ?? 'active'}</small>
            </article>
            <article className="hamster-status-card hamster-status-card--runner">
              <div className="hamster-status-card__topline"><span>Mini Runner</span><span className="hamster-status-card__icon" aria-hidden>⌘</span></div>
              <strong>{miniRunnerLabel}</strong>
              <small>{codexControlRow ? `最近：${formatDateTime(codexControlRow.created_at)}` : '等待接入'}</small>
            </article>
            <article className={`hamster-status-card hamster-status-card--queue ${wechatQueueHasFailed ? 'warning' : ''}`}>
              <div className="hamster-status-card__topline"><span>微信消息队列</span><span className="hamster-status-card__icon" aria-hidden>✉</span></div>
              <strong>{wechatQueueSummary.error ? '暂无权限读取消息队列' : `${wechatQueueSummary.pending} / ${wechatQueueSummary.sending} / ${wechatQueueSummary.failed}`}</strong>
              <small>{wechatQueueSummary.error ?? 'pending / sending / failed'}</small>
            </article>
            <article className="hamster-status-card hamster-status-card--tasks">
              <div className="hamster-status-card__topline"><span>今日任务状态</span><span className="hamster-status-card__icon" aria-hidden>✓</span></div>
              <strong>{agentTasksError ? '当前前端无权限读取该表' : agentTasks.length ? `${todayTaskSummary.completed} completed · ${todayTaskSummary.failed} failed` : '今日暂无任务'}</strong>
              <small>{agentTasksError ?? 'agent_tasks'}</small>
            </article>
          </section>
          <main className="hamster-console-accordion">
          <section className="hamster-console-card glass-card" aria-label="Mini 控制">
            <button className="hamster-console-accordion__header" onClick={() => toggleGroup('mini')}>
              <h2>Mini 控制</h2>
              <span>{expandedGroups.mini ? '▼' : '▶'}</span>
            </button>
            <div className={`hamster-console-accordion__content ${expandedGroups.mini ? 'expanded' : ''}`}>
              <div className="hamster-console-accordion__inner">
                <div className="hamster-console-codex-status">
                  <span className={`hamster-console-codex-dot ${codexControlState.tone}`} aria-hidden />
                  <span>{codexControlState.label}</span>
                </div>
                <div className="hamster-console-codex-actions">
                  <button
                    className="btn-primary"
                    onClick={() => void handleCodexControl('wake')}
                    disabled={codexControlState.isRunning || codexActionLoading !== null}
                  >
                    {codexActionLoading === 'wake' ? '唤醒中...' : '唤醒 Codex'}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => void handleCodexControl('sleep')}
                    disabled={!codexControlState.isRunning || codexActionLoading !== null}
                  >
                    {codexActionLoading === 'sleep' ? '关闭中...' : '关闭 Codex'}
                  </button>
                </div>

                <div className="hamster-cli-runtime">
                  <div className="hamster-cli-runtime__head">
                    <h3>CLI Syzygy Runtime</h3>
                    <span className="hamster-cli-runtime__tag">Mac mini 本地 Runtime</span>
                  </div>
                  <p className="hamster-console-card__hint">点击后向 Mac mini 发送 wake 请求，由本地 Runtime 领取执行。</p>
                  <div className="hamster-cli-runtime__actions">
                    {cliRuntimeTargets.map((target) => (
                      <button
                        key={target.role}
                        className="hamster-cli-runtime__btn"
                        onClick={() => void handleCliRuntimeWake(target)}
                        disabled={cliWakeLoading !== null}
                      >
                        {cliWakeLoading === target.role ? '发送唤醒请求中...' : target.label}
                      </button>
                    ))}
                  </div>
                  {cliWakeFeedback ? (
                    <p className={`hamster-cli-runtime__feedback ${cliWakeFeedback.tone}`} role="status">
                      {cliWakeFeedback.message}
                    </p>
                  ) : null}
                  <div className="hamster-cli-runtime__recent">
                    <div className="hamster-cli-runtime__recent-head">
                      <span>最近 CLI 请求</span>
                      <button
                        className="hamster-cli-runtime__refresh"
                        onClick={() => void loadCommands()}
                        disabled={commandsLoading}
                      >
                        {commandsLoading ? '刷新中...' : '刷新'}
                      </button>
                    </div>
                    {recentCliRequests.length === 0 ? (
                      <p className="hamster-console-card__hint">暂无 CLI 请求记录。</p>
                    ) : (
                      <ul className="hamster-cli-runtime__list">
                        {recentCliRequests.map((command) => {
                          const payload = (command.payload ?? {}) as { target_role?: string }
                          const roleKey = payload.target_role ?? ''
                          return (
                            <li key={command.id} className="hamster-cli-runtime__item">
                              <span className="hamster-cli-runtime__role">{cliRoleLabels[roleKey] ?? roleKey ?? '--'}</span>
                              <span className="hamster-cli-runtime__type">{command.command_type}</span>
                              <span className={`hamster-command-status ${command.status}`}>{command.status}</span>
                              <span className="hamster-cli-runtime__time">{formatDateTime(command.created_at)}</span>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>


          <section className="hamster-console-card glass-card hamster-console-group" aria-label="24h 陪伴配置">
            <button className="hamster-console-accordion__header" onClick={() => toggleGroup('companion')}>
              <div><h2>24h 陪伴配置</h2><small>回复与主动联系共用模型 / Prompt / 同一会话上下文</small></div>
              <span>{expandedGroups.companion ? '▼' : '▶'}</span>
            </button>
            <div className={`hamster-console-accordion__content ${expandedGroups.companion ? 'expanded' : ''}`}>
              <div className="hamster-console-accordion__inner hamster-console-nested-stack">
                <section className="hamster-console-card glass-card" aria-label="24h 陪伴模型">
                  <div className="hamster-console-accordion__inner">
                    <h2>统一模型</h2>
                    <p className="hamster-console-card__hint">
                      App 回复与主动联系共用这一模型；保存后两条路径一起切换。
                    </p>
                    {companionChannel ? (
                      <div className="hamster-console-channel-row">
                        <div className="hamster-console-channel-title">
                          24h 陪伴统一模型
                          <small>内部通道：app_companion</small>
                        </div>
                        <select
                          className="input-glass"
                          value={companionChannel.active_model ?? modelOptions[0] ?? ''}
                          onChange={(event) => handleChannelModelChange('app_companion', event.target.value)}
                        >
                          {modelOptions.map((model) => (
                            <option key={model} value={model}>{model}</option>
                          ))}
                        </select>
                        <button
                          className="btn-primary"
                          onClick={() => void handleSaveChannelModel('app_companion')}
                          disabled={savingChannelName === 'app_companion'}
                        >
                          {savingChannelName === 'app_companion' ? '保存中...' : '保存统一模型'}
                        </button>
                      </div>
                    ) : (
                      <p className="hamster-console-card__hint">未找到 24h 陪伴模型通道；运行端会拒绝悄悄回退到另一模型。</p>
                    )}
                  </div>
                </section>

                <section className="hamster-console-card glass-card" aria-label="24h 主动联系设置">
                  <button className="hamster-console-accordion__header" onClick={() => toggleSection('checkin-settings')}>
                    <h2>主动联系节奏</h2>
                    <span>{expandedSection === 'checkin-settings' ? '▼' : '▶'}</span>
                  </button>
                  <div className={`hamster-console-accordion__content ${expandedSection === 'checkin-settings' ? 'expanded' : ''}`}>
                    <div className="hamster-console-accordion__inner">
                      <p className="hamster-console-card__hint">
                        这里只负责 App 内 24h 陪伴，不执行外部发布或记录任务。
                      </p>
                      <div className="hamster-console-toggle">
                        <span>启用主动联系</span>
                        <button
                          className={`hamster-toggle ${agentSettings?.checkin_enabled ? 'enabled' : ''}`}
                          onClick={() =>
                            setAgentSettings((current) => (current ? { ...current, checkin_enabled: !current.checkin_enabled } : current))
                          }
                          disabled={!agentSettings}
                        >
                          {agentSettings?.checkin_enabled ? '开启' : '关闭'}
                        </button>
                      </div>
                      <div className="hamster-console-form-grid">
                        {[
                          ['day_mode_start_hour', '日间开始'],
                          ['day_mode_end_hour', '日间结束'],
                          ['day_min_interval_minutes', '日间最小间隔(分)'],
                          ['day_max_interval_minutes', '日间最大间隔(分)'],
                          ['night_mode_start_hour', '夜间开始'],
                          ['night_mode_end_hour', '夜间结束'],
                          ['night_min_interval_minutes', '夜间最小间隔(分)'],
                          ['night_max_interval_minutes', '夜间最大间隔(分)'],
                          ['quiet_hours_start_hour', '静默开始(可空)'],
                          ['quiet_hours_end_hour', '静默结束(可空)'],
                          ['cooldown_after_interaction_minutes', '互动后冷却(分)'],
                          ['max_daily_checkins_day', '日间每天上限'],
                          ['max_daily_checkins_night', '夜间每天上限'],
                        ].map(([field, label]) => (
                          <label className="hamster-console-input" key={field}>
                            <span>{label}</span>
                            <input
                              className="input-glass"
                              type="number"
                              inputMode="numeric"
                              value={agentForm[field] ?? ''}
                              onChange={(event) => handleAgentFieldChange(field, event.target.value)}
                            />
                          </label>
                        ))}
                      </div>
                      <label className="hamster-console-input">
                        <span>每渠道计划（JSON）</span>
                        <textarea
                          className="textarea-glass hamster-console-json"
                          rows={7}
                          value={perChannelScheduleText}
                          onChange={(event) => setPerChannelScheduleText(event.target.value)}
                        />
                      </label>
                      <button className="btn-primary" onClick={() => void handleSaveAgentSettings()} disabled={savingAgentSettings || !agentSettings}>
                        {savingAgentSettings ? '保存中...' : '保存主动联系设置'}
                      </button>
                    </div>
                  </div>
                </section>

                <section className="hamster-console-card glass-card" aria-label="24h 陪伴 Prompt">
                  <div className="hamster-console-accordion__inner">
                    <h2>陪伴 Prompt</h2>
                    <p className="hamster-console-card__hint">
                      身份、App 语气和昼夜主动联系四层均为不可变版本发布；历史版本继续保留。
                    </p>
                    <div className="hamster-console-template-list">
                      {companionPromptTemplates.map((template) => (
                        <button
                          key={template.id}
                          className={`hamster-template-item ${template.id === activeTemplateId ? 'active' : ''}`}
                          onClick={() => handleSelectTemplate(template.id)}
                          disabled={savingTemplateId !== null}
                        >
                          <span>{getPromptTemplateLabel(template.name)}</span>
                          <small>active · v{template.version}</small>
                        </button>
                      ))}
                    </div>
                    {activeCompanionTemplate ? (
                      <>
                        <div className="hamster-console-template-meta">
                          <span>{getPromptTemplateLabel(activeCompanionTemplate.name)}</span>
                          <span>当前 active · v{activeCompanionTemplate.version}</span>
                        </div>
                        <p className="hamster-console-card__hint">
                          内部键：{activeCompanionTemplate.name}。发布会创建不可变的新版本；旧版本保留用于审计与回滚。
                        </p>
                        <textarea
                          className="textarea-glass hamster-console-template-editor"
                          rows={12}
                          value={templateDraft}
                          onChange={(event) => setTemplateDraft(event.target.value)}
                          disabled={savingTemplateId !== null}
                        />
                        {getPromptRecommendationLabel(activeCompanionTemplate.name) ? (
                          <button
                            className="btn-secondary"
                            onClick={handleApplyPromptRecommendation}
                            disabled={savingTemplateId !== null}
                          >
                            {getPromptRecommendationLabel(activeCompanionTemplate.name)}
                          </button>
                        ) : null}
                        <button
                          className="btn-primary"
                          onClick={() => void handleSaveTemplate()}
                          disabled={savingTemplateId === activeCompanionTemplate.id || !hasPromptDraftChanges}
                        >
                          {savingTemplateId === activeCompanionTemplate.id ? '发布中...' : '发布陪伴 Prompt 新版本'}
                        </button>
                      </>
                    ) : (
                      <p className="hamster-console-card__hint">从上方选择一层 Prompt 后编辑。</p>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </section>


          <section className="hamster-console-card glass-card hamster-console-group" aria-label="其他聊天 Prompt">
            <button className="hamster-console-accordion__header" onClick={() => toggleGroup('prompts')}>
              <div><h2>其他聊天 Prompt</h2><small>普通 App、CLI 与沙发规则；中文名称展示，内部键保留审计</small></div>
              <span>{expandedGroups.prompts ? '▼' : '▶'}</span>
            </button>
            <div className={`hamster-console-accordion__content ${expandedGroups.prompts ? 'expanded' : ''}`}>
              <div className="hamster-console-accordion__inner">
                <section className="hamster-console-card glass-card" aria-label="Prompt 编辑器">
                  <div className="hamster-console-accordion__inner">
                    <div className="hamster-console-template-list">
                      {otherPromptTemplates.map((template) => {
                        const isActive = template.id === activeTemplateId
                        return (
                          <button
                            key={template.id}
                            className={`hamster-template-item ${isActive ? 'active' : ''}`}
                            onClick={() => handleSelectTemplate(template.id)}
                            disabled={savingTemplateId !== null}
                          >
                            <span>{getPromptTemplateLabel(template.name)}</span>
                            <small>{categoryLabelMap[template.category] ?? template.category} · v{template.version}</small>
                          </button>
                        )
                      })}
                    </div>

                    {activeOtherTemplate ? (
                      <>
                        <div className="hamster-console-template-meta">
                          <span>{getPromptTemplateLabel(activeOtherTemplate.name)}</span>
                          <span>当前 active · v{activeOtherTemplate.version}</span>
                        </div>
                        <p className="hamster-console-card__hint">
                          内部键：{activeOtherTemplate.name}。发布会创建不可变的新版本；旧版本保留用于审计与回滚。
                        </p>
                        <textarea
                          className="textarea-glass hamster-console-template-editor"
                          rows={12}
                          value={templateDraft}
                          onChange={(event) => setTemplateDraft(event.target.value)}
                          disabled={savingTemplateId !== null}
                        />
                        {getPromptRecommendationLabel(activeOtherTemplate.name) ? (
                          <button
                            className="btn-secondary"
                            onClick={handleApplyPromptRecommendation}
                            disabled={savingTemplateId !== null}
                          >
                            {getPromptRecommendationLabel(activeOtherTemplate.name)}
                          </button>
                        ) : null}
                        <button
                          className="btn-primary"
                          onClick={() => void handleSaveTemplate()}
                          disabled={savingTemplateId === activeOtherTemplate.id || !hasPromptDraftChanges}
                        >
                          {savingTemplateId === activeOtherTemplate.id ? '发布中...' : '发布 Prompt 新版本'}
                        </button>
                      </>
                    ) : (
                      <p className="hamster-console-card__hint">从上方选择一项后编辑。</p>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </section>


          <section className="hamster-console-card glass-card hamster-console-group" aria-label="微信 API 备份配置">
            <button className="hamster-console-accordion__header" onClick={() => toggleGroup('wechat')}>
              <div><h2>微信 API 备份配置</h2><small>旧模型 / 上下文 / Prompt；链路完整保留，默认沉底</small></div>
              <span>{expandedGroups.wechat ? '▼' : '▶'}</span>
            </button>
            <div className={`hamster-console-accordion__content ${expandedGroups.wechat ? 'expanded' : ''}`}>
              <div className="hamster-console-accordion__inner hamster-console-nested-stack">
          <section className="hamster-console-card glass-card" aria-label="模型切换">
            <button className="hamster-console-accordion__header" onClick={() => toggleSection('model-switching')}>
              <h2>模型切换</h2>
              <span>{expandedSection === 'model-switching' ? '▼' : '▶'}</span>
            </button>
            <div className={`hamster-console-accordion__content ${expandedSection === 'model-switching' ? 'expanded' : ''}`}>
              <div className="hamster-console-accordion__inner">
                <p className="hamster-console-card__hint">按渠道配置 active_model，保存后立即生效。</p>
                <div className="hamster-console-model-add">
                  <input
                    className="input-glass"
                    value={manualModelId}
                    onChange={(event) => setManualModelId(event.target.value)}
                    placeholder="手动添加 model_id（如 openai/gpt-5）"
                  />
                  <button className="btn-secondary" onClick={() => void handleAddModel()} disabled={addingModel}>
                    {addingModel ? '添加中...' : '添加模型'}
                  </button>
                </div>
                <div className="hamster-console-channel-list">
                  {backupChannels.map((row) => (
                    <div className="hamster-console-channel-row" key={row.channel_name}>
                      <div className="hamster-console-channel-title">{row.channel_name}</div>
                      <select
                        className="input-glass"
                        value={row.active_model ?? modelOptions[0] ?? ''}
                        onChange={(event) => handleChannelModelChange(row.channel_name, event.target.value)}
                      >
                        {modelOptions.map((model) => (
                          <option key={model} value={model}>{model}</option>
                        ))}
                      </select>
                      <button
                        className="btn-primary"
                        onClick={() => void handleSaveChannelModel(row.channel_name)}
                        disabled={savingChannelName === row.channel_name}
                      >
                        {savingChannelName === row.channel_name ? '保存中...' : '保存'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="hamster-console-card glass-card" aria-label="微信上下文管理">
            <button className="hamster-console-accordion__header" onClick={() => toggleSection('wechat-context')}>
              <h2>微信上下文管理</h2>
              <span>{expandedSection === 'wechat-context' ? '▼' : '▶'}</span>
            </button>
            <div className={`hamster-console-accordion__content ${expandedSection === 'wechat-context' ? 'expanded' : ''}`}>
              <div className="hamster-console-accordion__inner">
                <div className="hamster-console-toggle">
                  <span>启用记忆检索</span>
                  <button
                    className={`hamster-toggle ${agentSettings?.wechat_memory_search_enabled ?? true ? 'enabled' : ''}`}
                    onClick={() =>
                      setAgentSettings((current) =>
                        current ? { ...current, wechat_memory_search_enabled: !(current.wechat_memory_search_enabled ?? true) } : current,
                      )
                    }
                    disabled={!agentSettings}
                  >
                    {agentSettings?.wechat_memory_search_enabled ?? true ? '开启' : '关闭'}
                  </button>
                </div>
                <div className="hamster-console-form-grid">
                  {[
                    ['wechat_context_window_rounds', '滚动窗口轮数'],
                    ['wechat_context_summary_trigger_rounds', '摘要触发轮数'],
                    ['wechat_context_summary_refresh_rounds', '摘要刷新间隔'],
                    ['wechat_memory_search_min_length', '记忆检索最小长度'],
                  ].map(([field, label]) => (
                    <label className="hamster-console-input" key={field}>
                      <span>{label}</span>
                      <input
                        className="input-glass"
                        type="number"
                        min={
                          field === 'wechat_context_summary_trigger_rounds'
                            ? 10
                            : field === 'wechat_memory_search_min_length'
                              ? 1
                              : 5
                        }
                        max={
                          field === 'wechat_context_summary_trigger_rounds'
                            ? 100
                            : field === 'wechat_memory_search_min_length'
                              ? 20
                              : 50
                        }
                        inputMode="numeric"
                        value={agentForm[field] ?? ''}
                        onChange={(event) => handleAgentFieldChange(field, event.target.value)}
                      />
                    </label>
                  ))}
                </div>
                <label className="hamster-console-input">
                  <span>摘要模型</span>
                  <select
                    className="input-glass"
                    value={agentForm.wechat_context_summary_model ?? ''}
                    onChange={(event) => handleAgentFieldChange('wechat_context_summary_model', event.target.value)}
                  >
                    {modelOptions.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </label>
                <button
                  className="btn-primary"
                  onClick={() => void handleSaveWechatContextSettings()}
                  disabled={savingWechatContextSettings || !agentSettings}
                >
                  {savingWechatContextSettings ? '保存中...' : '保存上下文设置'}
                </button>
              </div>
            </div>
          </section>

          <section className="hamster-console-card glass-card" aria-label="微信备份 Prompt">
            <button className="hamster-console-accordion__header" onClick={() => toggleSection('prompt-editor')}>
              <h2>微信回复 Prompt</h2>
              <span>{expandedSection === 'prompt-editor' ? '▼' : '▶'}</span>
            </button>
            <div className={`hamster-console-accordion__content ${expandedSection === 'prompt-editor' ? 'expanded' : ''}`}>
              <div className="hamster-console-accordion__inner">
                <div className="hamster-console-template-list">
                  {wechatPromptTemplates.map((template) => {
                    const isActive = template.id === activeTemplateId
                    return (
                      <button
                        key={template.id}
                        className={`hamster-template-item ${isActive ? 'active' : ''}`}
                        onClick={() => handleSelectTemplate(template.id)}
                        disabled={savingTemplateId !== null}
                      >
                        <span>{getPromptTemplateLabel(template.name)}</span>
                        <small>{categoryLabelMap[template.category] ?? template.category} · v{template.version}</small>
                      </button>
                    )
                  })}
                </div>

                {activeWechatTemplate ? (
                  <>
                    <div className="hamster-console-template-meta">
                      <span>{getPromptTemplateLabel(activeWechatTemplate.name)}</span>
                      <span>当前 active · v{activeWechatTemplate.version}</span>
                    </div>
                    <p className="hamster-console-card__hint">
                      内部键：{activeWechatTemplate.name}。这是微信 transport 的备份风格，不影响 App 陪伴 Prompt。
                    </p>
                    <textarea
                      className="textarea-glass hamster-console-template-editor"
                      rows={12}
                      value={templateDraft}
                      onChange={(event) => setTemplateDraft(event.target.value)}
                      disabled={savingTemplateId !== null}
                    />
                    <button
                      className="btn-primary"
                      onClick={() => void handleSaveTemplate()}
                      disabled={
                        savingTemplateId === activeWechatTemplate.id ||
                        !hasPromptDraftChanges
                      }
                    >
                      {savingTemplateId === activeWechatTemplate.id ? '发布中...' : '发布微信 Prompt 新版本'}
                    </button>
                  </>
                ) : (
                  <p className="hamster-console-card__hint">选择微信回复风格后编辑。</p>
                )}
              </div>
            </div>
          </section>
              </div>
            </div>
          </section>

          <section className="hamster-console-card glass-card hamster-console-group" aria-label="V3.0 观测台">
            <button className="hamster-console-accordion__header" onClick={() => toggleGroup('v3')}>
              <div><h2>V3.0 观测台</h2><small>执行记录 / 当前状态快照 / 打印胶囊 / 能力 / 指令</small></div>
              <span>{expandedGroups.v3 ? '▼' : '▶'}</span>
            </button>
            <div className={`hamster-console-accordion__content ${expandedGroups.v3 ? 'expanded' : ''}`}>
              <div className="hamster-console-accordion__inner hamster-console-nested-stack">

          <section className="hamster-console-card glass-card" aria-label="执行记录">
            <button className="hamster-console-accordion__header" onClick={() => toggleSection('agent-tasks')}><h2>执行记录</h2><span>{expandedSection === 'agent-tasks' ? '▼' : '▶'}</span></button>
            <div className={`hamster-console-accordion__content ${expandedSection === 'agent-tasks' ? 'expanded' : ''}`}><div className="hamster-console-accordion__inner">
              {agentTasksError ? <p className="hamster-console-card__hint">当前前端无权限读取该表：{agentTasksError}</p> : <>
                <select className="input-glass hamster-filter" value={agentTaskStatusFilter} onChange={(event) => setAgentTaskStatusFilter(event.target.value)}>{['all','pending','running','completed','failed','cancelled'].map((status) => <option key={status} value={status}>{status === 'all' ? '全部状态' : status}</option>)}</select>
                <div className="hamster-console-command-list">{filteredAgentTasks.map((task) => { const expanded = expandedAgentTaskId === task.id; return <article key={task.id} className="hamster-command-item"><button className="hamster-command-header" onClick={() => setExpandedAgentTaskId(expanded ? null : task.id)}><strong>{task.command ?? '(无指令)'}</strong><span className={`hamster-command-status ${task.status ?? ''}`}>{task.status ?? '--'}</span><span>{task.executor ?? task.source ?? '--'}</span><span>{formatDateTime(task.created_at)}</span></button>{expanded ? <div className="hamster-command-body"><p>{task.result_summary ?? task.error ?? '无摘要'}</p><h4>result_detail</h4><pre>{formatJson(task.result_detail)}</pre><h4>payload_json</h4><pre>{formatJson(task.payload_json)}</pre><p className="hamster-console-card__hint">correlation_id：{task.correlation_id ?? '--'} · parent_task_id：{task.parent_task_id ?? '--'} · started：{formatDateTime(task.started_at)} · completed：{formatDateTime(task.completed_at)}</p></div> : null}</article> })}</div>
                {filteredAgentTasks.length === 0 ? <p className="hamster-console-card__hint">暂无执行记录。</p> : null}
              </>}
            </div></div>
          </section>

          <section className="hamster-console-card glass-card" aria-label="当前状态快照">
            <button className="hamster-console-accordion__header" onClick={() => toggleSection('context-snapshot')}><h2>当前状态快照</h2><span>{expandedSection === 'context-snapshot' ? '▼' : '▶'}</span></button>
            <div className={`hamster-console-accordion__content ${expandedSection === 'context-snapshot' ? 'expanded' : ''}`}><div className="hamster-console-accordion__inner">
              {contextSnapshotError ? <p className="hamster-console-card__hint">当前前端无权限读取该表：{contextSnapshotError}</p> : contextSnapshot ? <div className="hamster-v3-detail"><strong>{contextSnapshot.snapshot_type ?? 'snapshot'}</strong><p>{contextSnapshot.summary_text ?? '暂无摘要'}</p><small>{snapshotExpired ? '状态可能已过期 · ' : ''}stale_after：{formatDateTime(contextSnapshot.stale_after)} · created：{formatDateTime(contextSnapshot.created_at)}</small></div> : <p className="hamster-console-card__hint">CLI 小秘书还没有生成状态快照。</p>}
              <div className="hamster-digest-grid">{['morning','afternoon','evening','night'].map((period) => { const item = dailyDigests.find((digest) => digest.period_of_day === period); return <article key={period} className="hamster-mini-card"><strong>{period}</strong><p>{item?.summary_text ?? '暂无摘要'}</p></article> })}</div>
            </div></div>
          </section>

          <section className="hamster-console-card glass-card" aria-label="每周打印胶囊">
            <button className="hamster-console-accordion__header" onClick={() => toggleSection('print-capsules')}><h2>每周打印胶囊</h2><span>{expandedSection === 'print-capsules' ? '▼' : '▶'}</span></button>
            <div className={`hamster-console-accordion__content ${expandedSection === 'print-capsules' ? 'expanded' : ''}`}><div className="hamster-console-accordion__inner">
              {printCapsulesError ? <p className="hamster-console-card__hint">当前前端无权限读取该表：{printCapsulesError}</p> : <>
                <div className="hamster-console-model-add"><input className="input-glass" value={capsuleWeekFilter} onChange={(event) => setCapsuleWeekFilter(event.target.value)} placeholder="scheduled_print_week" /><select className="input-glass" value={capsuleStatusFilter} onChange={(event) => setCapsuleStatusFilter(event.target.value)}>{['all','queued','printed','draft','cancelled'].map((status) => <option key={status} value={status}>{status === 'all' ? '全部状态' : status}</option>)}</select></div>
                <p className="hamster-console-card__hint">本周 queued：{weeklyQueuedCount} · printed：{weeklyPrintedCount}</p>
                <div className="hamster-console-command-list">{filteredCapsules.map((capsule) => { const expanded = expandedCapsuleId === capsule.id; const locked = capsule.hidden_until_printed && capsule.status !== 'printed'; return <article key={capsule.id} className="hamster-command-item"><button className="hamster-command-header" onClick={() => setExpandedCapsuleId(expanded ? null : capsule.id)}><strong>{capsule.title ?? '(无标题)'}</strong><span className={`hamster-command-status ${capsule.status ?? ''}`}>{capsule.status ?? '--'}</span><span>{capsule.paper_size ?? capsule.type ?? '--'}</span><span>{formatDateTime(capsule.created_at)}</span></button>{expanded ? <div className="hamster-command-body"><p className="hamster-console-card__hint">{capsule.trigger_reason ?? '无触发原因'} · week：{capsule.scheduled_print_week ?? '--'} · sort：{capsule.sort_order ?? '--'}</p><p>{locked ? '正文将在打印后解锁' : (capsule.content ?? '暂无正文')}</p></div> : null}</article> })}</div>
                {filteredCapsules.length === 0 ? <p className="hamster-console-card__hint">本周还没有待打印纸条。</p> : null}
              </>}
            </div></div>
          </section>

          <section className="hamster-console-card glass-card" aria-label="能力编排器">
            <button className="hamster-console-accordion__header" onClick={() => toggleSection('capabilities')}><h2>能力编排器</h2><span>{expandedSection === 'capabilities' ? '▼' : '▶'}</span></button>
            <div className={`hamster-console-accordion__content ${expandedSection === 'capabilities' ? 'expanded' : ''}`}><div className="hamster-console-accordion__inner">
              {capabilitiesError ? <p className="hamster-console-card__hint">当前前端无权限读取该表：{capabilitiesError}</p> : capabilities.length ? capabilities.map((capability) => <article key={capability.id} className="hamster-mini-card"><strong>{capability.name}</strong><p>{capability.description ?? '暂无说明'}</p><small>{capability.enabled ? '已启用' : '已禁用'} · 风险：{capability.risk_level ?? '--'} · 确认：{capability.requires_confirmation ? '需要' : '不需要'} · 渠道：{capability.output_channel ?? '--'} · 使用/失败：{capability.usage_count ?? 0}/{capability.failure_count ?? 0} · 冷却至：{formatDateTime(capability.cooldown_until)} · 最近使用：{formatDateTime(capability.last_used_at)}</small><em>当前前端无权限修改</em></article>) : <p className="hamster-console-card__hint">暂无能力配置。</p>}
            </div></div>
          </section>

          <section className="hamster-console-card glass-card" aria-label="指令记录">
            <button className="hamster-console-accordion__header" onClick={() => toggleSection('command-log')}>
              <h2>指令记录</h2>
              <span>{expandedSection === 'command-log' ? '▼' : '▶'}</span>
            </button>
            <div className={`hamster-console-accordion__content ${expandedSection === 'command-log' ? 'expanded' : ''}`}>
              <div className="hamster-console-accordion__inner">
                <div className="hamster-console-section-title">
                  <p className="hamster-console-card__hint">自动每 30 秒刷新一次，展示最近 20 条。</p>
                  <button className="btn-secondary" onClick={() => void loadCommands()} disabled={commandsLoading}>
                    {commandsLoading ? '刷新中...' : '手动刷新'}
                  </button>
                </div>
                <div className="hamster-console-command-list">
                  {commands.map((command) => {
                    const expanded = expandedCommandId === command.id
                    return (
                      <article key={command.id} className="hamster-command-item">
                        <button
                          className="hamster-command-header"
                          onClick={() => setExpandedCommandId(expanded ? null : command.id)}
                        >
                          <strong>{command.command_type}</strong>
                          <span className={`hamster-command-status ${command.status}`}>{command.status}</span>
                          <span>{formatDateTime(command.created_at)}</span>
                          <span>{formatDateTime(command.completed_at)}</span>
                        </button>
                        {expanded ? (
                          <div className="hamster-command-body">
                            <h4>payload</h4>
                            <pre>{JSON.stringify(command.payload ?? {}, null, 2)}</pre>
                            <h4>result</h4>
                            <pre>{JSON.stringify(command.result ?? {}, null, 2)}</pre>
                          </div>
                        ) : null}
                      </article>
                    )
                  })}
                  {commands.length === 0 ? <p className="hamster-console-card__hint">暂无指令记录。</p> : null}
                </div>
              </div>
            </div>
          </section>
              </div>
            </div>
          </section>
          </main>
        </>
      ) : null}
    </div>
  )
}

export default HamsterConsolePage
