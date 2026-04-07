import { supabase } from '../supabase/client'
import type { TimelineRecorder } from '../types'

type TimelineConfigRow = Record<string, unknown>

type TimelineEntryLite = {
  eventDate: string
  summary: string
  recorder: TimelineRecorder
}

type TimelineAutoInjectConfig = {
  autoInjectDays: number
  autoInjectModules: Set<string>
  injectFormat: 'date_summary'
}

const DEFAULT_DAYS = 5
const DEFAULT_FORMAT: TimelineAutoInjectConfig['injectFormat'] = 'date_summary'
const TIMELINE_BLOCK_PREFIX = '【时间轴·最近'

const toDateKey = (value: Date) => {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

const toDisplayDate = (dateKey: string) => dateKey.replace(/-/g, '.')

const normalizeModuleKey = (value: string) => value.trim().toLowerCase()

const extractConfigValue = (row: TimelineConfigRow) => {
  const value = row.value ?? row.config_value ?? row.setting_value
  if (typeof value === 'number') {
    return `${value}`
  }
  if (typeof value === 'string') {
    return value
  }
  return ''
}

const extractConfigKey = (row: TimelineConfigRow) => {
  const key = row.key ?? row.config_key ?? row.setting_key ?? row.name
  return typeof key === 'string' ? key : ''
}

const parseAutoInjectDays = (rawValue: string) => {
  const parsed = Number.parseInt(rawValue, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAYS
}

const parseInjectFormat = (rawValue: string): TimelineAutoInjectConfig['injectFormat'] => {
  const normalized = rawValue.trim().toLowerCase()
  return normalized === 'date_summary' ? 'date_summary' : DEFAULT_FORMAT
}

const parseAutoInjectModules = (rawValue: string) =>
  new Set(
    rawValue
      .split(',')
      .map((item) => normalizeModuleKey(item))
      .filter(Boolean),
  )

const loadTimelineConfigRows = async () => {
  if (!supabase) {
    return [] as TimelineConfigRow[]
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) {
    throw userError
  }

  if (!user) {
    return [] as TimelineConfigRow[]
  }

  const scoped = await supabase.from('timeline_config').select('*').eq('user_id', user.id)
  if (!scoped.error) {
    return (scoped.data ?? []) as TimelineConfigRow[]
  }

  const fallback = await supabase.from('timeline_config').select('*')
  if (fallback.error) {
    throw scoped.error
  }

  return ((fallback.data ?? []) as TimelineConfigRow[]).filter((row) => {
    const rowUserId = row.user_id
    return typeof rowUserId !== 'string' || rowUserId === user.id
  })
}

export const loadTimelineAutoInjectConfig = async (): Promise<TimelineAutoInjectConfig | null> => {
  try {
    const rows = await loadTimelineConfigRows()
    if (rows.length === 0) {
      return null
    }

    const byKey = new Map<string, string>()
    rows.forEach((row) => {
      const key = extractConfigKey(row).trim()
      if (!key) {
        return
      }
      byKey.set(key, extractConfigValue(row))
    })

    return {
      autoInjectDays: parseAutoInjectDays(byKey.get('auto_inject_days') ?? ''),
      autoInjectModules: parseAutoInjectModules(byKey.get('auto_inject_modules') ?? ''),
      injectFormat: parseInjectFormat(byKey.get('inject_format') ?? ''),
    }
  } catch (error) {
    console.warn('[timeline-auto-inject] Failed to load timeline_config:', error)
    return null
  }
}

export const fetchRecentTimelineEntries = async (autoInjectDays: number): Promise<TimelineEntryLite[]> => {
  if (!supabase) {
    return []
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) {
    throw userError
  }

  if (!user) {
    return []
  }

  const startDate = new Date()
  startDate.setHours(0, 0, 0, 0)
  startDate.setDate(startDate.getDate() - autoInjectDays)
  const startDateKey = toDateKey(startDate)

  const { data, error } = await supabase
    .from('timeline_entries')
    .select('event_date,summary,recorder,created_at')
    .eq('user_id', user.id)
    .gte('event_date', startDateKey)
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }

  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      eventDate: typeof row.event_date === 'string' ? row.event_date : '',
      summary: typeof row.summary === 'string' ? row.summary : '',
      recorder: (row.recorder === 'syzygy' ? 'syzygy' : 'chuanchuan') as TimelineRecorder,
    }))
    .filter((entry) => entry.eventDate && entry.summary.trim().length > 0)
}

export const buildTimelineInjectionText = (entries: TimelineEntryLite[], autoInjectDays: number): string | null => {
  if (entries.length === 0) {
    return null
  }

  const grouped = new Map<string, TimelineEntryLite[]>()
  entries.forEach((entry) => {
    const current = grouped.get(entry.eventDate) ?? []
    current.push(entry)
    grouped.set(entry.eventDate, current)
  })

  const dateSections = Array.from(grouped.entries()).map(([eventDate, dayEntries]) => {
    const lines = dayEntries.map((entry) => {
      const recorderLabel = entry.recorder === 'syzygy' ? '[Syzygy]' : '[串串]'
      return `* ${recorderLabel} ${entry.summary.trim()}`
    })
    return [toDisplayDate(eventDate), ...lines].join('\n')
  })

  return [`【时间轴·最近${autoInjectDays}天】`, ...dateSections].join('\n\n')
}

export const maybeInjectTimelineContext = async (
  baseMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  moduleKey: string,
) => {
  try {
    if (baseMessages.some((message) => message.role === 'system' && message.content.includes(TIMELINE_BLOCK_PREFIX))) {
      return baseMessages
    }

    const config = await loadTimelineAutoInjectConfig()
    if (!config) {
      return baseMessages
    }

    if (config.injectFormat !== 'date_summary') {
      return baseMessages
    }

    if (!config.autoInjectModules.has(normalizeModuleKey(moduleKey))) {
      return baseMessages
    }

    const entries = await fetchRecentTimelineEntries(config.autoInjectDays)
    const timelineBlock = buildTimelineInjectionText(entries, config.autoInjectDays)
    if (!timelineBlock) {
      return baseMessages
    }

    return [...baseMessages, { role: 'system' as const, content: timelineBlock }]
  } catch (error) {
    console.warn('[timeline-auto-inject] Failed to inject timeline context:', error)
    return baseMessages
  }
}
