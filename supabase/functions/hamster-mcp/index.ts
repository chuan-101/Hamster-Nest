import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { McpServer } from 'npm:@modelcontextprotocol/sdk@1.25.3/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from 'npm:@modelcontextprotocol/sdk@1.25.3/server/webStandardStreamableHttp.js'
import { Hono } from 'npm:hono@^4.9.7'
import { z } from 'npm:zod@^4.1.13'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const USER_ID = '94dd24be-e136-45bb-836b-6820c09c4292'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const app = new Hono().basePath('/hamster-mcp')

// ── CORS & 鉴权 ──
//
// 双通道鉴权，任一通过即放行：
// 1. connector 通道：URL query 携带密钥（?key=xxx，对比 env HAMSTER_MCP_KEY）。
//    Claude/GPT connector 无法自定义 header，只能走这条；env 未配置时该通道关闭。
// 2. 前端通道：Authorization 携带 Supabase 用户 JWT（+ apikey header），
//    与 openrouter-chat 相同方式调用 /auth/v1/user 校验。

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
  if (aBytes.length !== bBytes.length) {
    return false
  }
  let diff = 0
  for (let i = 0; i < aBytes.length; i += 1) {
    diff |= aBytes[i] ^ bBytes[i]
  }
  return diff === 0
}

const isAuthorizedRequest = async (req: Request): Promise<boolean> => {
  const providedKey = new URL(req.url).searchParams.get('key')
  const expectedKey = Deno.env.get('HAMSTER_MCP_KEY') ?? ''
  if (providedKey && expectedKey && timingSafeEqual(providedKey, expectedKey)) {
    return true
  }

  const authHeader = req.headers.get('authorization')
  if (!authHeader) {
    return false
  }
  const apikey = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!apikey) {
    return false
  }
  try {
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
      headers: {
        apikey,
        Authorization: authHeader,
      },
    })
    return authResponse.ok
  } catch {
    return false
  }
}

app.use('*', async (c, next) => {
  const origin = c.req.header('origin') ?? null
  const corsHeaders = origin && isAllowedOrigin(origin) ? buildCorsHeaders(origin) : null

  if (c.req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders ?? {} })
  }
  if (origin && !corsHeaders) {
    return new Response(JSON.stringify({ error: '不允许的来源' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
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
    for (const [name, value] of Object.entries(corsHeaders)) {
      headers.set(name, value)
    }
    c.res = new Response(c.res.body, { status: c.res.status, headers })
  }
})

const server = new McpServer({
  name: 'hamster-nest',
  version: '5.4.0',
})

const TTS_DEFAULTS = {
  model_id: 'eleven_multilingual_v2',
  speed: 0.85,
  voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.20, use_speaker_boost: true },
}

// ── Generic MCP Proxy helper ──

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

async function proxyMcpCall(
  endpoint: string,
  token: string,
  method: string,
  params: Record<string, unknown> = {},
  serviceName = 'MCP'
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const initRes = await fetch(endpoint, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-03-26', capabilities: {},
      clientInfo: { name: 'hamster-nest', version: '5.4.0' },
    }}),
  })
  if (!initRes.ok) throw new Error(`${serviceName} initialize failed (${initRes.status}): ${await initRes.text()}`)

  const sessionId = initRes.headers.get('mcp-session-id')
  await parseMcpResponse(initRes)

  const sh = { ...headers }
  if (sessionId) sh['mcp-session-id'] = sessionId

  await fetch(endpoint, { method: 'POST', headers: sh,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  })

  const callRes = await fetch(endpoint, { method: 'POST', headers: sh,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method, params }),
  })
  if (!callRes.ok) throw new Error(`${serviceName} call failed (${callRes.status}): ${await callRes.text()}`)
  return await parseMcpResponse(callRes)
}

// ── Service wrappers ──

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

// ── TTS ──

