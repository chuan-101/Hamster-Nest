import { createClient } from 'jsr:@supabase/supabase-js@2'
import { requireUuidEnv } from './owner.ts'

// All About Book 独立 Supabase 实例（AAB_*）的跨项目访问：
// service role 直连，工具内一律用 AAB_USER_ID 圈定数据归属。
export const AAB_USER_ID = requireUuidEnv('AAB_USER_ID')

let aabClient: ReturnType<typeof createClient> | null = null

export function getAabClient() {
  if (aabClient) return aabClient
  const url = Deno.env.get('AAB_SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('AAB_SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) {
    throw new Error('AAB_SUPABASE_URL or AAB_SUPABASE_SERVICE_ROLE_KEY not configured')
  }
  aabClient = createClient(url, serviceRoleKey)
  return aabClient
}
