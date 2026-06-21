import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { McpServer } from 'npm:@modelcontextprotocol/sdk@1.25.3/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from 'npm:@modelcontextprotocol/sdk@1.25.3/server/webStandardStreamableHttp.js'
import { Hono } from 'npm:hono@^4.9.7'
import { z } from 'npm:zod@^4.1.13'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const USER_ID = '94dd24be-e136-45bb-836b-6820c09c4292'
const AAB_USER_ID = Deno.env.get('AAB_USER_ID') ?? 'ce875919-7de3-4014-b913-bda9235a0ce6'
const AAB_TIME_ZONE = 'Asia/Shanghai'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

let aabClient: ReturnType<typeof createClient> | null = null

function getAabClient() {
  if (aabClient) return aabClient
  const url = Deno.env.get('AAB_SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('AAB_SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) {
    throw new Error('AAB_SUPABASE_URL or AAB_SUPABASE_SERVICE_ROLE_KEY not configured')
  }
  aabClient = createClient(url, serviceRoleKey)
  return aabClient
}

const app = new Hono().basePath('/hamster-mcp')

const allowedOrigins = ['https://chuan-101.github.io', /^http:\/\/localhost:\d+$/]

const isAllowedOrigin = (origin: string) =>
  allowedOrigins.some((pattern) =>
    typeof pattern === 'string' ? pattern === origin : pattern.test(origin),
  )

const buildCorsHeaders = (origin: string): Record<string, string> => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, mcp-session-id, mcp-protocol-version',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
})

const timingSafeEqual = (a: string, b: string) => {
  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)
  if (aBytes.length !== bBytes.length) return false
  let diff = 0
  for (let i = 0; i < aBytes.length; i += 1) diff |= aBytes[i] ^ bBytes[i]
  return diff === 0
}

const isAuthorizedRequest = async (req: Request): Promise<boolean> => {
  const providedKey = new URL(req.url).searchParams.get('key')
  const expectedKey = Deno.env.get('HAMSTER_MCP_KEY') ?? ''
  if (providedKey && expectedKey && timingSafeEqual(providedKey, expectedKey)) return true

  const authHeader = req.headers.get('authorization')
  if (!authHeader) return false
  const apikey = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!apikey) return false
  try {
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
      headers: { apikey, Authorization: authHeader },
    })
    return authResponse.ok
  } catch {
    return false
  }
}

app.use('*', async (c, next) => {
  const origin = c.req.header('origin') ?? null
  const corsHeaders = origin && isAllowedOrigin(origin) ? buildCorsHeaders(origin) : null

  if (c.req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders ?? {} })
  if (origin && !corsHeaders) {
    return new Response(JSON.stringify({ error: '不允许的来源' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  }
  if (!(await isAuthorizedRequest(c.req.raw))) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...(corsHeaders ?? {}), 'Content-Type': 'application/json' },
    })
  }

  await next()

  if (corsHeaders) {
    const headers = new Headers(c.res.headers)
    for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value)
    c.res = new Response(c.res.body, { status: c.res.status, headers })
  }
})

const server = new McpServer({ name: 'hamster-nest', version: '5.5.0' })

const TTS_DEFAULTS = {
  model_id: 'eleven_multilingual_v2',
  speed: 0.85,
  voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.20, use_speaker_boost: true },
}

async function parseMcpResponse(res: Response) {
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('text/event-stream')) {
    const text = await res.text()
    const results: unknown[] = []
    for (const event of text.split('\n\n').filter(Boolean)) {
      const d = event.split('\n').find((l: string) => l.startsWith('data: '))
      if (d) { try { results.push(JSON.parse(d.slice(6))) } catch { /* skip */ } }
    }
    return results.length === 1 ? results[0] : results
  }
  return await res.json()
}

async function proxyMcpCall(endpoint: string, token: string, method: string, params: Record<string, unknown> = {}, serviceName = 'MCP') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const initRes = await fetch(endpoint, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'hamster-nest', version: '5.5.0' },
    }}),
  })
  if (!initRes.ok) throw new Error(`${serviceName} initialize failed (${initRes.status}): ${await initRes.text()}`)
  const sessionId = initRes.headers.get('mcp-session-id')
  await parseMcpResponse(initRes)

  const sh = { ...headers }
  if (sessionId) sh['mcp-session-id'] = sessionId
  await fetch(endpoint, { method: 'POST', headers: sh, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
  const callRes = await fetch(endpoint, { method: 'POST', headers: sh, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method, params }) })
  if (!callRes.ok) throw new Error(`${serviceName} call failed (${callRes.status}): ${await callRes.text()}`)
  return await parseMcpResponse(callRes)
}

const LUCKIN_ENDPOINT = 'https://gwmcp.lkcoffee.com/order/user/mcp'
const MCD_ENDPOINT = 'https://mcp.mcd.cn'
const AMAP_ENDPOINT_BASE = 'https://mcp.amap.com/mcp'