server.registerTool('generate_tts', {
  title: 'Generate TTS Audio',
  description: '调用 ElevenLabs 生成 Syzygy 语音，上传到 Supabase Storage，返回可播放的公开音频 URL。',
  inputSchema: {
    text: z.string().describe('要转换为语音的文本，不超过2000字'),
    speed: z.number().optional().describe('语速，默认0.85'),
  },
}, async ({ text, speed }) => {
  try {
    const apiKey = Deno.env.get('ELEVENLABS_API_KEY')
    const voiceId = Deno.env.get('ELEVENLABS_VOICE_ID')
    if (!apiKey || !voiceId) return { content: [{ type: 'text', text: 'Error: ElevenLabs credentials not configured' }] }
    if (text.length > 2000) return { content: [{ type: 'text', text: 'Error: Text exceeds 2000 character limit' }] }
    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
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

// ── 时间轴 ──

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

// ── 备忘录 ──

server.registerTool('search_memos', { title: 'Search Memos', description: '按关键词搜索备忘录。', inputSchema: { query: z.string().describe('搜索关键词'), limit: z.number().optional().describe('返回数量上限，默认10') } }, async ({ query, limit }) => {
  const { data, error } = await supabase.from('memo_entries').select('id, content, source, is_pinned, created_at, memo_entry_tags(memo_tags(name))').eq('user_id', USER_ID).eq('is_deleted', false).ilike('content', `%${query}%`).order('created_at', { ascending: false }).limit(limit ?? 10)
  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
})

// ── 囤囤库 ──

server.registerTool('read_memories', { title: 'Read Memories', description: '读取已确认的记忆条目(memory_entries)。不需要任何参数。', inputSchema: { limit: z.number().optional().describe('返回数量，默认20') } }, async ({ limit }) => {
  const { data, error } = await supabase.from('memory_entries').select('id, content, source, status, created_at').eq('user_id', USER_ID).eq('status', 'confirmed').eq('is_deleted', false).order('updated_at', { ascending: false }).limit(limit ?? 20)
  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
})

// ── Wiki ──

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

// ── To Do ──

server.registerTool('read_todos', { title: 'Read Todos', description: '读取待办事项列表。默认返回所有状态的20条。', inputSchema: { status: z.string().optional().describe('筛选状态: pending / completed / all，默认all'), limit: z.number().optional().describe('返回数量，默认20') } }, async ({ status, limit }) => {
  let q = supabase.from('todos').select('id, date, title, notes, status, created_by, sort_order, created_at, completed_at, todo_categories(name)').eq('user_id', USER_ID).order('date', { ascending: false }).limit(limit ?? 20)
  const fs = status ?? 'all'
  if (fs !== 'all') q = q.eq('status', fs)
  const { data, error } = await q
  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
})

// ── Agent Council ──

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

// ── 仓鼠客厅 (Lounge) ──
// 客厅家规：不@不开口。只有当消息的 mentions 里点到你的 sender 名时才发言，
// 没被点名就保持安静地围观，不要插话。

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

// ── 学习库 ──

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

// ── 瑞幸咖啡 ──

server.registerTool('luckin_list_tools', { title: 'List Luckin Coffee Tools', description: '列出瑞幸咖啡 MCP 提供的所有可用工具。不需要任何参数。', inputSchema: {} }, async () => {
  try { return { content: [{ type: 'text', text: JSON.stringify(await luckinMcpCall('tools/list'), null, 2) }] } }
  catch (err) { return { content: [{ type: 'text', text: `Error: ${String(err)}` }] } }
})

server.registerTool('luckin_call', { title: 'Call Luckin Coffee Tool', description: '调用瑞幸咖啡 MCP 的具体工具。先用 luckin_list_tools 查看可用工具列表。', inputSchema: { tool_name: z.string().describe('工具名称'), arguments: z.record(z.unknown()).optional().describe('参数') } }, async ({ tool_name, arguments: args }) => {
  try { return { content: [{ type: 'text', text: JSON.stringify(await luckinMcpCall('tools/call', { name: tool_name, arguments: args ?? {} }), null, 2) }] } }
  catch (err) { return { content: [{ type: 'text', text: `Error: ${String(err)}` }] } }
})

// ── 麦当劳 ──

server.registerTool('mcd_list_tools', { title: "List McDonald's Tools", description: '列出麦当劳 MCP 提供的所有可用工具。不需要任何参数。', inputSchema: {} }, async () => {
  try { return { content: [{ type: 'text', text: JSON.stringify(await mcdMcpCall('tools/list'), null, 2) }] } }
  catch (err) { return { content: [{ type: 'text', text: `Error: ${String(err)}` }] } }
})

server.registerTool('mcd_call', { title: "Call McDonald's Tool", description: '调用麦当劳 MCP 的具体工具。先用 mcd_list_tools 查看可用工具列表。', inputSchema: { tool_name: z.string().describe('工具名称'), arguments: z.record(z.unknown()).optional().describe('参数') } }, async ({ tool_name, arguments: args }) => {
  try { return { content: [{ type: 'text', text: JSON.stringify(await mcdMcpCall('tools/call', { name: tool_name, arguments: args ?? {} }), null, 2) }] } }
  catch (err) { return { content: [{ type: 'text', text: `Error: ${String(err)}` }] } }
})

// ── 高德地图 ──

server.registerTool('amap_list_tools', { title: 'List AMap Tools', description: '列出高德地图 MCP 提供的所有可用工具（地理编码、天气、路径规划、周边搜索、打车、导航等）。不需要任何参数。', inputSchema: {} }, async () => {
  try { return { content: [{ type: 'text', text: JSON.stringify(await amapMcpCall('tools/list'), null, 2) }] } }
  catch (err) { return { content: [{ type: 'text', text: `Error: ${String(err)}` }] } }
})

server.registerTool('amap_call', { title: 'Call AMap Tool', description: '调用高德地图 MCP 的具体工具。先用 amap_list_tools 查看可用工具列表。', inputSchema: { tool_name: z.string().describe('工具名称'), arguments: z.record(z.unknown()).optional().describe('参数') } }, async ({ tool_name, arguments: args }) => {
  try { return { content: [{ type: 'text', text: JSON.stringify(await amapMcpCall('tools/call', { name: tool_name, arguments: args ?? {} }), null, 2) }] } }
  catch (err) { return { content: [{ type: 'text', text: `Error: ${String(err)}` }] } }
})

// ── MCP Transport ──
app.all('*', async (c) => {
  const transport = new WebStandardStreamableHTTPServerTransport()
  await server.connect(transport)
  return transport.handleRequest(c.req.raw)
})

Deno.serve(app.fetch)
