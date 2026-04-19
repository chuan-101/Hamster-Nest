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

const TARGET_USER_ID = '94dd24be-e136-45bb-836b-6820c09c4292'

const MODEL_OPTIONS = [
  'openai/gpt-4.1-mini',
  'openai/gpt-4.1',
  'openai/gpt-5',
  'openai/gpt-5.4',
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-opus-4.5',
  'anthropic/claude-opus-4.6',
  'anthropic/claude-opus-4.7',
  'anthropic/claude-haiku-4.5',
  'google/gemini-2.5-pro',
  'google/gemini-3.1-pro-preview',
]

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

const HamsterConsolePage = ({ user }: { user: User | null }) => {
  const scopedUserId = user?.id ?? TARGET_USER_ID
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [channels, setChannels] = useState<ChannelConfigRow[]>([])
  const [savingChannelName, setSavingChannelName] = useState<string | null>(null)

  const [agentSettings, setAgentSettings] = useState<AgentSettingsRow | null>(null)
  const [agentForm, setAgentForm] = useState<Record<string, string>>({})
  const [perChannelScheduleText, setPerChannelScheduleText] = useState('{}')
  const [savingAgentSettings, setSavingAgentSettings] = useState(false)

  const [promptTemplates, setPromptTemplates] = useState<PromptTemplateRow[]>([])
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)
  const [templateDraft, setTemplateDraft] = useState('')
  const [savingTemplateId, setSavingTemplateId] = useState<string | null>(null)

  const [commands, setCommands] = useState<SyzygyCommandRow[]>([])
  const [expandedCommandId, setExpandedCommandId] = useState<string | null>(null)
  const [commandsLoading, setCommandsLoading] = useState(false)

  const activeTemplate = useMemo(
    () => promptTemplates.find((item) => item.id === activeTemplateId) ?? null,
    [promptTemplates, activeTemplateId],
  )

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

    const [channelRes, settingsRes, templateRes, commandsRes] = await Promise.all([
      supabase
        .from('channel_config')
        .select('user_id, channel_name, active_model')
        .eq('user_id', scopedUserId)
        .order('channel_name', { ascending: true }),
      supabase
        .from('agent_settings')
        .select(
          'user_id, checkin_enabled, day_mode_start_hour, day_mode_end_hour, day_min_interval_minutes, day_max_interval_minutes, night_mode_start_hour, night_mode_end_hour, night_min_interval_minutes, night_max_interval_minutes, quiet_hours_start_hour, quiet_hours_end_hour, cooldown_after_interaction_minutes, max_daily_checkins_day, max_daily_checkins_night, per_channel_schedule',
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
    ])

    if (channelRes.error || settingsRes.error || templateRes.error || commandsRes.error) {
      setErrorMessage(
        channelRes.error?.message ||
          settingsRes.error?.message ||
          templateRes.error?.message ||
          commandsRes.error?.message ||
          '加载失败',
      )
      setLoading(false)
      return
    }

    const channelRows = channelRes.data ?? []
    setChannels(channelRows)

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
        <main className="hamster-console-grid">
          <section className="hamster-console-card glass-card" aria-label="模型切换">
            <h2>模型切换</h2>
            <p className="hamster-console-card__hint">按渠道配置 active_model，保存后立即生效。</p>
            <div className="hamster-console-channel-list">
              {channels.map((row) => (
                <div className="hamster-console-channel-row" key={row.channel_name}>
                  <div className="hamster-console-channel-title">{row.channel_name}</div>
                  <select
                    className="input-glass"
                    value={row.active_model ?? MODEL_OPTIONS[0]}
                    onChange={(event) => handleChannelModelChange(row.channel_name, event.target.value)}
                  >
                    {MODEL_OPTIONS.map((model) => (
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
          </section>

          <section className="hamster-console-card glass-card" aria-label="主动消息控制">
            <h2>主动消息</h2>
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
          </section>

          <section className="hamster-console-card glass-card" aria-label="Prompt 编辑器">
            <h2>Prompt 编辑器</h2>
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
          </section>

          <section className="hamster-console-card glass-card" aria-label="指令记录">
            <div className="hamster-console-section-title">
              <h2>指令记录</h2>
              <button className="btn-secondary" onClick={() => void loadCommands()} disabled={commandsLoading}>
                {commandsLoading ? '刷新中...' : '手动刷新'}
              </button>
            </div>
            <p className="hamster-console-card__hint">自动每 30 秒刷新一次，展示最近 20 条。</p>
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
          </section>
        </main>
      ) : null}
    </div>
  )
}

export default HamsterConsolePage