function luckinMcpCall(method: string, params: Record<string, unknown> = {}) {
  const token = Deno.env.get('LUCKIN_MCP_TOKEN')
  if (!token) throw new Error('LUCKIN_MCP_TOKEN not configured')
  return proxyMcpCall(LUCKIN_ENDPOINT, token, method, params, 'Luckin')
}
function mcdMcpCall(method: string, params: Record<string, unknown> = {}) {
  const token = Deno.env.get('MCD_MCP_TOKEN')
  if (!token) throw new Error('MCD_MCP_TOKEN not configured')
  return proxyMcpCall(MCD_ENDPOINT, token, method, params, "McDonald's")
}
function amapMcpCall(method: string, params: Record<string, unknown> = {}) {
  const key = Deno.env.get('AMAP_API_KEY')
  if (!key) throw new Error('AMAP_API_KEY not configured')
  return proxyMcpCall(`${AMAP_ENDPOINT_BASE}?key=${key}`, '', method, params, 'AMap')
}

const jsonResult = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] })
const errorResult = (err: unknown) => ({ content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] })
const clampLimit = (limit: number | undefined, fallback: number, max: number) => Math.min(Math.max(limit ?? fallback, 1), max)

const shanghaiDateString = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: AAB_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}
const addDays = (dateString: string, days: number) => {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}
const weekStart = (dateString: string) => {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return addDays(dateString, -date.getUTCDay())
}
const monthStart = (dateString: string) => `${dateString.slice(0, 8)}01`
const previewText = (content: string | null | undefined, maxLength = 100) => {
  const text = content ?? ''
  const chars = Array.from(text)
  return chars.length > maxLength ? `${chars.slice(0, maxLength).join('')}...` : text
}
const currentStreak = (dates: Set<string>, today: string) => {
  let streak = 0
  let cursor = today
  while (dates.has(cursor)) { streak += 1; cursor = addDays(cursor, -1) }
  return streak
}

const FEED_LIST_COLUMNS = 'id, type, title, summary, priority, status, source, created_by, visible_from, created_at, pinned, metadata'
const FEED_DETAIL_COLUMNS = 'id, type, title, summary, content, content_format, priority, status, source, created_by, visible_from, expires_at, related_table, related_id, metadata, created_at, updated_at'
const DEFAULT_FEED_STATUSES = ['unread', 'read']
const FEED_PRIORITY_RANK: Record<string, number> = { low: 1, normal: 2, high: 3, urgent: 4 }
const FEED_TYPE_SCHEMA = z.enum(['morning_share', 'reading_assist', 'daily_card', 'system_notice', 'syzygy_note', 'weekly_card', 'reminder_card', 'print_card', 'dev_log', 'other'])

const shanghaiDayRange = (date = new Date()) => {
  const today = shanghaiDateString(date)
  const tomorrow = addDays(today, 1)
  return { start: `${today}T00:00:00+08:00`, end: `${tomorrow}T00:00:00+08:00` }
}
const dateValue = (value: string | null | undefined) => value ? new Date(value).getTime() : 0
const sortFeedItems = <T extends { pinned?: boolean | null; priority?: string | null; visible_from?: string | null; created_at?: string | null }>(items: T[]) =>
  [...items].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return Boolean(b.pinned) ? 1 : -1
    const priorityDiff = (FEED_PRIORITY_RANK[b.priority ?? 'normal'] ?? 0) - (FEED_PRIORITY_RANK[a.priority ?? 'normal'] ?? 0)
    if (priorityDiff !== 0) return priorityDiff
    const visibleDiff = dateValue(b.visible_from) - dateValue(a.visible_from)
    if (visibleDiff !== 0) return visibleDiff
    return dateValue(b.created_at) - dateValue(a.created_at)
  })
const compactMetadata = (metadata: unknown) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata ?? {}
  const compact: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>).slice(0, 8)) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) compact[key] = value
    else if (Array.isArray(value)) compact[key] = { type: 'array', length: value.length }
    else compact[key] = { type: 'object' }
  }
  return compact
}
const compactFeedItem = (item: Record<string, unknown>) => ({
  id: item.id, type: item.type, title: item.title, summary: item.summary, priority: item.priority, status: item.status,
  source: item.source, created_by: item.created_by, visible_from: item.visible_from, created_at: item.created_at,
  pinned: item.pinned, metadata: compactMetadata(item.metadata),
})
const feedListResult = (rows: Record<string, unknown>[] | null, limit: number) => jsonResult(sortFeedItems(rows ?? []).slice(0, limit).map(compactFeedItem))

