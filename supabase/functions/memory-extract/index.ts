import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

type MessageInput = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

type RequestPayload = {
  recentMessages?: MessageInput[]
}

type UserSettingsRow = {
  memory_extract_model: string | null
  default_model: string | null
}

const SERVER_RECENT_LIMIT = 30
const MIN_MEMORY_LENGTH = 8
const MAX_INSERT_COUNT = 10
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://chuan-101.github.io',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
}

const EXTRACTION_PROMPT = `You extract long-term memory suggestions from a chat.
Return ONLY valid JSON (no markdown): {"items":["...", "..."]}

Rules:
- Keep only: stable preferences/habits, project progress or technical decisions, important facts, repeated points.
- Exclude: small talk, temporary chatter, one-off emotional fluctuations.
- Each item must be concise and 1-2 sentences.`

const jsonResponse = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })

const normalizeContent = (value: string) => value.trim().replace(/\s+/g, ' ')

const parseItems = (output: string): string[] => {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start < 0 || end < start) {
    return []
  }

  try {
    const parsed = JSON.parse(output.slice(start, end + 1)) as { items?: unknown }
    if (!Array.isArray(parsed.items)) {
      return []
    }
    return parsed.items
      .map((item) => (typeof item === 'string' ? normalizeContent(item) : ''))
      .filter((item) => item.length >= MIN_MEMORY_LENGTH)
  } catch {
    return []
  }
}

serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!supabaseUrl || !anonKey) {
      return jsonResponse({ error: 'Supabase 环境变量未配置' }, 500)
    }

    const authHeader = req.headers.get('authorization')
    const apikey = req.headers.get('apikey')
    if (!authHeader || !apikey) {
      return jsonResponse({ error: '缺少身份令牌' }, 401)
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader,
          apikey,
        },
      },
    })

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user) {
      return jsonResponse({ error: '身份令牌无效' }, 401)
    }

    let payload: RequestPayload
    try {
      payload = await req.json()
    } catch {
      return jsonResponse({ error: '请求体格式错误' }, 400)
    }

    const recentMessages = (payload.recentMessages ?? [])
      .slice(-SERVER_RECENT_LIMIT)
      .map((message) => ({
        role: message.role,
        content: normalizeContent(message.content ?? ''),
      }))
      .filter((message) => message.content.length > 0)

    if (recentMessages.length === 0) {
      return jsonResponse({ inserted: 0, skipped: 0, items: [] })
    }

    const { data: settings, error: settingsError } = await supabase
      .from('user_settings')
      .select('memory_extract_model, default_model')
      .eq('user_id', user.id)
      .maybeSingle<UserSettingsRow>()

    if (settingsError) {
      return jsonResponse({ error: '读取用户设置失败' }, 500)
    }

    const modelId = settings?.memory_extract_model?.trim() || settings?.default_model?.trim() || ''
    if (!modelId) {
      return jsonResponse({ error: '请先在设置中配置默认模型或抽取模型' }, 400)
    }

    const openRouterApiKey = Deno.env.get('OPENROUTER_API_KEY')
    if (!openRouterApiKey) {
      return jsonResponse({ error: '服务未配置 OPENROUTER_API_KEY' }, 500)
    }

    const conversation = recentMessages
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n')

    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        temperature: 0.2,
        max_tokens: 700,
        stream: false,
        messages: [
          { role: 'system', content: EXTRACTION_PROMPT },
          { role: 'user', content: `Conversation:\n${conversation}` },
        ],
      }),
    })

    if (!upstream.ok) {
      const errorText = await upstream.text()
      return jsonResponse({ error: errorText || '抽取模型调用失败' }, upstream.status)
    }

    const completion = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const rawOutput = completion.choices?.[0]?.message?.content ?? ''
    const extracted = parseItems(rawOutput)

    const { data: existingRows, error: existingError } = await supabase
      .from('memory_entries')
      .select('content')
      .eq('user_id', user.id)
      .eq('is_deleted', false)

    if (existingError) {
      return jsonResponse({ error: '读取已有记忆失败' }, 500)
    }

    const seen = new Set(
      (existingRows ?? [])
        .map((row) => (typeof row.content === 'string' ? normalizeContent(row.content).toLowerCase() : ''))
        .filter((value) => value.length > 0),
    )

    const acceptedItems: string[] = []
    let skipped = 0

    for (const item of extracted) {
      if (acceptedItems.length >= MAX_INSERT_COUNT) {
        break
      }

      const normalized = normalizeContent(item)
      if (normalized.length < MIN_MEMORY_LENGTH) {
        skipped += 1
        continue
      }

      const key = normalized.toLowerCase()
      if (seen.has(key)) {
        skipped += 1
        continue
      }

      seen.add(key)
      acceptedItems.push(normalized)
    }

    if (acceptedItems.length > 0) {
      const { error: insertError } = await supabase.from('memory_entries').insert(
        acceptedItems.map((content) => ({
          user_id: user.id,
          content,
          source: 'ai_suggested',
          status: 'pending',
        })),
      )

      if (insertError) {
        return jsonResponse({ error: '写入记忆失败' }, 500)
      }
    }

    return jsonResponse({
      inserted: acceptedItems.length,
      skipped,
      items: acceptedItems,
    })
  } catch {
    return jsonResponse({ error: '服务内部错误' }, 500)
  }
})
