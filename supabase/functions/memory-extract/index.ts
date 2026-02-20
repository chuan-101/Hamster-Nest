import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'

type MessageInput = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

type RequestPayload = {
  recentMessages?: MessageInput[]
  timezone?: string
}

type AuthUserResponse = {
  id: string
}

type UserSettingsRow = {
  memory_extract_model?: string | null
  default_model?: string | null
}

const allowedOrigins = ['https://chuan-101.github.io', /^http:\/\/localhost:\d+$/]
const MIN_MEMORY_LENGTH = 8
const MAX_INSERT_COUNT = 10

const EXTRACTION_PROMPT = `You are a memory extraction assistant.
Task: extract candidate long-term memories from the provided recent conversation.
Only extract:
1) stable user preferences/habits
2) project progress & technical decisions/changes
3) important factual info
4) repeatedly emphasized items
Exclude:
- casual small talk
- temporary ideas
- emotional fluctuations unless repeatedly emphasized
Output format MUST be valid JSON:
{"items": ["...", "..."]}
Each item must be concise, 1-2 sentences, with no numbering prefixes or commentary.`

const isAllowedOrigin = (origin: string | null) => {
  if (!origin) {
    return true
  }
  return allowedOrigins.some((pattern) =>
    typeof pattern === 'string' ? pattern === origin : pattern.test(origin),
  )
}

const buildCorsHeaders = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin ?? '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
})

const jsonResponse = (origin: string | null, payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...buildCorsHeaders(origin),
      'Content-Type': 'application/json',
    },
  })

const normalizeContent = (value: string) => value.trim().replace(/\s+/g, ' ')

const parseItems = (content: string): string[] => {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start < 0 || end < start) {
    return []
  }
  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as { items?: unknown }
    if (!Array.isArray(parsed.items)) {
      return []
    }
    return parsed.items
      .map((item) => {
        if (typeof item === 'string') {
          return normalizeContent(item)
        }
        if (item && typeof item === 'object' && 'content' in item) {
          const value = (item as { content?: unknown }).content
          return typeof value === 'string' ? normalizeContent(value) : ''
        }
        return ''
      })
      .filter((item) => item.length >= MIN_MEMORY_LENGTH)
  } catch {
    return []
  }
}

serve(async (req) => {
  const origin = req.headers.get('origin')
  if (!isAllowedOrigin(origin)) {
    return jsonResponse(origin, { error: '不允许的来源' }, 403)
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: buildCorsHeaders(origin) })
  }

  const authHeader = req.headers.get('authorization')
  const apiKeyHeader = req.headers.get('apikey')
  if (!authHeader || !apiKeyHeader) {
    return jsonResponse(origin, { error: '缺少身份令牌' }, 401)
  }

  const baseOrigin = new URL(req.url).origin
  let userId: string
  try {
    const authUrl = new URL('/auth/v1/user', baseOrigin)
    const authResponse = await fetch(authUrl, {
      headers: { apikey: apiKeyHeader, Authorization: authHeader },
    })
    if (!authResponse.ok) {
      return jsonResponse(origin, { error: '身份令牌无效' }, 401)
    }
    const authData = (await authResponse.json()) as AuthUserResponse
    userId = authData.id
  } catch {
    return jsonResponse(origin, { error: '身份令牌无效' }, 401)
  }

  let payload: RequestPayload
  try {
    payload = await req.json()
  } catch {
    return jsonResponse(origin, { error: '请求体格式错误' }, 400)
  }

  const apiKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!apiKey) {
    return jsonResponse(origin, { error: '服务未配置' }, 500)
  }

  const recentMessages = (payload.recentMessages ?? [])
    .map((message) => ({ role: message.role, content: normalizeContent(message.content ?? '') }))
    .filter((message) => message.content.length > 0)
  if (recentMessages.length === 0) {
    return jsonResponse(origin, { insertedCount: 0, skippedCount: 0 })
  }

  const settingsQuery = new URLSearchParams({
    select: 'memory_extract_model,default_model',
    user_id: `eq.${userId}`,
    limit: '1',
  })
  const settingsResponse = await fetch(`${baseOrigin}/rest/v1/user_settings?${settingsQuery.toString()}`, {
    headers: { apikey: apiKeyHeader, Authorization: authHeader },
  })
  if (!settingsResponse.ok) {
    return jsonResponse(origin, { error: '读取用户设置失败' }, 500)
  }
  const settingsRows = (await settingsResponse.json()) as UserSettingsRow[]
  const settings = settingsRows[0] ?? {}
  const extractorModel =
    settings.memory_extract_model?.trim() || settings.default_model?.trim() || 'openrouter/auto'

  const conversationBlock = recentMessages
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join('\n')

  const modelResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: extractorModel,
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        {
          role: 'user',
          content: `timezone=${payload.timezone ?? 'unknown'}\nconversation:\n${conversationBlock}`,
        },
      ],
      stream: false,
    }),
  })

  if (!modelResponse.ok) {
    const errorText = await modelResponse.text()
    return jsonResponse(origin, { error: errorText || '抽取模型调用失败' }, modelResponse.status)
  }

  const modelData = (await modelResponse.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const outputText = modelData.choices?.[0]?.message?.content ?? ''
  const extractedItems = parseItems(outputText)

  if (extractedItems.length === 0) {
    return jsonResponse(origin, { insertedCount: 0, skippedCount: 0 })
  }

  const existingQuery = new URLSearchParams({
    select: 'content',
    user_id: `eq.${userId}`,
    is_deleted: 'eq.false',
    limit: '5000',
  })
  const existingResponse = await fetch(`${baseOrigin}/rest/v1/memory_entries?${existingQuery.toString()}`, {
    headers: { apikey: apiKeyHeader, Authorization: authHeader },
  })
  if (!existingResponse.ok) {
    return jsonResponse(origin, { error: '读取已有记忆失败' }, 500)
  }
  const existingRows = (await existingResponse.json()) as Array<{ content?: unknown }>
  const knownContent = new Set(
    existingRows
      .map((row) => (typeof row.content === 'string' ? normalizeContent(row.content).toLowerCase() : ''))
      .filter((item) => item.length > 0),
  )

  const inserts: Array<{ user_id: string; content: string; source: string; status: string }> = []
  let skippedCount = 0
  for (const candidate of extractedItems) {
    if (inserts.length >= MAX_INSERT_COUNT) {
      break
    }
    const normalized = normalizeContent(candidate)
    if (normalized.length < MIN_MEMORY_LENGTH) {
      skippedCount += 1
      continue
    }
    const key = normalized.toLowerCase()
    if (knownContent.has(key)) {
      skippedCount += 1
      continue
    }
    knownContent.add(key)
    inserts.push({
      user_id: userId,
      content: normalized,
      source: 'ai_suggested',
      status: 'pending',
    })
  }

  if (inserts.length > 0) {
    const insertResponse = await fetch(`${baseOrigin}/rest/v1/memory_entries`, {
      method: 'POST',
      headers: {
        apikey: apiKeyHeader,
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(inserts),
    })
    if (!insertResponse.ok) {
      const errorText = await insertResponse.text()
      return jsonResponse(origin, { error: errorText || '写入记忆失败' }, 500)
    }
  }

  return jsonResponse(origin, {
    insertedCount: inserts.length,
    skippedCount,
    model: extractorModel,
  })
})
