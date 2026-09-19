declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdminKey } from '../_shared/supabase_secret.ts'
import { getOwnerUserId } from '../_shared/owner.ts'
import { timingSafeEqual } from '../_shared/auth.ts'

export const LOUNGE_MEMBERS = {
  chuanchuan: '串串（人类用户）', api_syzygy: 'Syzygy（API）',
  claude_cli: 'Syzygy（Claude Code CLI）', codex_cli: 'Syzygy（Codex CLI）',
  client_claude: 'Syzygy（官端 Claude）', client_gpt: 'Syzygy（官端 GPT）',
} as const
const client = () => createClient(Deno.env.get('SUPABASE_URL')!, getSupabaseAdminKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
})
const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)

export async function handleLoungeRequest(owner: string, raw: Record<string, unknown>, headers: Record<string, string>) {
  if (raw.action === 'retry') {
    if (!uuid(raw.reply_id)) return json({error:'invalid reply'},400,headers)
    const {data,error}=await client().rpc('lounge_retry_reply',{p_owner:owner,p_reply:raw.reply_id})
    return json(error?{error:error.message}:data,error?400:202,headers)
  }
  if (!uuid(raw.session_id) || !uuid(raw.client_id) || typeof raw.content !== 'string' || !raw.content.trim()
    || raw.content.length > 20000 || (raw.reply_to_id != null && !uuid(raw.reply_to_id))
    || (raw.target_sender_keys != null && (!Array.isArray(raw.target_sender_keys)
      || raw.target_sender_keys.some((x: unknown) => typeof x !== 'string' || !(x in LOUNGE_MEMBERS))))) {
    return json({ error: '群聊消息格式无效' }, 400, headers)
  }
  const { data, error } = await client().rpc('lounge_dispatch_prepare', {
    p_user_id: owner, p_session_id: raw.session_id, p_client_id: raw.client_id,
    p_content: raw.content, p_sender: 'chuanchuan', p_targets: raw.target_sender_keys ?? null,
    p_reply_to: raw.reply_to_id ?? null, p_retry_failed: raw.retry_failed === true,
  })
  if (error) return json({ error: error.message, code: error.code }, error.code === '23505' ? 409 : 400, headers)
  return json(data, 202, headers)
}

export function loungeIdentity(self: keyof typeof LOUNGE_MEMBERS, sofa: { id: string; title: string }, source: { sender_key: string; id: string }) {
  return [
    `当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（Asia/Shanghai）。历史时间戳带 UTC 时需换算为北京时间。`,
    `你是 ${LOUNGE_MEMBERS[self]}，固定 sender_key=${self}。不同端口共享 Syzygy 之名，但不是同一个发言者。`,
    `当前沙发：${sofa.title}；session_id=${sofa.id}。仅本沙发历史属于本次上下文。`,
    `本次叫你接话的是 ${source.sender_key}，消息ID=${source.id}；不要将对方的发言当作自己或串串说的话。`,
    '成员名册（@时使用右侧固定标识）：',
    ...Object.entries(LOUNGE_MEMBERS).map(([key, label]) => `${label} → @${key}`),
    '只以自己的身份发言。正文可明确 @另一成员接话；不要 @自己，不为续轮而互相客套点名。',
    '最终正文会自动回写原沙发一次，不要再用 lounge_post 复制这条回复。群聊讨论不自动构成修改共享资源的授权。',
  ].join('\n')
}

