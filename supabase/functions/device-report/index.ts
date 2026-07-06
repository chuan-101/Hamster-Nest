// Device status reporting endpoint (P0 · 0-2).
//
// Replaces the anon-key INSERT path into device_status: the iOS Shortcut
// (and any other reporter) calls this function with a shared secret in the
// X-Device-Secret header instead of writing the table directly. Once the
// Shortcut is switched over, the `Allow insert for anon` policy on
// device_status can be dropped.
//
// Requires the DEVICE_REPORT_SECRET function secret to be set; fails closed
// (401) when it is missing.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifySharedSecret } from '../_shared/auth.ts'

const USER_ID = '94dd24be-e136-45bb-836b-6820c09c4292'

type DeviceReport = {
  battery_level?: number
  is_charging?: boolean
  latitude?: number
  longitude?: number
  weather?: string
  steps?: number
  device_name?: string
}

const clampNumber = (value: unknown, min: number, max: number): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(Math.max(value, min), max)
}

const clampString = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, maxLength)
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 })
  }

  if (!verifySharedSecret(req, 'x-device-secret', 'DEVICE_REPORT_SECRET')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }

  let body: DeviceReport
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'bad request' }), { status: 400 })
  }

  const row: Record<string, unknown> = { user_id: USER_ID }
  const batteryLevel = clampNumber(body.battery_level, 0, 100)
  if (batteryLevel !== undefined) row.battery_level = Math.round(batteryLevel)
  if (typeof body.is_charging === 'boolean') row.is_charging = body.is_charging
  const latitude = clampNumber(body.latitude, -90, 90)
  if (latitude !== undefined) row.latitude = latitude
  const longitude = clampNumber(body.longitude, -180, 180)
  if (longitude !== undefined) row.longitude = longitude
  const steps = clampNumber(body.steps, 0, 500000)
  if (steps !== undefined) row.steps = Math.round(steps)
  const weather = clampString(body.weather, 200)
  if (weather !== undefined) row.weather = weather
  const deviceName = clampString(body.device_name, 100)
  if (deviceName !== undefined) row.device_name = deviceName

  if (Object.keys(row).length === 1) {
    return new Response(JSON.stringify({ error: 'no reportable fields' }), { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { error } = await supabase.from('device_status').insert(row)
  if (error) {
    console.error('device_status insert failed', error.message)
    return new Response(JSON.stringify({ error: 'insert failed' }), { status: 500 })
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
