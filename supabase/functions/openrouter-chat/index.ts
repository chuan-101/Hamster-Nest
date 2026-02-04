import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'

type OpenAiMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

type OpenRouterPayload = {
  messages: OpenAiMessage[]
  model: string
  temperature?: number
  top_p?: number
  max_tokens?: number
  reasoning?: boolean
  stream?: boolean
}

const allowedOrigins = ['https://chuan-101.github.io', /^http:\/\/localhost:\d+$/]

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

serve(async (req) => {
  const origin = req.headers.get('origin')
  if (!isAllowedOrigin(origin)) {
    return new Response(JSON.stringify({ error: '不允许的来源' }), {
      status: 403,
      headers: {
        ...buildCorsHeaders(origin),
        'Content-Type': 'application/json',
      },
    })
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(origin),
    })
  }

  const authHeader = req.headers.get('authorization')
  const apiKeyHeader = req.headers.get('apikey')
  if (!authHeader || !apiKeyHeader) {
    return new Response(JSON.stringify({ error: '缺少身份令牌' }), {
      status: 401,
      headers: {
        ...buildCorsHeaders(origin),
        'Content-Type': 'application/json',
      },
    })
  }

  try {
    const authUrl = new URL('/auth/v1/user', new URL(req.url).origin)
    const authResponse = await fetch(authUrl, {
      headers: {
        apikey: apiKeyHeader,
        Authorization: authHeader,
      },
    })
    if (!authResponse.ok) {
      return new Response(JSON.stringify({ error: '身份令牌无效' }), {
        status: 401,
        headers: {
          ...buildCorsHeaders(origin),
          'Content-Type': 'application/json',
        },
      })
    }
  } catch {
    return new Response(JSON.stringify({ error: '身份令牌无效' }), {
      status: 401,
      headers: {
        ...buildCorsHeaders(origin),
        'Content-Type': 'application/json',
      },
    })
  }

  let payload: OpenRouterPayload
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: '请求体格式错误' }), {
      status: 400,
      headers: {
        ...buildCorsHeaders(origin),
        'Content-Type': 'application/json',
      },
    })
  }

  const apiKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!apiKey) {
    return new Response(JSON.stringify({ error: '服务未配置' }), {
      status: 500,
      headers: {
        ...buildCorsHeaders(origin),
        'Content-Type': 'application/json',
      },
    })
  }

  const { messages, model, temperature, top_p, max_tokens, reasoning } = payload
  const stream = payload.stream ?? true

  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        top_p,
        max_tokens,
        ...(reasoning ? { reasoning: { effort: 'medium' } } : {}),
        stream,
      }),
    })

    if (!upstream.ok) {
      const errorText = await upstream.text()
      return new Response(JSON.stringify({ error: errorText || '上游服务错误' }), {
        status: upstream.status,
        headers: {
          ...buildCorsHeaders(origin),
          'Content-Type': 'application/json',
        },
      })
    }

    if (stream) {
      if (!upstream.body) {
        return new Response(JSON.stringify({ error: '无响应内容' }), {
          status: 502,
          headers: {
            ...buildCorsHeaders(origin),
            'Content-Type': 'application/json',
          },
        })
      }

      return new Response(upstream.body, {
        status: 200,
        headers: {
          ...buildCorsHeaders(origin),
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      })
    }

    const payloadText = await upstream.text()
    return new Response(payloadText, {
      status: 200,
      headers: {
        ...buildCorsHeaders(origin),
        'Content-Type': 'application/json',
      },
    })
  } catch {
    return new Response(JSON.stringify({ error: '请求失败' }), {
      status: 500,
      headers: {
        ...buildCorsHeaders(origin),
        'Content-Type': 'application/json',
      },
    })
  }
})
