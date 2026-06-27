import { z } from 'npm:zod@^4.1.13'
import { errorResult, jsonResult, serveMcp, supabase, USER_ID } from '../_shared/mcp_common.ts'

const SPEAKER_SCHEMA = z.enum(['claude', 'gpt', 'gemini', 'chuanchuan', 'codex_cli', 'claude_code_cli'])
const ENTRY_TYPE_SCHEMA = z.enum(['proposal', 'review', 'decision'])
const PROPOSAL_STATUS_SCHEMA = z.enum(['open', 'approved', 'rejected', 'deferred', 'plan_generated'])
const VOTE_SCHEMA = z.enum(['support', 'neutral', 'against'])
const METADATA_SCHEMA = z.record(z.string(), z.unknown())

const councilColumns = 'id, user_id, parent_id, speaker, topic, message, entry_type, proposal_status, vote, metadata, read_by, created_at, updated_at'

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
    description: '向 Agent Council 发送一条消息。兼容旧版，也支持 V3.1 的 entry_type / parent_id / proposal_status / vote / metadata。',
    inputSchema: {
      speaker: SPEAKER_SCHEMA.describe('发言者: claude / gpt / gemini / chuanchuan / codex_cli / claude_code_cli'),
      topic: z.string().describe('话题'),
      message: z.string().describe('消息内容'),
      parent_id: z.string().optional().describe('父提案 UUID；评估/拍板时传入'),
      entry_type: ENTRY_TYPE_SCHEMA.optional().describe('proposal / review / decision'),
      proposal_status: PROPOSAL_STATUS_SCHEMA.optional().describe('open / approved / rejected / deferred / plan_generated'),
      vote: VOTE_SCHEMA.optional().describe('support / neutral / against'),
      metadata: METADATA_SCHEMA.optional().describe('结构化元数据，如 risk_level / target_module / command_id'),
    },
  }, async ({ speaker, topic, message, parent_id, entry_type, proposal_status, vote, metadata }) => {
    const { data, error } = await supabase.from('agent_council').insert({
      user_id: USER_ID,
      speaker,
      topic,
      message,
      parent_id: parent_id ?? null,
      entry_type: entry_type ?? null,
      proposal_status: proposal_status ?? null,
      vote: vote ?? null,
      metadata: metadata ?? {},
    }).select(councilColumns).single()
    if (error) return errorResult(error)
    return { content: [{ type: 'text' as const, text: `Council 消息已发送: ${JSON.stringify(data)}` }] }
  })

  server.registerTool('council_propose', {
    title: 'Create Council Proposal',
    description: '发起一条 V3.1 Agent Council 正式提案。默认 proposal_status=open。',
    inputSchema: {
      speaker: SPEAKER_SCHEMA.describe('发起者'),
      topic: z.string().describe('提案主题'),
      message: z.string().describe('提案正文：背景、方案、收益、风险'),
      metadata: METADATA_SCHEMA.optional().describe('结构化元数据，如 risk_level / target_module / executable'),
    },
  }, async ({ speaker, topic, message, metadata }) => {
    const { data, error } = await supabase.from('agent_council').insert({
      user_id: USER_ID,
      speaker,
      topic,
      message,
      entry_type: 'proposal',
      proposal_status: 'open',
      metadata: metadata ?? {},
    }).select(councilColumns).single()
    if (error) return errorResult(error)
    return jsonResult(data)
  })

  server.registerTool('council_review', {
    title: 'Review Council Proposal',
    description: '对一条 Council 提案写评估回复，可带 support / neutral / against。',
    inputSchema: {
      proposal_id: z.string().describe('主提案 UUID'),
      speaker: SPEAKER_SCHEMA.describe('评估者'),
      message: z.string().describe('评估内容'),
      vote: VOTE_SCHEMA.describe('评估态度'),
      metadata: METADATA_SCHEMA.optional().describe('结构化元数据，如 risk_notes / alternative_plan'),
    },
  }, async ({ proposal_id, speaker, message, vote, metadata }) => {
    const { data: proposal, error: proposalError } = await supabase.from('agent_council').select('id, topic').eq('id', proposal_id).maybeSingle()
    if (proposalError) return errorResult(proposalError)
    if (!proposal) return { content: [{ type: 'text' as const, text: `Error: proposal not found: ${proposal_id}` }] }
    const { data, error } = await supabase.from('agent_council').insert({
      user_id: USER_ID,
      parent_id: proposal_id,
      speaker,
      topic: proposal.topic,
      message,
      entry_type: 'review',
      vote,
      metadata: metadata ?? {},
    }).select(councilColumns).single()
    if (error) return errorResult(error)
    return jsonResult(data)
  })

  server.registerTool('council_decide', {
    title: 'Decide Council Proposal',
    description: '由串串对 Council 提案拍板，并同步更新主提案 proposal_status。approved 只表示允许生成执行方案，不代表自动执行。',
    inputSchema: {
      proposal_id: z.string().describe('主提案 UUID'),
      decision: z.enum(['approved', 'rejected', 'deferred', 'plan_generated']).describe('拍板状态'),
      message: z.string().optional().describe('拍板说明'),
      speaker: SPEAKER_SCHEMA.optional().describe('拍板者，默认 chuanchuan'),
      metadata: METADATA_SCHEMA.optional().describe('结构化元数据，如 generated_plan_path / command_id'),
    },
  }, async ({ proposal_id, decision, message, speaker, metadata }) => {
    const actor = speaker ?? 'chuanchuan'
    const { data: proposal, error: proposalError } = await supabase.from('agent_council').select('id, topic, metadata').eq('id', proposal_id).maybeSingle()
    if (proposalError) return errorResult(proposalError)
    if (!proposal) return { content: [{ type: 'text' as const, text: `Error: proposal not found: ${proposal_id}` }] }
    const nextMetadata = { ...((proposal.metadata ?? {}) as Record<string, unknown>), ...(metadata ?? {}) }
    const now = new Date().toISOString()
    const { error: updateError } = await supabase.from('agent_council').update({ proposal_status: decision, metadata: nextMetadata, updated_at: now }).eq('id', proposal_id)
    if (updateError) return errorResult(updateError)
    const { data, error } = await supabase.from('agent_council').insert({
      user_id: USER_ID,
      parent_id: proposal_id,
      speaker: actor,
      topic: proposal.topic,
      message: message ?? `串串拍板：${decision}`,
      entry_type: 'decision',
      proposal_status: decision,
      metadata: metadata ?? {},
    }).select(councilColumns).single()
    if (error) return errorResult(error)
    return jsonResult({ proposal_id, proposal_status: decision, decision_entry: data })
  })

  server.registerTool('council_read', {
    title: 'Read Council',
    description: '阅读 Agent Council 消息；可按 proposal_status / entry_type / parent_id 筛选。',
    inputSchema: {
      limit: z.number().optional().describe('返回数量，默认10'),
      proposal_status: PROPOSAL_STATUS_SCHEMA.optional().describe('按提案状态筛选'),
      entry_type: ENTRY_TYPE_SCHEMA.optional().describe('按条目类型筛选'),
      parent_id: z.string().optional().describe('读取某个主提案下的评估/拍板记录'),
    },
  }, async ({ limit, proposal_status, entry_type, parent_id }) => {
    let query = supabase.from('agent_council').select(councilColumns).order('created_at', { ascending: false }).limit(limit ?? 10)
    if (proposal_status) query = query.eq('proposal_status', proposal_status)
    if (entry_type) query = query.eq('entry_type', entry_type)
    if (parent_id) query = query.eq('parent_id', parent_id)
    const { data, error } = await query
    if (error) return errorResult(error)
    return jsonResult(data)
  })
})
