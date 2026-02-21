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
const CLUSTER_SIMILARITY_THRESHOLD = 0.75
const EXISTING_DEDUPE_THRESHOLD = 0.85
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

const normalizeForComparison = (value: string) =>
  normalizeContent(value).toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '')

const buildBigrams = (value: string) => {
  if (value.length < 2) {
    return value ? [value] : []
  }

  const bigrams: string[] = []
  for (let index = 0; index < value.length - 1; index += 1) {
    bigrams.push(value.slice(index, index + 2))
  }
  return bigrams
}

const tokenizeForSimilarity = (value: string): Set<string> => {
  const compact = normalizeForComparison(value)
  if (!compact) {
    return new Set()
  }

  const hasCjk = /[\u3400-\u9FFF]/u.test(compact)
  if (hasCjk) {
    return new Set(buildBigrams(compact))
  }

  const normalized = normalizeContent(value).toLowerCase()
  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.replace(/[\p{P}\p{S}]+/gu, ''))
    .filter((token) => token.length > 0)

  if (tokens.length === 0) {
    return new Set(buildBigrams(compact))
  }

  return new Set(tokens)
}

const calculateJaccardSimilarity = (left: Set<string>, right: Set<string>) => {
  if (left.size === 0 || right.size === 0) {
    return 0
  }

  let intersection = 0
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1
    }
  }

  const union = left.size + right.size - intersection
  return union === 0 ? 0 : intersection / union
}

const pickShortestRepresentative = (items: string[]) =>
  [...items].sort((left, right) => {
    if (left.length === right.length) {
      return left.localeCompare(right)
    }
    return left.length - right.length
  })[0]

const clusterItems = (items: string[]) => {
  const clusters: Array<{ members: string[]; tokenSets: Set<string>[] }> = []

  for (const item of items) {
    const tokens = tokenizeForSimilarity(item)
    let matchedIndex = -1

    for (let index = 0; index < clusters.length; index += 1) {
      const cluster = clusters[index]
      const isSimilar = cluster.tokenSets.some(
        (existingTokens) => calculateJaccardSimilarity(tokens, existingTokens) >= CLUSTER_SIMILARITY_THRESHOLD,
      )
      if (isSimilar) {
        matchedIndex = index
        break
      }
    }

    if (matchedIndex >= 0) {
      clusters[matchedIndex].members.push(item)
      clusters[matchedIndex].tokenSets.push(tokens)
    } else {
      clusters.push({ members: [item], tokenSets: [tokens] })
    }
  }

  return clusters.map((cluster) => pickShortestRepresentative(cluster.members))
}

const isSimilarToAny = (
  candidateTokens: Set<string>,
  targets: Set<string>[],
  threshold: number,
): boolean => targets.some((tokens) => calculateJaccardSimilarity(candidateTokens, tokens) > threshold)

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
      .in('status', ['pending', 'confirmed'])

    if (existingError) {
      return jsonResponse({ error: '读取已有记忆失败' }, 500)
    }

    const clusteredItems = clusterItems(extracted)
    const existingTokenSets = (existingRows ?? [])
      .map((row) => (typeof row.content === 'string' ? tokenizeForSimilarity(row.content) : new Set<string>()))
      .filter((tokens) => tokens.size > 0)

    const acceptedItems: string[] = []
    const acceptedTokenSets: Set<string>[] = []
    const seenNormalized = new Set<string>()
    let skipped = 0

    for (const item of clusteredItems) {
      if (acceptedItems.length >= MAX_INSERT_COUNT) {
        break
      }

      const normalized = normalizeContent(item)
      if (normalized.length < MIN_MEMORY_LENGTH) {
        skipped += 1
        continue
      }

      const normalizedKey = normalizeForComparison(normalized)
      if (!normalizedKey || seenNormalized.has(normalizedKey)) {
        skipped += 1
        continue
      }

      const candidateTokens = tokenizeForSimilarity(normalized)
      if (candidateTokens.size === 0) {
        skipped += 1
        continue
      }

      if (isSimilarToAny(candidateTokens, existingTokenSets, EXISTING_DEDUPE_THRESHOLD)) {
        skipped += 1
        continue
      }

      if (isSimilarToAny(candidateTokens, acceptedTokenSets, EXISTING_DEDUPE_THRESHOLD)) {
        skipped += 1
        continue
      }

      seenNormalized.add(normalizedKey)
      acceptedTokenSets.push(candidateTokens)
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
