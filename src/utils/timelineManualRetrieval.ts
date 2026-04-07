import { supabase } from '../supabase/client'
import type { TimelineRecorder } from '../types'

type TimelineEntryLite = {
  eventDate: string
  summary: string
  recorder: TimelineRecorder
  createdAt: string
}

type TimelineDateRange = {
  startDate: string
  endDate: string
}

export type ManualTimelineResolution = {
  detected: boolean
  parsedRange: TimelineDateRange | null
  entries: TimelineEntryLite[]
  timelineText: string | null
}

const TIMELINE_TRIGGER_TOKEN = '时间轴'
const TIMELINE_HEADER = '【时间轴】'

const pad = (value: number) => `${value}`.padStart(2, '0')

const toDateKey = (value: Date) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`

const toDisplayDate = (dateKey: string) => dateKey.replace(/-/g, '.')

const normalizeDayStart = (value: Date) => {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

const buildMonthRange = (year: number, month: number): TimelineDateRange => {
  const start = new Date(year, month - 1, 1)
  const end = new Date(year, month, 0)
  return { startDate: toDateKey(start), endDate: toDateKey(end) }
}

const parseDateText = (value: string) => {
  const match = value.match(/^(\d{4})\.(\d{2})\.(\d{2})/)
  if (!match) {
    return null
  }

  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10)
  const day = Number.parseInt(match[3], 10)
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }

  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) {
    return null
  }

  return { dateKey: toDateKey(date), consumed: match[0].length }
}

export const parseTimelineDateRange = (source: string, now = new Date()): TimelineDateRange | null => {
  const input = source.trimStart()
  if (!input) {
    return null
  }

  if (/^今天(?:\b|\s|$|[，。,.!?！？])/u.test(input)) {
    const dateKey = toDateKey(normalizeDayStart(now))
    return { startDate: dateKey, endDate: dateKey }
  }

  if (/^昨天(?:\b|\s|$|[，。,.!?！？])/u.test(input)) {
    const target = normalizeDayStart(now)
    target.setDate(target.getDate() - 1)
    const dateKey = toDateKey(target)
    return { startDate: dateKey, endDate: dateKey }
  }

  if (/^上周(?:\b|\s|$|[，。,.!?！？])/u.test(input)) {
    const end = normalizeDayStart(now)
    const start = normalizeDayStart(now)
    start.setDate(start.getDate() - 6)
    return { startDate: toDateKey(start), endDate: toDateKey(end) }
  }

  if (/^本月(?:\b|\s|$|[，。,.!?！？])/u.test(input)) {
    return buildMonthRange(now.getFullYear(), now.getMonth() + 1)
  }

  const monthMatch = input.match(/^(\d{1,2})月(?:\b|\s|$|[，。,.!?！？])/u)
  if (monthMatch) {
    const month = Number.parseInt(monthMatch[1], 10)
    if (month >= 1 && month <= 12) {
      return buildMonthRange(now.getFullYear(), month)
    }
  }

  const startDate = parseDateText(input)
  if (!startDate) {
    return null
  }

  const remaining = input.slice(startDate.consumed).trimStart()
  if (!remaining) {
    return { startDate: startDate.dateKey, endDate: startDate.dateKey }
  }

  if (!remaining.startsWith('-')) {
    return null
  }

  const endDate = parseDateText(remaining.slice(1).trimStart())
  if (!endDate) {
    return null
  }

  if (startDate.dateKey > endDate.dateKey) {
    return null
  }

  return { startDate: startDate.dateKey, endDate: endDate.dateKey }
}

export const detectTimelineManualRequest = (message: string, now = new Date()): TimelineDateRange | null => {
  if (!message.includes(TIMELINE_TRIGGER_TOKEN)) {
    return null
  }

  let searchFrom = 0
  while (searchFrom < message.length) {
    const triggerIndex = message.indexOf(TIMELINE_TRIGGER_TOKEN, searchFrom)
    if (triggerIndex < 0) {
      return null
    }

    const parsedRange = parseTimelineDateRange(message.slice(triggerIndex + TIMELINE_TRIGGER_TOKEN.length), now)
    if (parsedRange) {
      return parsedRange
    }

    searchFrom = triggerIndex + TIMELINE_TRIGGER_TOKEN.length
  }

  return null
}

export const fetchTimelineEntriesForRange = async (range: TimelineDateRange): Promise<TimelineEntryLite[]> => {
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

  let query = supabase
    .from('timeline_entries')
    .select('event_date,summary,recorder,created_at')
    .eq('user_id', user.id)
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: true })

  if (range.startDate === range.endDate) {
    query = query.eq('event_date', range.startDate)
  } else {
    query = query.gte('event_date', range.startDate).lte('event_date', range.endDate)
  }

  const { data, error } = await query
  if (error) {
    throw error
  }

  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((entry) => ({
      eventDate: typeof entry.event_date === 'string' ? entry.event_date : '',
      summary: typeof entry.summary === 'string' ? entry.summary : '',
      recorder: (entry.recorder === 'syzygy' ? 'syzygy' : 'chuanchuan') as TimelineRecorder,
      createdAt: typeof entry.created_at === 'string' ? entry.created_at : '',
    }))
    .filter((entry) => entry.eventDate && entry.summary.trim())
}

export const buildTimelineManualInjectionText = (entries: TimelineEntryLite[]): string | null => {
  if (entries.length === 0) {
    return null
  }

  const grouped = new Map<string, TimelineEntryLite[]>()
  entries.forEach((entry) => {
    const current = grouped.get(entry.eventDate) ?? []
    current.push(entry)
    grouped.set(entry.eventDate, current)
  })

  const sections = Array.from(grouped.entries()).map(([eventDate, dayEntries]) => {
    const lines = dayEntries.map((entry) => {
      const recorderLabel = entry.recorder === 'syzygy' ? '[Syzygy]' : '[串串]'
      return `* ${recorderLabel} ${entry.summary.trim()}`
    })
    return [toDisplayDate(eventDate), ...lines].join('\n')
  })

  return [TIMELINE_HEADER, ...sections].join('\n\n')
}

export const maybeInjectManualTimelineContext = async (message: string): Promise<string | null> => {
  try {
    const result = await resolveManualTimelineContext(message)
    return result.timelineText
  } catch (error) {
    console.warn('[timeline-manual] Failed to inject timeline context:', error)
    return null
  }
}

export const resolveManualTimelineContext = async (
  message: string,
): Promise<ManualTimelineResolution> => {
  const parsedRange = detectTimelineManualRequest(message)
  if (!parsedRange) {
    return {
      detected: false,
      parsedRange: null,
      entries: [],
      timelineText: null,
    }
  }

  const entries = await fetchTimelineEntriesForRange(parsedRange)
  const timelineText = buildTimelineManualInjectionText(entries)
  return {
    detected: true,
    parsedRange,
    entries,
    timelineText,
  }
}