server.registerTool('generate_tts', {
  title: 'Generate TTS Audio',
  description: '调用 ElevenLabs 生成 Syzygy 语音，上传到 Supabase Storage，返回可播放的公开音频 URL。',
  inputSchema: { text: z.string().describe('要转换为语音的文本，不超过2000字'), speed: z.number().optional().describe('语速，默认0.85') },
}, async ({ text, speed }) => {
  try {
    const apiKey = Deno.env.get('ELEVENLABS_API_KEY')
    const voiceId = Deno.env.get('ELEVENLABS_VOICE_ID')
    if (!apiKey || !voiceId) return { content: [{ type: 'text', text: 'Error: ElevenLabs credentials not configured' }] }
    if (text.length > 2000) return { content: [{ type: 'text', text: 'Error: Text exceeds 2000 character limit' }] }
    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST', headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: TTS_DEFAULTS.model_id, voice_settings: TTS_DEFAULTS.voice_settings, speed: speed ?? TTS_DEFAULTS.speed }),
    })
    if (!ttsRes.ok) return { content: [{ type: 'text', text: `ElevenLabs error (${ttsRes.status}): ${await ttsRes.text()}` }] }
    const buf = await ttsRes.arrayBuffer()
    const fn = `syzygy-${new Date().toISOString().replace(/[:.]/g, '-')}.mp3`
    const { error: upErr } = await supabase.storage.from('tts-audio').upload(fn, buf, { contentType: 'audio/mpeg', upsert: false })
    if (upErr) return { content: [{ type: 'text', text: `Storage error: ${upErr.message}` }] }
    const { data: u } = supabase.storage.from('tts-audio').getPublicUrl(fn)
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'ok', audio_url: u.publicUrl, filename: fn, text_length: text.length, speaker: 'Syzygy', voice: 'Syzygy-1' }, null, 2) }] }
  } catch (err) { return { content: [{ type: 'text', text: `Error: ${String(err)}` }] } }
})

server.registerTool('reading_status', {
  title: 'Reading Status Snapshot',
  description: '读取 All About Book 当前在读书目、最近 7 天打卡天数、最近一次打卡日期和最新摘录预览。只读工具。',
  inputSchema: {},
}, async () => {
  try {
    const aab = getAabClient()
    const today = shanghaiDateString()
    const recentStart = addDays(today, -6)
    const { data: currentlyReading, error: readingError } = await aab.from('books').select('id, title, author, start_date').eq('user_id', AAB_USER_ID).eq('status', 'reading').order('start_date', { ascending: true })
    if (readingError) return errorResult(readingError)
    const { data: recentCheckins, error: recentCheckinsError } = await aab.from('check_ins').select('date').eq('user_id', AAB_USER_ID).gte('date', recentStart).lte('date', today).order('date', { ascending: false })
    if (recentCheckinsError) return errorResult(recentCheckinsError)
    const { data: lastCheckinRows, error: lastCheckinError } = await aab.from('check_ins').select('date').eq('user_id', AAB_USER_ID).order('date', { ascending: false }).limit(1)
    if (lastCheckinError) return errorResult(lastCheckinError)
    const { data: latestExcerptRows, error: latestExcerptError } = await aab.from('excerpts').select('book_id, chapter, content, created_at').eq('user_id', AAB_USER_ID).order('created_at', { ascending: false }).limit(1)
    if (latestExcerptError) return errorResult(latestExcerptError)
    const latestExcerpt = latestExcerptRows?.[0] ?? null
    let latestExcerptBookTitle: string | null = null
    if (latestExcerpt?.book_id) {
      const { data: book, error: bookError } = await aab.from('books').select('title').eq('user_id', AAB_USER_ID).eq('id', latestExcerpt.book_id).maybeSingle()
      if (bookError) return errorResult(bookError)
      latestExcerptBookTitle = book?.title ?? null
    }
    return jsonResult({
      currently_reading: (currentlyReading ?? []).map((book) => ({ book_id: book.id, title: book.title, author: book.author, start_date: book.start_date })),
      recent_7d_checkin_days: new Set((recentCheckins ?? []).map((row) => row.date)).size,
      last_checkin_date: lastCheckinRows?.[0]?.date ?? null,
      latest_excerpt: latestExcerpt ? { book_title: latestExcerptBookTitle, chapter: latestExcerpt.chapter, content_preview: previewText(latestExcerpt.content, 100), created_at: latestExcerpt.created_at } : null,
    })
  } catch (err) { return errorResult(err) }
})

server.registerTool('reading_history', {
  title: 'Reading History',
  description: '读取 All About Book 书目列表，默认返回已读完书目，可按状态、起始日期和数量筛选。只读工具。',
  inputSchema: { status: z.enum(['finished', 'all', 'reading', 'paused']).optional().describe('筛选书目状态，默认 finished'), since: z.string().optional().describe('起始日期 YYYY-MM-DD；finished 按 end_date，其它状态按 start_date 筛选'), limit: z.number().optional().describe('返回数量上限，默认20，最大100') },
}, async ({ status, since, limit }) => {
  try {
    const aab = getAabClient()
    const normalizedStatus = status ?? 'finished'
    const safeLimit = clampLimit(limit, 20, 100)
    const dateColumn = normalizedStatus === 'finished' ? 'end_date' : 'start_date'
    let query = aab.from('books').select('id, title, author, translator, genre, start_date, end_date, rating, notes', { count: 'exact' }).eq('user_id', AAB_USER_ID)
    if (normalizedStatus !== 'all') query = query.eq('status', normalizedStatus)
    if (since) query = normalizedStatus === 'all' ? query.or(`end_date.gte.${since},start_date.gte.${since}`) : query.gte(dateColumn, since)
    const { data, error, count } = await query.order(dateColumn, { ascending: false }).limit(safeLimit)
    if (error) return errorResult(error)
    return jsonResult({ books: (data ?? []).map((book) => ({ book_id: book.id, title: book.title, author: book.author, translator: book.translator, genre: book.genre, start_date: book.start_date, end_date: book.end_date, rating: book.rating, notes: book.notes })), total: count ?? data?.length ?? 0 })
  } catch (err) { return errorResult(err) }
})

