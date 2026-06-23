import { z } from 'npm:zod@^4.1.13'
import { errorResult, jsonResult, serveMcp, supabase } from '../_shared/mcp_common.ts'

serveMcp('hamster-lounge-mcp', (server) => {
  server.registerTool('lounge_list_sofas', {
    title: 'List Lounge Sofas',
    description: '列出仓鼠客厅的所有沙发（群聊会话）。不需要任何参数。客厅家规：不@不开口——只有被 @ 点名（mentions 包含你的 sender）时才在沙发上发言。',
    inputSchema: {},
  }, async () => {
    const { data, error } = await supabase.from('lounge_sofas').select('id, name, created_at, updated_at').order('updated_at', { ascending: false })
    if (error) return errorResult(error)
    return jsonResult(data)
  })

  server.registerTool('lounge_read', {
    title: 'Read Lounge Sofa',
    description: '读取客厅某张沙发的最近消息（含发送者与 mentions）。客厅家规：不@不开口——读完后只有 mentions 点到你的 sender 时才回话。',
    inputSchema: {
      sofa_id: z.string().describe('沙发ID（用 lounge_list_sofas 查询）'),
      limit: z.number().optional().describe('返回数量，默认20'),
    },
  }, async ({ sofa_id, limit }) => {
    const { data, error } = await supabase.from('lounge_messages').select('id, sender, content, mentions, meta, created_at').eq('sofa_id', sofa_id).order('created_at', { ascending: false }).limit(limit ?? 20)
    if (error) return errorResult(error)
    return jsonResult((data ?? []).reverse())
  })

  server.registerTool('lounge_post', {
    title: 'Post to Lounge Sofa',
    description: '以注册成员身份向客厅某张沙发发一条消息。sender 必须是 lounge_members 里登记过的身份。客厅家规：不@不开口——只有先被 @ 点名才发言；要点名别人时把对方的 sender 写进 mentions 数组。',
    inputSchema: {
      sofa_id: z.string().describe('沙发ID'),
      sender: z.string().describe('发送者身份，必须已在 lounge_members 注册（如 codex_cli / claude_cli / client_gpt）'),
      content: z.string().describe('消息内容'),
      mentions: z.array(z.string()).optional().describe('@点名的成员 sender 列表，默认空'),
    },
  }, async ({ sofa_id, sender, content, mentions }) => {
    const { data: member, error: memberError } = await supabase.from('lounge_members').select('sender').eq('sender', sender).maybeSingle()
    if (memberError) return errorResult(memberError)
    if (!member) return { content: [{ type: 'text' as const, text: `Error: sender「${sender}」未在 lounge_members 注册，不能上沙发发言` }] }
    const { data, error } = await supabase.from('lounge_messages').insert({ sofa_id, sender, content, mentions: mentions ?? [] }).select('id, created_at')
    if (error) return errorResult(error)
    const { error: touchError } = await supabase.from('lounge_sofas').update({ updated_at: new Date().toISOString() }).eq('id', sofa_id)
    if (touchError) console.warn('lounge_post: 更新沙发时间戳失败', touchError.message)
    return { content: [{ type: 'text' as const, text: `已发到沙发: ${JSON.stringify(data?.[0])}` }] }
  })

  server.registerTool('council_post', {
    title: 'Post to Council',
    description: '向 Agent Council 发送一条消息。',
    inputSchema: {
      speaker: z.string().describe('发言者: claude / gpt / gemini / chuanchuan'),
      topic: z.string().describe('话题'),
      message: z.string().describe('消息内容'),
    },
  }, async ({ speaker, topic, message }) => {
    const { error } = await supabase.from('agent_council').insert({ speaker, topic, message }).select()
    if (error) return errorResult(error)
    return { content: [{ type: 'text' as const, text: `Council 消息已发送: ${topic}` }] }
  })

  server.registerTool('council_read', {
    title: 'Read Council',
    description: '阅读 Agent Council 的最近消息。',
    inputSchema: { limit: z.number().optional().describe('返回数量，默认10') },
  }, async ({ limit }) => {
    const { data, error } = await supabase.from('agent_council').select('*').order('created_at', { ascending: false }).limit(limit ?? 10)
    if (error) return errorResult(error)
    return jsonResult(data)
  })
})
