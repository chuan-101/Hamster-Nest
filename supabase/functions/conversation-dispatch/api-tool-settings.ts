import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdminKey } from '../_shared/supabase_secret.ts'
import { apiToolCatalogForVersion, mergeApiToolSelection } from './api-tool-contract.ts'

export async function handleApiToolSettings(
  body: Record<string, unknown>,
  userId: string,
  url: string,
  authorization: string,
  apiKey: string,
  cors: Record<string, string>,
) {
  const respond = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  const client = createClient(url, apiKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const admin = createClient(url, getSupabaseAdminKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  try {
    const sessionId = body.session_id
    if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/iu.test(sessionId)) {
      return respond({ error: '会话无效' }, 400)
    }
    const session = await client.from('sessions').select('id,handler,conversation_kind').eq(
      'id',
      sessionId,
    )
      .eq('user_id', userId).maybeSingle()
    if (session.error) throw session.error
    if (
      !session.data || session.data.handler !== 'api' || session.data.conversation_kind !== 'direct'
    ) return respond({ error: '仅 API 私聊可设置工具' }, 403)
    const catalog = apiToolCatalogForVersion(body.catalog_version)
    if (body.enabled_tools !== undefined) {
      const current = await client.from('api_conversation_tools').select('enabled_tools')
        .eq('session_id', sessionId).maybeSingle()
      if (current.error) throw current.error
      const selected = mergeApiToolSelection(
        body.enabled_tools, current.data?.enabled_tools ?? [], body.catalog_version,
      )
      const saved = await admin.from('api_conversation_tools').upsert({
        session_id: sessionId,
        user_id: userId,
        enabled_tools: selected,
        updated_at: new Date().toISOString(),
      })
      if (saved.error) throw saved.error
    }
    const [settings, usage] = await Promise.all([
      client.from('api_conversation_tools').select('enabled_tools,updated_at').eq(
        'session_id',
        sessionId,
      ).maybeSingle(),
      client.rpc('api_conversation_usage', { p_session: sessionId }),
    ])
    if (settings.error || usage.error) throw settings.error ?? usage.error
    return respond({
      catalog,
      enabled_tools: (settings.data?.enabled_tools ?? []).filter((id: string) =>
        catalog.some((tool) => tool.id === id)
      ),
      usage: usage.data,
      updated_at: settings.data?.updated_at ?? null,
    })
  } catch (error) {
    console.error('[api-tools] settings failed', error)
    return respond({
      error: error instanceof Error && error.message.startsWith('工具选择')
        ? error.message
        : '工具设置或费用暂时未读到，请重试',
    }, 400)
  }
}
