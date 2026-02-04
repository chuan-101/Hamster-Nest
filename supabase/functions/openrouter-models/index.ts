import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    })
  }

  const authHeader = req.headers.get('authorization')
  const apiKeyHeader = req.headers.get('apikey')
  if (!authHeader || !apiKeyHeader) {
    return new Response(JSON.stringify({ error: '缺少身份令牌' }), {
      status: 401,
      headers: {
        ...corsHeaders,
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
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      })
    }
  } catch {
    return new Response(JSON.stringify({ error: '身份令牌无效' }), {
      status: 401,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    })
  }

  const apiKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!apiKey) {
    return new Response(JSON.stringify({ error: '服务未配置' }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    })
  }

  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!upstream.ok) {
      const errorText = await upstream.text()
      return new Response(JSON.stringify({ error: errorText || '上游服务错误' }), {
        status: upstream.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      })
    }

    const payload = await upstream.json()
    const models = Array.isArray(payload?.data)
      ? payload.data.map((model: { id: string; name?: string; context_length?: number }) => ({
          id: model.id,
          name: model.name,
          context_length: model.context_length ?? null,
        }))
      : []

    return new Response(JSON.stringify({ models }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    })
  } catch {
    return new Response(JSON.stringify({ error: '请求失败' }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    })
  }
})