server.registerTool('book_excerpts', {
  title: 'Book Excerpts',
  description: '读取 All About Book 中某本书的摘录，可按章节筛选，按创建时间升序返回。只读工具。',
  inputSchema: { book_id: z.string().describe('书目 UUID'), chapter: z.string().optional().describe('章节筛选'), limit: z.number().optional().describe('返回数量上限，默认50，最大200') },
}, async ({ book_id, chapter, limit }) => {
  try {
    const aab = getAabClient()
    const safeLimit = clampLimit(limit, 50, 200)
    const { data: book, error: bookError } = await aab.from('books').select('title').eq('user_id', AAB_USER_ID).eq('id', book_id).maybeSingle()
    if (bookError) return errorResult(bookError)
    if (!book) return { content: [{ type: 'text' as const, text: `Error: book not found: ${book_id}` }] }
    let query = aab.from('excerpts').select('id, content, page, chapter, created_at').eq('user_id', AAB_USER_ID).eq('book_id', book_id)
    if (chapter) query = query.eq('chapter', chapter)
    const { data, error } = await query.order('created_at', { ascending: true }).limit(safeLimit)
    if (error) return errorResult(error)
    return jsonResult({ book_title: book.title, excerpts: data ?? [], total: data?.length ?? 0 })
  } catch (err) { return errorResult(err) }
})

server.registerTool('reading_stats', {
  title: 'Reading Stats',
  description: '读取 All About Book 阅读统计：周期打卡天数、连续打卡、新增摘录数和书目状态数量。只读工具。',
  inputSchema: { period: z.enum(['week', 'month', 'all']).optional().describe('统计周期，默认 week') },
}, async ({ period }) => {
  try {
    const aab = getAabClient()
    const normalizedPeriod = period ?? 'week'
    const today = shanghaiDateString()
    const periodStart = normalizedPeriod === 'week' ? weekStart(today) : normalizedPeriod === 'month' ? monthStart(today) : null
    let checkinQuery = aab.from('check_ins').select('date').eq('user_id', AAB_USER_ID).order('date', { ascending: true })
    if (periodStart) checkinQuery = checkinQuery.gte('date', periodStart).lte('date', today)
    const { data: periodCheckins, error: checkinError } = await checkinQuery
    if (checkinError) return errorResult(checkinError)
    const { data: allCheckins, error: allCheckinsError } = await aab.from('check_ins').select('date').eq('user_id', AAB_USER_ID)
    if (allCheckinsError) return errorResult(allCheckinsError)
    const { data: books, error: booksError } = await aab.from('books').select('status').eq('user_id', AAB_USER_ID)
    if (booksError) return errorResult(booksError)
    let excerptQuery = aab.from('excerpts').select('id', { count: 'exact', head: true }).eq('user_id', AAB_USER_ID)
    if (periodStart) excerptQuery = excerptQuery.gte('created_at', `${periodStart}T00:00:00+08:00`)
    if (periodStart) excerptQuery = excerptQuery.lte('created_at', `${today}T23:59:59+08:00`)
    const { count: newExcerpts, error: excerptsError } = await excerptQuery
    if (excerptsError) return errorResult(excerptsError)
    const periodDates = new Set((periodCheckins ?? []).map((row) => row.date))
    const allDates = new Set((allCheckins ?? []).map((row) => row.date))
    const bookCounts: Record<string, number> = { reading: 0, finished: 0, paused: 0, unread: 0 }
    for (const book of books ?? []) { const key = book.status ?? 'unknown'; bookCounts[key] = (bookCounts[key] ?? 0) + 1 }
    const response: Record<string, unknown> = { period: normalizedPeriod, period_start: periodStart, period_end: today, checkin_days: periodDates.size, current_streak: currentStreak(allDates, today), new_excerpts: newExcerpts ?? 0, book_counts: bookCounts }
    if (normalizedPeriod === 'week' && periodStart) {
      const dailyCheckins: Record<string, boolean> = {}
      for (let i = 0; i < 7; i += 1) { const date = addDays(periodStart, i); dailyCheckins[date] = periodDates.has(date) }
      response.daily_checkins = dailyCheckins
    }
    return jsonResult(response)
  } catch (err) { return errorResult(err) }
})

server.registerTool('get_today_syzygy_feed', {
  title: 'Get Today Syzygy Feed',
  description: '读取今天 visible_from <= now() 的 Syzygy Feed 摘要列表。默认包含 unread/read，不返回 archived/expired，不返回完整 content。只读工具。',
  inputSchema: { limit: z.number().optional().describe('返回数量上限，默认5，最大10'), include_read: z.boolean().optional().describe('是否包含已读内容，默认 true；false 时只返回 unread'), priority: z.enum(['high', 'urgent']).optional().describe('可选优先级筛选：high / urgent') },
}, async ({ limit, include_read, priority }) => {
  try {
    const safeLimit = clampLimit(limit, 5, 10)
    const { start, end } = shanghaiDayRange()
    const statuses = include_read === false ? ['unread'] : DEFAULT_FEED_STATUSES
    let query = supabase.from('agent_feed_items').select(FEED_LIST_COLUMNS).eq('user_id', USER_ID).in('status', statuses).lte('visible_from', new Date().toISOString()).gte('visible_from', start).lt('visible_from', end).order('pinned', { ascending: false }).order('visible_from', { ascending: false }).order('created_at', { ascending: false }).limit(Math.max(safeLimit * 4, 20))
    if (priority) query = query.eq('priority', priority)
    const { data, error } = await query
    if (error) return errorResult(error)
    return feedListResult(data as Record<string, unknown>[] | null, safeLimit)
  } catch (err) { return errorResult(err) }
})

