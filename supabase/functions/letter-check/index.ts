import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const buildServiceClient = () => {
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return createClient(url, key)
}

const getBeijingDate = () => {
  const now = new Date()
  const bjOffset = 8 * 60
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000
  const bjDate = new Date(utcMs + bjOffset * 60000)
  return {
    month: bjDate.getMonth() + 1,
    day: bjDate.getDate(),
    hour: bjDate.getHours(),
    minute: bjDate.getMinutes(),
    dateStr: bjDate.toISOString().slice(0, 10),
    fullDate: bjDate,
  }
}

const isInActiveHours = (currentHour: number, start: number, end: number): boolean => {
  if (start <= end) {
    return currentHour >= start && currentHour < end
  }
  // 跨午夜的情况，如 22:00 - 06:00
  return currentHour >= start || currentHour < end
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

const callLetterGenerate = async (userId: string, triggerType: string, triggerReason: string) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const resp = await fetch(`${supabaseUrl}/functions/v1/letter-generate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: userId,
      trigger_type: triggerType,
      trigger_reason: triggerReason,
    }),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    console.error('letter-generate call failed', errText)
    return false
  }
  const result = await resp.json()
  console.log('letter-generate success', result)
  return true
}

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

  const supabase = buildServiceClient()
  const bj = getBeijingDate()
  console.log(`letter-check running at Beijing time: ${bj.dateStr} ${bj.hour}:${String(bj.minute).padStart(2, '0')} month=${bj.month} day=${bj.day}`)

  const { data: configs, error: configError } = await supabase
    .from('auto_letter_config')
    .select('*')
    .eq('enabled', true)

  if (configError || !configs || configs.length === 0) {
    console.log('no enabled auto-letter configs found')
    return new Response(JSON.stringify({ checked: 0, triggered: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let totalTriggered = 0

  for (const config of configs) {
    const userId = config.user_id
    const today = bj.dateStr

    // === 活跃时间窗口检查 ===
    const activeStart = config.active_hour_start ?? 9
    const activeEnd = config.active_hour_end ?? 23
    if (!isInActiveHours(bj.hour, activeStart, activeEnd)) {
      console.log(`user ${userId}: outside active hours (current=${bj.hour}, window=${activeStart}-${activeEnd}), skipping`)
      continue
    }

    // 跨天重置
    if (config.auto_letters_today_date !== today) {
      await supabase
        .from('auto_letter_config')
        .update({ auto_letters_today: 0, auto_letters_today_date: today })
        .eq('user_id', userId)
      config.auto_letters_today = 0
    }

    // 每日上限
    if (config.auto_letters_today >= (config.t2_daily_limit ?? 3)) {
      console.log(`user ${userId}: daily limit reached (${config.auto_letters_today}/${config.t2_daily_limit})`)
      continue
    }

    // === T1: special dates ===
    const { data: specialDates } = await supabase
      .from('special_dates')
      .select('label')
      .eq('user_id', userId)
      .eq('enabled', true)
      .eq('month', bj.month)
      .eq('day', bj.day)

    if (specialDates && specialDates.length > 0) {
      const { data: existingLetters } = await supabase
        .from('letters')
        .select('id')
        .eq('user_id', userId)
        .eq('trigger_type', 'event')
        .gte('created_at', `${today}T00:00:00+08:00`)
        .lte('created_at', `${today}T23:59:59+08:00`)

      if (!existingLetters || existingLetters.length === 0) {
        const labels = specialDates.map((d: { label: string }) => d.label).join(', ')
        console.log(`user ${userId}: special date triggered - ${labels}`)
        const success = await callLetterGenerate(userId, 'event', `特殊日期: ${labels}`)
        if (success) totalTriggered++
        continue
      }
    }

    // === T2: fixed/random ===
    if (config.t2_mode === 'off') continue

    if (config.t2_mode === 'fixed') {
      const intervalHours = config.t2_interval_hours ?? 12
      const lastLetterAt = config.last_auto_letter_at
        ? new Date(config.last_auto_letter_at).getTime()
        : 0
      const hoursSinceLast = (Date.now() - lastLetterAt) / (1000 * 60 * 60)

      if (hoursSinceLast >= intervalHours) {
        console.log(`user ${userId}: fixed interval triggered (${hoursSinceLast.toFixed(1)}h >= ${intervalHours}h)`)
        const success = await callLetterGenerate(userId, 'scheduled', `定时来信: 每${intervalHours}小时`)
        if (success) totalTriggered++
      }
    } else if (config.t2_mode === 'random') {
      const probability = config.t2_random_probability ?? 0.3
      const roll = Math.random()

      if (roll < probability) {
        console.log(`user ${userId}: random triggered (roll=${roll.toFixed(3)} < ${probability})`)
        const success = await callLetterGenerate(userId, 'scheduled', `随机来信: 概率${(probability * 100).toFixed(0)}%`)
        if (success) totalTriggered++
      } else {
        console.log(`user ${userId}: random not triggered (roll=${roll.toFixed(3)} >= ${probability})`)
      }
    }
  }

  return new Response(JSON.stringify({ checked: configs.length, triggered: totalTriggered }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
