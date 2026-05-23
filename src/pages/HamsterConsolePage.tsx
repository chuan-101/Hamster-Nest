import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase/client'
import './HamsterConsolePage.css'

type ChannelConfigRow = {
  user_id: string
  channel_name: string
  active_model: string | null
}

type AgentSettingsRow = {
  user_id: string
  checkin_enabled: boolean
  day_mode_start_hour: number | null
  day_mode_end_hour: number | null
  day_min_interval_minutes: number | null
  day_max_interval_minutes: number | null
  night_mode_start_hour: number | null
  night_mode_end_hour: number | null
  night_min_interval_minutes: number | null
  night_max_interval_minutes: number | null
  quiet_hours_start_hour: number | null
  quiet_hours_end_hour: number | null
  cooldown_after_interaction_minutes: number | null
  max_daily_checkins_day: number | null
  max_daily_checkins_night: number | null
  per_channel_schedule: Record<string, unknown> | null
  wechat_context_summary_model: string | null
  wechat_context_window_rounds: number | null
  wechat_context_summary_trigger_rounds: number | null
  wechat_context_summary_refresh_rounds: number | null
  wechat_memory_search_min_length: number | null
  wechat_memory_search_enabled: boolean | null
}

type PromptTemplateRow = {
  id: string
  name: string
  category: 'base' | 'scenario' | 'style' | string
  content: string
  version: number | null
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

const TARGET_USER_ID = '94dd24be-e136-45bb-836b-6820c09c4292'

const categoryLabelMap: Record<string, string> = {
  base: '基础',
  scenario: '场景',
  style: '风格',
}

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

const parseNumberField = (value: string, fallback: number | null = null) => {
  if (value.trim() === '') return null
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

const HamsterConsolePage = ({ user }: { user: User | null }) => {
  const scopedUserId = user?.id ?? TARGET_USER_ID
  const [loading, setLoading] = useState(true)
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
  const [expandedSection, setExpandedSection] = useState('model-switching')
  const [codexControlRow, setCodexControlRow] = useState<CodexControlRow | null>(null)
  const [codexActionLoading, setCodexActionLoading] = useState<'wake' | 'sleep' | null>(null)

  const activeTemplate = useMemo(
    () => promptTemplates.find((item) => item.id === activeTemplateId) ?? null,
    [promptTemplates, activeTemplateId],
  )
  const codexControlState = useMemo(() => toCodexControlViewState(codexControlRow), [codexControlRow])

  const modelOptions = useMemo(() => {
    const merged = new Set<string>(availableModels)
    channels.forEach((item) => {
      if (item.active_model) merged.add(item.active_model)
    })
    const summaryModel = agentForm.wechat_context_summary_model?.trim()
    if (summaryModel) merged.add(summaryModel)
    return Array.from(merged)
  }, [availableModels, channels, agentForm.wechat_context_summary_model])

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
    setErrorMessage(null)

    const [channelRes, settingsRes, templateRes, commandsRes, modelRes, codexRes] = await Promise.all([
      supabase
        .from('channel_config')
        .select('user_id, channel_name, active_model')
        .eq('user_id', scopedUserId)
        .order('channel_name', { ascending: true }),
      supabase
        .from('agent_settings')
        .select(
          'user_id, checkin_enabled, day_mode_start_hour, day_mode_end_hour, day_min_interval_minutes, day_max_interval_minutes, night_mode_start_hour, night_mode_end_hour, night_min_interval_minutes, night_max_interval_minutes, quiet_hours_start_hour, quiet_hours_end_hour, cooldown_after_interaction_minutes, max_daily_checkins_day, max_daily_checkins_night, per_channel_schedule, wechat_context_summary_model, wechat_context_window_rounds, wechat_context_summary_trigger_rounds, wechat_context_summary_refresh_rounds, wechat_memory_search_min_length, wechat_memory_search_enabled',
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

  useEffect(() => {
    void loadAll()
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
    if (!supabase) return
    const normalizedModelId = manualModelId.trim()
    if (!normalizedModelId) {
      setErrorMessage('请先输入 model_id')
      return
    }

    setAddingModel(true)
    setErrorMessage(null)
    const { error } = await supabase
      .from('provider_models')
      .upsert(
        {
          model_id: normalizedModelId,
          enabled: true,
        },
        { onConflict: 'model_id' },
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

    let parsedSchedule: Record<string, unknown> | null = null
    if (perChannelScheduleText.trim()) {
      try {
        parsedSchedule = JSON.parse(perChannelScheduleText) as Record<string, unknown>
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

  const handleSaveTemplate = async () => {
    if (!supabase || !activeTemplate) return
    setSavingTemplateId(activeTemplate.id)

    const { error } = await supabase
      .from('prompt_templates')
      .update({ content: templateDraft })
      .eq('id', activeTemplate.id)
      .eq('user_id', scopedUserId)

    setSavingTemplateId(null)
    if (error) {
      setErrorMessage(error.message)
      return
    }

    setPromptTemplates((current) =>
      current.map((item) => (item.id === activeTemplate.id ? { ...item, content: templateDraft } : item)),
    )
    showToast(`Prompt 已保存：${activeTemplate.name}`)
  }

  const toggleSection = (sectionId: string) => {
    setExpandedSection((current) => (current === sectionId ? '' : sectionId))
  }

  return (
    <div className="hamster-console-page">
      <header className="hamster-console-page__header">
        <Link to="/" className="hamster-console-page__back">← 返回小窝</Link>
        <h1 className="ui-title">🎛️ 仓鼠机</h1>
        <p>远程控制 Mini Agent（用户：{scopedUserId.slice(0, 8)}...）</p>
      </header>

      {errorMessage ? <div className="hamster-console-alert">{errorMessage}</div> : null}
      {toast ? <div className="hamster-console-toast">{toast}</div> : null}

      {loading ? <div className="hamster-console-loading">正在加载仓鼠机面板...</div> : null}

      {!loading ? (
        <main className="hamster-console-accordion">
          <section className="hamster-console-card glass-card" aria-label="Codex 控制">
            <button className="hamster-console-accordion__header" onClick={() => toggleSection('codex-control')}>
              <h2>Codex 控制</h2>
              <span>{expandedSection === 'codex-control' ? '▼' : '▶'}</span>
            </button>
            <div className={`hamster-console-accordion__content ${expandedSection === 'codex-control' ? 'expanded' : ''}`}>
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
              </div>
            </div>
          </section>

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
                  {channels.map((row) => (
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

          <section className="hamster-console-card glass-card" aria-label="主动消息设置">
            <button className="hamster-console-accordion__header" onClick={() => toggleSection('checkin-settings')}>
              <h2>主动消息设置</h2>
              <span>{expandedSection === 'checkin-settings' ? '▼' : '▶'}</span>
            </button>
            <div className={`hamster-console-accordion__content ${expandedSection === 'checkin-settings' ? 'expanded' : ''}`}>
              <div className="hamster-console-accordion__inner">
                <div className="hamster-console-toggle">
                  <span>checkin_enabled</span>
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
                  {savingAgentSettings ? '保存中...' : '保存主动消息设置'}
                </button>
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

          <section className="hamster-console-card glass-card" aria-label="Prompt 编辑器">
            <button className="hamster-console-accordion__header" onClick={() => toggleSection('prompt-editor')}>
              <h2>Prompt 编辑器</h2>
              <span>{expandedSection === 'prompt-editor' ? '▼' : '▶'}</span>
            </button>
            <div className={`hamster-console-accordion__content ${expandedSection === 'prompt-editor' ? 'expanded' : ''}`}>
              <div className="hamster-console-accordion__inner">
                <div className="hamster-console-template-list">
                  {promptTemplates.map((template) => {
                    const isActive = template.id === activeTemplateId
                    return (
                      <button
                        key={template.id}
                        className={`hamster-template-item ${isActive ? 'active' : ''}`}
                        onClick={() => handleSelectTemplate(template.id)}
                      >
                        <span>{template.name}</span>
                        <small>{categoryLabelMap[template.category] ?? template.category}</small>
                      </button>
                    )
                  })}
                </div>

                {activeTemplate ? (
                  <>
                    <div className="hamster-console-template-meta">
                      <span>{activeTemplate.name}</span>
                      <span>v{activeTemplate.version ?? '-'}</span>
                    </div>
                    <textarea
                      className="textarea-glass hamster-console-template-editor"
                      rows={12}
                      value={templateDraft}
                      onChange={(event) => setTemplateDraft(event.target.value)}
                    />
                    <button className="btn-primary" onClick={() => void handleSaveTemplate()} disabled={savingTemplateId === activeTemplate.id}>
                      {savingTemplateId === activeTemplate.id ? '保存中...' : '保存 Prompt'}
                    </button>
                  </>
                ) : (
                  <p className="hamster-console-card__hint">暂无 active prompt 模板。</p>
                )}
              </div>
            </div>
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
        </main>
      ) : null}
    </div>
  )
}

export default HamsterConsolePage