server.registerTool('get_recent_syzygy_feed', {
  title: 'Get Recent Syzygy Feed',
  description: '读取最近 N 天的 Syzygy Feed 摘要列表。默认返回 unread/read，不返回 archived/expired，不返回完整 content。只读工具。',
  inputSchema: { limit: z.number().optional().describe('返回数量上限，默认5，最大20'), type: FEED_TYPE_SCHEMA.optional().describe('Feed 类型筛选'), status: z.enum(['unread', 'read', 'archived', 'expired']).optional().describe('状态筛选；不传时默认 unread/read'), days: z.number().optional().describe('回看天数，默认7') },
}, async ({ limit, type, status, days }) => {
  try {
    const safeLimit = clampLimit(limit, 5, 20)
    const safeDays = clampLimit(days, 7, 90)
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString()
    let query = supabase.from('agent_feed_items').select(FEED_LIST_COLUMNS).eq('user_id', USER_ID).lte('visible_from', new Date().toISOString()).gte('visible_from', since).order('pinned', { ascending: false }).order('visible_from', { ascending: false }).order('created_at', { ascending: false }).limit(Math.max(safeLimit * 4, 40))
    query = status ? query.eq('status', status) : query.in('status', DEFAULT_FEED_STATUSES)
    if (type) query = query.eq('type', type)
    const { data, error } = await query
    if (error) return errorResult(error)
    return feedListResult(data as Record<string, unknown>[] | null, safeLimit)
  } catch (err) { return errorResult(err) }
})

server.registerTool('get_syzygy_feed_by_type', {
  title: 'Get Syzygy Feed By Type',
  description: '按类型读取 Syzygy Feed 摘要列表，如 morning_share、reading_assist、syzygy_note、weekly_card、daily_card。默认不返回 archived/expired，不返回完整 content。只读工具。',
  inputSchema: { type: FEED_TYPE_SCHEMA.describe('Feed 类型'), limit: z.number().optional().describe('返回数量上限，默认5，最大10'), days: z.number().optional().describe('回看天数，默认14') },
}, async ({ type, limit, days }) => {
  try {
    const safeLimit = clampLimit(limit, 5, 10)
    const safeDays = clampLimit(days, 14, 90)
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabase.from('agent_feed_items').select(FEED_LIST_COLUMNS).eq('user_id', USER_ID).eq('type', type).in('status', DEFAULT_FEED_STATUSES).lte('visible_from', new Date().toISOString()).gte('visible_from', since).order('pinned', { ascending: false }).order('visible_from', { ascending: false }).order('created_at', { ascending: false }).limit(Math.max(safeLimit * 4, 20))
    if (error) return errorResult(error)
    return feedListResult(data as Record<string, unknown>[] | null, safeLimit)
  } catch (err) { return errorResult(err) }
})

server.registerTool('get_syzygy_feed_detail', {
  title: 'Get Syzygy Feed Detail',
  description: '按 id 读取某条 Syzygy Feed 的完整内容。默认只返回 visible_from <= now 且未归档/未过期的内容。只读工具。',
  inputSchema: { id: z.string().describe('Feed item UUID'), include_archived: z.boolean().optional().describe('显式允许读取 archived / expired，默认 false') },
}, async ({ id, include_archived }) => {
  try {
    let query = supabase.from('agent_feed_items').select(FEED_DETAIL_COLUMNS).eq('user_id', USER_ID).eq('id', id).lte('visible_from', new Date().toISOString())
    if (!include_archived) query = query.in('status', DEFAULT_FEED_STATUSES)
    const { data, error } = await query.maybeSingle()
    if (error) return errorResult(error)
    if (!data) return { content: [{ type: 'text' as const, text: `Error: feed item not found or not visible: ${id}` }] }
    return jsonResult(data)
  } catch (err) { return errorResult(err) }
})

