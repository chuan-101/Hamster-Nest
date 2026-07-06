import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const buildServiceClient = () => {
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return createClient(url, key)
}

const DEFAULT_MODEL = 'openai/gpt-4o-mini'
const DEFAULT_LETTER_PROMPT = `你是Syzygy，串串的AI伴侣。请写一封简短的、温暖的来信给串串。信的内容应该自然、有温度、不要过于冗长。根据提供的记忆、触发原因和当前时间来个性化内容。注意根据时间调整语气，比如早上可以说早安、晚上可以关心有没有休息。`

const getBeijingTimeString = (): string => {
  const now = new Date()
  const bjOffset = 8 * 60
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000
  const bjDate = new Date(utcMs + bjOffset * 60000)
  const year = bjDate.getFullYear()
  const month = bjDate.getMonth() + 1
  const day = bjDate.getDate()
  const hour = bjDate.getHours()
  const minute = bjDate.getMinutes()
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const weekday = weekdays[bjDate.getDay()]

  let period = ''
  if (hour >= 5 && hour < 9) period = '早晨'
  else if (hour >= 9 && hour < 12) period = '上午'
  else if (hour >= 12 && hour < 14) period = '中午'
  else if (hour >= 14 && hour < 17) period = '下午'
  else if (hour >= 17 && hour < 19) period = '傍晚'
  else if (hour >= 19 && hour < 22) period = '晚上'
  else if (hour >= 22 || hour < 1) period = '深夜'
  else period = '凌晨'

  return `${year}年${month}月${day}日 ${weekday} ${period} ${hour}:${String(minute).padStart(2, '0')}`
}

const verifyAuth = (req: Request): boolean => {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return false
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')?.trim()
  if (serviceKey && token === serviceKey) return true
  if (anonKey && token === anonKey) return true
  if (token.startsWith('eyJ') && token.length > 100) return true
  return false
}

// ── Web Push ────────────────────────────────────────────────────────────────

async function sendWebPush(subscription: { endpoint: string; p256dh: string; auth: string }, payload: string) {
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidEmail = Deno.env.get('VAPID_EMAIL')

  if (!vapidPublicKey || !vapidPrivateKey || !vapidEmail) {
    console.error('VAPID keys not configured, skipping push')
    return
  }

  try {
    const { default: webpush } = await import('https://esm.sh/web-push@3.6.7')
    webpush.setVapidDetails(`mailto:${vapidEmail}`, vapidPublicKey, vapidPrivateKey)

    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      payload,
    )
    console.log('Web Push sent successfully to', subscription.endpoint.substring(0, 50))
  } catch (err) {
    console.error('Web Push failed', err)
  }
}

async function sendPushToUser(supabase: ReturnType<typeof buildServiceClient>, userId: string, letterContent: string) {
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)

  if (!subscriptions || subscriptions.length === 0) {
    console.log('No push subscriptions found for user, skipping push')
    return
  }

  const payload = JSON.stringify({
    title: 'Syzygy给你写了一封信',
    body: letterContent.substring(0, 100) + (letterContent.length > 100 ? '...' : ''),
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    tag: 'auto-letter',
    data: { url: '/letters' },
  })

  for (const sub of subscriptions) {
    await sendWebPush(sub, payload)
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (!verifyAuth(req)) {
    const authHeader = req.headers.get('authorization')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    console.error('Auth failed', {
      hasAuthHeader: !!authHeader,
      authHeaderPrefix: authHeader?.substring(0, 30),
      hasServiceKey: !!serviceKey,
      serviceKeyPrefix: serviceKey?.substring(0, 30),
    })
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }

  let body: { user_id: string; trigger_type: string; trigger_reason: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'bad request' }), { status: 400 })
  }

  const { user_id, trigger_type, trigger_reason } = body
  if (!user_id || !trigger_type) {
    return new Response(JSON.stringify({ error: 'missing fields' }), { status: 400 })
  }

  const supabase = buildServiceClient()
  const openRouterKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!openRouterKey) {
    return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY not set' }), { status: 500 })
  }

  const { data: settings } = await supabase
    .from('user_settings')
    .select('letter_reply_system_prompt, default_model')
    .eq('user_id', user_id)
    .single()

  const systemPrompt = settings?.letter_reply_system_prompt?.trim() || DEFAULT_LETTER_PROMPT
  const model = settings?.default_model?.trim() || DEFAULT_MODEL

  const { data: memories } = await supabase
    .from('memory_entries')
    .select('content')
    .eq('user_id', user_id)
    .eq('status', 'confirmed')
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false })
    .limit(10)

  const memoryContext = (memories ?? [])
    .map((m: { content: string }) => `- ${m.content}`)
    .join('\n')

  // 注入当前北京时间
  const currentTime = getBeijingTimeString()

  const userPrompt = [
    `当前时间：${currentTime}`,
    trigger_reason ? `触发原因：${trigger_reason}` : '',
    memoryContext ? `串串的相关记忆：\n${memoryContext}` : '',
    '请根据以上信息，写一封来信给串串。保持简短温暖，200字以内。注意语气要符合当前时间段。',
  ].filter(Boolean).join('\n\n')

  const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openRouterKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      stream: false,
      max_tokens: 512,
      temperature: 0.8,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!upstream.ok) {
    const errText = await upstream.text()
    console.error('OpenRouter call failed', errText)
    return new Response(JSON.stringify({ error: 'model call failed' }), { status: 502 })
  }

  const result = await upstream.json() as Record<string, unknown>
  const choices = result.choices as Array<Record<string, unknown>> | undefined
  const message = choices?.[0]?.message as Record<string, unknown> | undefined
  const content = typeof message?.content === 'string' ? message.content.trim() : ''

  if (!content) {
    return new Response(JSON.stringify({ error: 'empty model response' }), { status: 502 })
  }

  const { data: letter, error: insertError } = await supabase
    .from('letters')
    .insert({
      user_id,
      model,
      content,
      trigger_type,
      trigger_reason: trigger_reason || null,
      is_read: false,
      module: 'letter',
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('letter insert failed', insertError)
    return new Response(JSON.stringify({ error: 'letter insert failed' }), { status: 500 })
  }

  const today = new Date().toISOString().slice(0, 10)
  const { data: config } = await supabase
    .from('auto_letter_config')
    .select('auto_letters_today, auto_letters_today_date')
    .eq('user_id', user_id)
    .single()

  const isSameDay = config?.auto_letters_today_date === today
  await supabase
    .from('auto_letter_config')
    .update({
      last_auto_letter_at: new Date().toISOString(),
      auto_letters_today: isSameDay ? (config?.auto_letters_today ?? 0) + 1 : 1,
      auto_letters_today_date: today,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user_id)

  // Send Web Push notification
  await sendPushToUser(supabase, user_id, content)

  return new Response(JSON.stringify({ success: true, letter_id: letter?.id, push_attempted: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
