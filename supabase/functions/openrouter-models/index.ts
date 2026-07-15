import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSupabaseAdminKey } from '../_shared/supabase_secret.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

type ProviderConfig = {
  id: string
  name: string | null
  base_url: string | null
  secret_name: string | null
  active?: boolean | null
}

const resolveProvider = (value: ProviderConfig | null) => {
  if (!value) {
    return null
  }
  const baseUrl = value.base_url?.trim() ?? ''
  const secretName = value.secret_name?.trim() ?? ''
  if (!baseUrl || !secretName) {
    return null
  }
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  const modelsUrl = `${normalizedBase}/models`
  const apiKey = Deno.env.get(secretName) ?? ''
  return {
    name: value.name?.trim() || 'custom',
    modelsUrl,
    apiKey,
  }
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

  let userId = ''
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
    const authData = await authResponse.json() as { id?: string }
    userId = authData.id ?? ''
  } catch {
    return new Response(JSON.stringify({ error: '身份令牌无效' }), {
      status: 401,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    })
  }

  let providerId: string | null = new URL(req.url).searchParams.get('provider_id')
  if (req.method === 'POST') {
    try {
      const payload = await req.json() as { provider_id?: string }
      providerId = typeof payload.provider_id === 'string' ? payload.provider_id : null
    } catch {
      providerId = null
    }
  }

  let providerRow: ProviderConfig | null = null
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    if (supabaseUrl && userId) {
      const admin = createClient(supabaseUrl, getSupabaseAdminKey())
      let query = admin
        .from('llm_providers')
        .select('id,name,base_url,secret_name,active')
        .eq('user_id', userId)
      if (providerId) {
        query = query.eq('id', providerId)
      } else {
        query = query.eq('active', true).order('priority', { ascending: true })
      }
      const { data } = await query.limit(1).maybeSingle<ProviderConfig>()
      providerRow = data ?? null
    }
  } catch {
    providerRow = null
  }

  const customProvider = resolveProvider(providerRow)
  const apiKey = customProvider?.apiKey || Deno.env.get('OPENROUTER_API_KEY')
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
    const modelsUrl = customProvider?.modelsUrl ?? 'https://openrouter.ai/api/v1/models'
    const upstream = await fetch(modelsUrl, {
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