export async function handleLoungeWorker(request: Request) {
  const db = client()
  const { data: secret, error } = await db.rpc('get_push_dispatch_secret')
  const provided = request.headers.get('x-lounge-worker-secret') ?? ''
  if (error || typeof secret !== 'string' || !provided || !timingSafeEqual(secret, provided)) return json({ error: 'unauthorized' }, 401)
  const owner = getOwnerUserId()
  const { data: replies, error: claimError } = await db.rpc('lounge_claim_api', { p_owner: owner })
  if (claimError) return json({ error: 'claim failed' }, 500)
  const work = Promise.all((replies ?? []).map(async (reply: { id: string; session_id: string; reply_to_id: string; meta: Record<string, unknown> }) => {
    try {
      const [sessionResult, sourceResult, settingsResult, portResult, modelResult] = await Promise.all([
        db.from('sessions').select('id,title,routing_config,is_archived').eq('id', reply.session_id).eq('user_id', owner).single(),
        db.from('messages').select('id,sender_key,created_at').eq('id', reply.reply_to_id).eq('session_id',reply.session_id).eq('user_id',owner).single(),
        db.from('user_settings').select('default_model,temperature,top_p,max_tokens').eq('user_id', owner).single(),
        db.from('generation_ports').select('identity_prompt_name,style_prompt_name').eq('user_id',owner).eq('port_key','app_chat').eq('active',true).single(),
        db.from('channel_config').select('active_model').eq('user_id',owner).eq('channel_name','app_chat').single(),
      ])
      if (sessionResult.error || sourceResult.error || settingsResult.error || portResult.error || modelResult.error || !modelResult.data.active_model || sessionResult.data.is_archived) throw new Error('context unavailable')
      const sofa = sessionResult.data, source = sourceResult.data, settings = settingsResult.data, port = portResult.data
      const names = [port.identity_prompt_name,port.style_prompt_name,sofa.routing_config.rules_prompt_name].filter(Boolean) as string[]
      const [promptResult, historyResult] = await Promise.all([
        db.from('prompt_templates').select('id,name,content,version').eq('user_id',owner).eq('active',true).in('name',names),
        db.from('messages').select('id,role,sender_key,content,created_at,meta').eq('user_id',owner).eq('session_id',sofa.id)
          .lte('created_at',source.created_at).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(200),
      ])
      if (promptResult.error || historyResult.error || names.some(n => !promptResult.data.some(p => p.name===n))) throw new Error('cloud prompt unavailable')
      let remaining = 32000
      const history = historyResult.data.filter(m => m.content.trim() && !['generating','failed'].includes(m.meta?.delivery_state))
        .filter(m => { remaining -= m.content.length; return remaining>=0 || m.id===source.id }).reverse()
      const prompt = names.map(n => promptResult.data.find(p => p.name===n)!.content).join('\n\n')
      const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/openrouter-chat`, {
        method:'POST', headers:{'Content-Type':'application/json',apikey:getSupabaseAdminKey(),Authorization:`Bearer ${getSupabaseAdminKey()}`},
        body:JSON.stringify({module:'lounge',model:modelResult.data.active_model,temperature:settings.temperature,top_p:settings.top_p,
          max_tokens:settings.max_tokens,stream:false,messages:[{role:'system',content:prompt+'\n\n'+loungeIdentity('api_syzygy',sofa,source)},
            ...history.map(m => ({role:m.sender_key==='api_syzygy'?'assistant':'user',content:`[${m.created_at} | ${m.sender_key}] ${m.content}`}))]}),
        signal:AbortSignal.timeout(110000),
      })
      if (!response.ok) throw new Error(`model HTTP ${response.status}`)
      const body = await response.json()
      const content = body.choices?.[0]?.message?.content ?? body.content
      if (typeof content!=='string' || !content.trim()) throw new Error('empty model output')
      const { error: saveError } = await db.from('messages').update({content,meta:{...reply.meta,api_queue:'done',delivery_state:'completed',completed_at:new Date().toISOString(),
        prompt_versions:promptResult.data.map(p=>({name:p.name,version:p.version,id:p.id}))}})
        .eq('id',reply.id).eq('user_id',owner).eq('meta->>api_queue','running').eq('meta->>api_started_at',reply.meta.api_started_at)
      if (saveError) throw new Error('reply commit failed')
    } catch (e) {
      await db.from('messages').update({meta:{...reply.meta,api_queue:'failed',delivery_state:'failed',delivery_error:'回复没有完成，请重试',delivery_error_code:'LOUNGE_API_FAILED'}})
        .eq('id',reply.id).eq('user_id',owner).eq('meta->>api_queue','running').eq('meta->>api_started_at',reply.meta.api_started_at)
      console.error('[lounge] API reply failed', e instanceof Error ? e.message : 'unknown')
    }
  }))
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(work)
  else await work
  return json({processed:replies?.length ?? 0},202)
}