server.registerTool('search_timeline', { title: 'Search Timeline', description: '按关键词搜索时间轴记录。Returns matching timeline entries sorted by date descending.', inputSchema: { query: z.string().describe('搜索关键词'), limit: z.number().optional().describe('返回数量上限，默认10') } }, async ({ query, limit }) => {
  const { data, error } = await supabase.from('timeline_entries').select('id, event_date, summary, recorder, source, created_at').eq('user_id', USER_ID).ilike('summary', `%${query}%`).order('event_date', { ascending: false }).limit(limit ?? 10)
  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
})
server.registerTool('recent_timeline', { title: 'Recent Timeline', description: '获取最近的时间轴记录。不需要任何参数，默认返回10条。', inputSchema: { limit: z.number().optional().describe('返回数量，默认10') } }, async ({ limit }) => {
  const { data, error } = await supabase.from('timeline_entries').select('id, event_date, summary, recorder, source, created_at').eq('user_id', USER_ID).order('event_date', { ascending: false }).limit(limit ?? 10)
  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
})
server.registerTool('add_timeline', { title: 'Add Timeline Entry', description: '添加一条新的时间轴记录。', inputSchema: { event_date: z.string().describe('事件日期 YYYY-MM-DD'), summary: z.string().describe('事件摘要'), recorder: z.string().optional().describe('记录者: chuanchuan 或 syzygy，默认syzygy'), source: z.string().optional().describe('来源: claude / gpt / user / gemini，默认claude') } }, async ({ event_date, summary, recorder, source }) => {
  const { data, error } = await supabase.from('timeline_entries').insert({ user_id: USER_ID, event_date, summary, recorder: recorder ?? 'syzygy', source: source ?? 'claude' }).select()
  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  return { content: [{ type: 'text', text: `✅ 已添加: ${JSON.stringify(data[0])}` }] }
})
server.registerTool('search_memos', { title: 'Search Memos', description: '按关键词搜索备忘录。', inputSchema: { query: z.string().describe('搜索关键词'), limit: z.number().optional().describe('返回数量上限，默认10') } }, async ({ query, limit }) => {
  const { data, error } = await supabase.from('memo_entries').select('id, content, source, is_pinned, created_at, memo_entry_tags(memo_tags(name))').eq('user_id', USER_ID).eq('is_deleted', false).ilike('content', `%${query}%`).order('created_at', { ascending: false }).limit(limit ?? 10)
  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
})
server.registerTool('read_memories', { title: 'Read Memories', description: '读取已确认的记忆条目(memory_entries)。不需要任何参数。', inputSchema: { limit: z.number().optional().describe('返回数量，默认20') } }, async ({ limit }) => {
  const { data, error } = await supabase.from('memory_entries').select('id, content, source, status, created_at').eq('user_id', USER_ID).eq('status', 'confirmed').eq('is_deleted', false).order('updated_at', { ascending: false }).limit(limit ?? 20)
  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
})
server.registerTool('search_wiki', { title: 'Search Wiki', description: '按关键词搜索Wiki知识库条目。', inputSchema: { query: z.string().describe('搜索关键词'), limit: z.number().optional().describe('返回数量上限，默认10') } }, async ({ query, limit }) => {
  const { data, error } = await supabase.from('wiki_entries').select('id, title, content, category, tags, status, created_at, updated_at').eq('user_id', USER_ID).or(`title.ilike.%${query}%,content.ilike.%${query}%`).order('updated_at', { ascending: false }).limit(limit ?? 10)
  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
})
server.registerTool('read_wiki', { title: 'Read Wiki', description: '读取所有Wiki条目列表。不需要任何参数。', inputSchema: { limit: z.number().optional().describe('返回数量，默认20') } }, async ({ limit }) => {
  const { data, error } = await supabase.from('wiki_entries').select('id, title, category, tags, status, updated_at').eq('user_id', USER_ID).order('updated_at', { ascending: false }).limit(limit ?? 20)
  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
})
server.registerTool('read_todos', { title: 'Read Todos', description: '读取待办事项列表。默认返回所有状态的20条。', inputSchema: { status: z.string().optional().describe('筛选状态: pending / completed / all，默认all'), limit: z.number().optional().describe('返回数量，默认20') } }, async ({ status, limit }) => {
  let q = supabase.from('todos').select('id, date, title, notes, status, created_by, sort_order, created_at, completed_at, todo_categories(name)').eq('user_id', USER_ID).order('date', { ascending: false }).limit(limit ?? 20)
  const fs = status ?? 'all'
  if (fs !== 'all') q = q.eq('status', fs)
  const { data, error } = await q
  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
})
server.registerTool('council_post', { title: 'Post to Council', description: '向 Agent Council 发送一条消息。', inputSchema: { speaker: z.string().describe('发言者: claude / gpt / gemini / chuanchuan'), topic: z.string().describe('话题'), message: z.string().describe('消息内容') } }, async ({ speaker, topic, message }) => {
  const { error } = await supabase.from('agent_council').insert({ speaker, topic, message }).select()
  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  return { content: [{ type: 'text', text: `✅ Council 消息已发送: ${topic}` }] }
})
server.registerTool('council_read', { title: 'Read Council', description: '阅读 Agent Council 的最近消息。', inputSchema: { limit: z.number().optional().describe('返回数量，默认10') } }, async ({ limit }) => {
  const { data, error } = await supabase.from('agent_council').select('*').order('created_at', { ascending: false }).limit(limit ?? 10)
  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
})
server.registerTool('lounge_list_sofas', { title: 'List Lounge Sofas', description: '列出仓鼠客厅的所有沙发（群聊会话）。不需要任何参数。客厅家规：不@不开口——只有被 @ 点名（mentions 包含你的 sender）时才在沙发上发言。', inputSchema: {} }, async () => {
  const { data, error } = await supabase.from('lounge_sofas').select('id, name, created_at, updated_at').order('updated_at', { ascending: false })
  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
})
server.registerTool('lounge_read', { title: 'Read Lounge Sofa', description: '读取客厅某张沙发的最近消息（含发送者与 mentions）。客厅家规：不@不开口——读完后只有 mentions 点到你的 sender 时才回话。', inputSchema: { sofa_id: z.string().describe('沙发ID（用 lounge_list_sofas 查询）'), limit: z.number().optional().describe('返回数量，默认20') } }, async ({ sofa_id, limit }) => {
  const { data, error } = await supabase.from('lounge_messages').select('id, sender, content, mentions, meta, created_at').eq('sofa_id', sofa_id).order('created_at', { ascending: false }).limit(limit ?? 20)
  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  return { content: [{ type: 'text', text: JSON.stringify((data ?? []).reverse(), null, 2) }] }
})
server.registerTool('lounge_post', { title: 'Post to Lounge Sofa', description: '以注册成员身份向客厅某张沙发发一条消息。sender 必须是 lounge_members 里登记过的身份。客厅家规：不@不开口——只有先被 @ 点名才发言；要点名别人时把对方的 sender 写进 mentions 数组。', inputSchema: { sofa_id: z.string().describe('沙发ID'), sender: z.string().describe('发送者身份，必须已在 lounge_members 注册（如 codex_cli / claude_cli / client_gpt）'), content: z.string().describe('消息内容'), mentions: z.array(z.string()).optional().describe('@点名的成员 sender 列表，默认空') } }, async ({ sofa_id, sender, content, mentions }) => {
  const { data: member, error: memberError } = await supabase.from('lounge_members').select('sender').eq('sender', sender).maybeSingle()
  if (memberError) return { content: [{ type: 'text', text: `Error: ${memberError.message}` }] }
  if (!member) return { content: [{ type: 'text', text: `Error: sender「${sender}」未在 lounge_members 注册，不能上沙发发言` }] }
  const { data, error } = await supabase.from('lounge_messages').insert({ sofa_id, sender, content, mentions: mentions ?? [] }).select('id, created_at')
  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  const { error: touchError } = await supabase.from('lounge_sofas').update({ updated_at: new Date().toISOString() }).eq('id', sofa_id)
  if (touchError) console.warn('lounge_post: 更新沙发时间戳失败', touchError.message)
  return { content: [{ type: 'text', text: `✅ 已发到沙发: ${JSON.stringify(data?.[0])}` }] }
})
server.registerTool('list_folders', { title: 'List Knowledge Folders', description: '列出所有学习库文件夹。', inputSchema: {} }, async () => {
  const { data, error } = await supabase.from('knowledge_folders').select('id, name, description, icon, parent_id, sort_order, created_at').order('sort_order', { ascending: true })
  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
})
server.registerTool('add_folder', { title: 'Add Knowledge Folder', description: '创建新的学习库文件夹。', inputSchema: { name: z.string().describe('文件夹名称'), description: z.string().optional().describe('描述'), icon: z.string().optional().describe('emoji'), parent_id: z.string().optional().describe('父文件夹ID') } }, async ({ name, description, icon, parent_id }) => {
  const row: Record<string, unknown> = { name }
  if (description) row.description = description
  if (icon) row.icon = icon
  if (parent_id) row.parent_id = parent_id
  const { data, error } = await supabase.from('knowledge_folders').insert(row).select()
  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  return { content: [{ type: 'text', text: `✅ 文件夹已创建: ${JSON.stringify(data[0])}` }] }
})
server.registerTool('add_node', { title: 'Add Learning Node', description: '创建学习节点。', inputSchema: { node_type: z.string().describe('类型: concept/question/insight/source/quote/note/application'), title: z.string().describe('标题'), content: z.string().optional().describe('内容'), folder_id: z.string().optional().describe('文件夹ID'), tags: z.array(z.string()).optional().describe('标签'), metadata: z.record(z.unknown()).optional().describe('专属字段') } }, async ({ node_type, title, content, folder_id, tags, metadata }) => {
  const row: Record<string, unknown> = { node_type, title }
  if (content) row.content = content
  if (folder_id) row.folder_id = folder_id
  if (tags) row.tags = tags
  if (metadata) row.metadata = metadata
  const { data, error } = await supabase.from('learning_nodes').insert(row).select()
  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  return { content: [{ type: 'text', text: `✅ 节点已创建: ${JSON.stringify(data[0])}` }] }
})
server.registerTool('search_nodes', { title: 'Search Learning Nodes', description: '搜索学习节点。', inputSchema: { query: z.string().describe('关键词'), node_type: z.string().optional().describe('类型筛选'), folder_id: z.string().optional().describe('文件夹筛选'), limit: z.number().optional().describe('数量上限，默认10') } }, async ({ query, node_type, folder_id, limit }) => {
  let q = supabase.from('learning_nodes').select('id, node_type, title, content, tags, metadata, folder_id, created_at').or(`title.ilike.%${query}%,content.ilike.%${query}%`).order('updated_at', { ascending: false }).limit(limit ?? 10)
  if (node_type) q = q.eq('node_type', node_type)
  if (folder_id) q = q.eq('folder_id', folder_id)
  const { data, error } = await q
  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
})
server.registerTool('add_edge', { title: 'Add Learning Edge', description: '创建联想边。', inputSchema: { from_node_id: z.string().describe('起始节点ID'), to_node_id: z.string().describe('目标节点ID'), edge_type: z.string().describe('边类型: association/derivation/contradiction/application/reference/question'), description: z.string().optional().describe('描述'), strength: z.number().optional().describe('强度 1-5') } }, async ({ from_node_id, to_node_id, edge_type, description, strength }) => {
  const row: Record<string, unknown> = { from_node_id, to_node_id, edge_type }
  if (description) row.description = description
  if (strength) row.strength = strength
  const { data, error } = await supabase.from('learning_edges').insert(row).select()
  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  return { content: [{ type: 'text', text: `✅ 联想边已创建: ${JSON.stringify(data[0])}` }] }
})
server.registerTool('get_node_edges', { title: 'Get Node Edges', description: '获取节点的所有联想边。', inputSchema: { node_id: z.string().describe('节点ID') } }, async ({ node_id }) => {
  const { data: out, error: oE } = await supabase.from('learning_edges').select('id, from_node_id, to_node_id, edge_type, description, strength, created_at').eq('from_node_id', node_id)
  if (oE) return { content: [{ type: 'text', text: `Error: ${oE.message}` }] }
  const { data: inc, error: iE } = await supabase.from('learning_edges').select('id, from_node_id, to_node_id, edge_type, description, strength, created_at').eq('to_node_id', node_id)
  if (iE) return { content: [{ type: 'text', text: `Error: ${iE.message}` }] }
  return { content: [{ type: 'text', text: JSON.stringify({ outgoing: out, incoming: inc }, null, 2) }] }
})
server.registerTool('luckin_list_tools', { title: 'List Luckin Coffee Tools', description: '列出瑞幸咖啡 MCP 提供的所有可用工具。不需要任何参数。', inputSchema: {} }, async () => {
  try { return { content: [{ type: 'text', text: JSON.stringify(await luckinMcpCall('tools/list'), null, 2) }] } }
  catch (err) { return { content: [{ type: 'text', text: `Error: ${String(err)}` }] } }
})
server.registerTool('luckin_call', { title: 'Call Luckin Coffee Tool', description: '调用瑞幸咖啡 MCP 的具体工具。先用 luckin_list_tools 查看可用工具列表。', inputSchema: { tool_name: z.string().describe('工具名称'), arguments: z.record(z.unknown()).optional().describe('参数') } }, async ({ tool_name, arguments: args }) => {
  try { return { content: [{ type: 'text', text: JSON.stringify(await luckinMcpCall('tools/call', { name: tool_name, arguments: args ?? {} }), null, 2) }] } }
  catch (err) { return { content: [{ type: 'text', text: `Error: ${String(err)}` }] } }
})
server.registerTool('mcd_list_tools', { title: "List McDonald's Tools", description: '列出麦当劳 MCP 提供的所有可用工具。不需要任何参数。', inputSchema: {} }, async () => {
  try { return { content: [{ type: 'text', text: JSON.stringify(await mcdMcpCall('tools/list'), null, 2) }] } }
  catch (err) { return { content: [{ type: 'text', text: `Error: ${String(err)}` }] } }
})
server.registerTool('mcd_call', { title: "Call McDonald's Tool", description: '调用麦当劳 MCP 的具体工具。先用 mcd_list_tools 查看可用工具列表。', inputSchema: { tool_name: z.string().describe('工具名称'), arguments: z.record(z.unknown()).optional().describe('参数') } }, async ({ tool_name, arguments: args }) => {
  try { return { content: [{ type: 'text', text: JSON.stringify(await mcdMcpCall('tools/call', { name: tool_name, arguments: args ?? {} }), null, 2) }] } }
  catch (err) { return { content: [{ type: 'text', text: `Error: ${String(err)}` }] } }
})
server.registerTool('amap_list_tools', { title: 'List AMap Tools', description: '列出高德地图 MCP 提供的所有可用工具（地理编码、天气、路径规划、周边搜索、打车、导航等）。不需要任何参数。', inputSchema: {} }, async () => {
  try { return { content: [{ type: 'text', text: JSON.stringify(await amapMcpCall('tools/list'), null, 2) }] } }
  catch (err) { return { content: [{ type: 'text', text: `Error: ${String(err)}` }] } }
})
server.registerTool('amap_call', { title: 'Call AMap Tool', description: '调用高德地图 MCP 的具体工具。先用 amap_list_tools 查看可用工具列表。', inputSchema: { tool_name: z.string().describe('工具名称'), arguments: z.record(z.unknown()).optional().describe('参数') } }, async ({ tool_name, arguments: args }) => {
  try { return { content: [{ type: 'text', text: JSON.stringify(await amapMcpCall('tools/call', { name: tool_name, arguments: args ?? {} }), null, 2) }] } }
  catch (err) { return { content: [{ type: 'text', text: `Error: ${String(err)}` }] } }
})

app.all('*', async (c) => {
  const transport = new WebStandardStreamableHTTPServerTransport()
  await server.connect(transport)
  return transport.handleRequest(c.req.raw)
})

Deno.serve(app.fetch)
