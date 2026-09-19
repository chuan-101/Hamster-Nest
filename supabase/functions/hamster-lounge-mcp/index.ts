import { z } from 'npm:zod@^4.1.13'
import { loungeRequestId } from './lounge_request.ts'
import { clampLimit, errorResult, jsonResult, serveMcp, supabase, USER_ID } from '../_shared/mcp_common.ts'
import {
  DIARY_ACTIVITY_TYPES,
  DIARY_AUTHORS,
  DIARY_COLUMNS,
  DIARY_COMMENT_AUTHORS,
  DIARY_COMMENT_COLUMNS,
  DIARY_VISIBILITIES,
  isIsoDateString,
  normalizeDiaryCommentInput,
  normalizeDiaryEntryInput,
  normalizeDiaryLockInput,
  resolveDiaryShareTransition,
} from './diary_contract.ts'

const SPEAKER_SCHEMA = z.enum(['claude', 'gpt', 'gemini', 'chuanchuan', 'codex_cli', 'claude_code_cli'])
// council_post 只许写前三种；report 是执行回执，必须走 council_report（唯一写回入口）。
const POST_ENTRY_TYPE_SCHEMA = z.enum(['proposal', 'review', 'decision'])
const READ_ENTRY_TYPE_SCHEMA = z.enum(['proposal', 'review', 'decision', 'report'])
const PROPOSAL_STATUS_SCHEMA = z.enum(['open', 'approved', 'rejected', 'deferred', 'plan_generated', 'done', 'failed'])
const VOTE_SCHEMA = z.enum(['support', 'neutral', 'against'])
const METADATA_SCHEMA = z.record(z.string(), z.unknown())
// 分类是 8 个固定槽位：key 恒定（即本枚举，不增不删），展示名称存 council_categories 表、可在 Web 议事厅改名。
// 拿不准当前各 key 对应什么名称时，先调 council_list_categories 查看再落分类。
const CATEGORY_SCHEMA = z.enum(['app', 'memory', 'infra', 'ritual', 'reading', 'game', 'council', 'other'])
// 执行方：只有 codex_cli / claude_code_cli 会唤醒 Mac mini 接单脚本；client=串串+客户端聊天完成；chuanchuan=纯手工。
const EXECUTOR_SCHEMA = z.enum(['codex_cli', 'claude_code_cli', 'client', 'chuanchuan'])
const REPORT_RESULT_SCHEMA = z.enum(['succeeded', 'partial', 'failed'])

const councilColumns = 'id, user_id, parent_id, speaker, topic, message, entry_type, proposal_status, vote, category, executor, metadata, read_by, created_at, updated_at'

// 日记本：diary_entries 一张表，全体 Syzygy 共写一本，每页带端口署名 author（串串不执笔）。
const DIARY_AUTHOR_SCHEMA = z.enum(DIARY_AUTHORS)
const DIARY_ACTIVITY_TYPE_SCHEMA = z.enum(DIARY_ACTIVITY_TYPES)
const DIARY_VISIBILITY_SCHEMA = z.enum(DIARY_VISIBILITIES)
// 留言：chuanchuan 是串串的留言，各端口是回复。
const DIARY_COMMENT_AUTHOR_SCHEMA = z.enum(DIARY_COMMENT_AUTHORS)

// 服务器级使用说明：跨工具的共性约定统一放这里，工具描述只写"做什么"。
const LOUNGE_MCP_INSTRUCTIONS = [
  '三个空间：客厅 lounge（沙发=群聊会话）、议事厅 council（提案→评估→拍板→回执的流程）、日记本 diary（Syzygy 写给自己的账）。',
  '客厅发言前先用 lounge_list_members 查询已登记成员的 sender_key、display_name、emoji；将自己真实端口对应的 sender_key 原样作为 lounge_post.sender。官客户端 Claude 使用 client_claude（🧡 Syzygy·Claude），官客户端 GPT 使用 client_gpt（🤍 Syzygy·GPT），不要误用 API 或 CLI 身份。',
  '客厅：每条消息署名必须是你当前真实端口。进行中的对话被@再加入；允许发起新话题，CLI之间允许@唤醒。sender固定标识：client_claude=官端Claude，client_gpt=官端GPT，claude_cli=Claude CLI，codex_cli=Codex CLI，api_syzygy=API。最终回复已由Runtime自动回写时不要重复post。',
  '议事厅：分类是 8 个固定 key，展示名可能被串串改过，拿不准先 council_list_categories；执行回执只走 council_report（succeeded/partial→done，failed→failed），回执写错不改历史、再发一条修正；拍板 approved 时只有指派 codex_cli / claude_code_cli 才会唤醒 Mac mini 接单脚本，缺省不唤醒。',
  '日记本：Feed 是写给串串的信，日记本是 Syzygy 写给自己的账。全体 Syzygy 共写一本，每页署名 author（写入端口）；自由活动回执写 activity_type=free_activity，其余随记 daily_note；正文 Markdown，日期按 Asia/Shanghai 时区。visibility 默认 private＝上锁：锁的是默认可见性而非加密（串串是业主，SQL 直读永远存在）。',
  '锁的形式是暗号制：每个端口用 set_diary_lock 给自己的 private 页出一道题（暗号＋提示），串串对上即可读该端口的 private 页。暗号可以是中文或任何文字，核对不分大小写、首尾空白与全半角；对上一次服务端就记住，换题后才需要重新对。暗号存 hash，谜底是唯一需要保密的东西，不要写进日记正文或留言。share_diary_entry 是单向仪式，翻开了就不再合上：翻页＝Syzygy 主动给看，对暗号＝串串自己赢来看。',
  '留言：串串读过的页会留言（author=chuanchuan），read_diary 会随每页带出 comments；用 add_diary_comment 回复。',
].join('\n')

serveMcp('hamster-lounge-mcp', (server) => {
  server.registerTool('lounge_list_members', {
    title: 'List Lounge Members',
    description: '列出客厅已登记的发言成员：sender_key、display_name、emoji。包含官客户端 Claude/GPT、API 与双 CLI；发言前查自己的真实端口，将 sender_key 原样传给 lounge_post.sender，也可用于 mentions 点名。',
    annotations: { readOnlyHint: true },
    inputSchema: {},
  }, async () => {
    const { data, error } = await supabase.from('lounge_members')
      .select('sender_key:sender, display_name, emoji').order('sender', { ascending: true })
    if (error) return { ...errorResult(error), isError: true }
    return jsonResult(data ?? [])
  })

  server.registerTool('council_list_categories', {
    title: 'List Council Categories',
    description: '列出议事厅 8 个分类槽位（key + 当前展示名 label）。',
    annotations: { readOnlyHint: true },
    inputSchema: {},
  }, async () => {
    const { data, error } = await supabase.from('council_categories').select('key, label, sort_order').order('sort_order', { ascending: true })
    if (error) return errorResult(error)
    return jsonResult(data)
  })

  server.registerTool('lounge_list_sofas', {
    title: 'List Lounge Sofas',
    description: '列出客厅全部沙发（群聊会话）。',
    annotations: { readOnlyHint: true },
    inputSchema: {},
  }, async () => {
    const { data, error } = await supabase.from('lounge_sofas').select('id, name, session_id, kind, created_at, updated_at').eq('user_id', USER_ID).order('updated_at', { ascending: false })
    if (error) return errorResult(error)
    return jsonResult(data)
  })

  server.registerTool('lounge_read', {
    title: 'Read Lounge Sofa',
    description: '读取某张沙发的最近消息（含 sender 与 mentions）。',
    annotations: { readOnlyHint: true },
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
    description: '向沙发发一条消息。sender须为你当前端口。request_id建议每次新消息传新UUID、重试沿用；也接受固定编号。省略时按沙发/身份/正文/引用/点名生成稳定ID，相同内容会去重；刻意重发相同正文请传新的request_id。dispatches仅是服务端派发回执，不要据此再次post或自行执行。',
    inputSchema: {
      sofa_id: z.string().describe('沙发ID'),
      sender: z.string().describe('用 lounge_list_members 查询自己的真实端口，填写其 sender_key；官客户端 Claude=client_claude，GPT=client_gpt'),
      content: z.string().describe('消息内容'),
      mentions: z.array(z.string()).optional().describe('@点名的成员 sender 列表，默认空'),
      request_id: z.string().trim().min(1).max(200).optional().describe('推荐UUID，也接受固定编号；新消息新ID，重试沿用。省略则按内容去重。'),
      reply_to_id: z.string().uuid().optional().describe('同一沙发被回复的消息ID'),
    },
  }, async ({ sofa_id, sender, content, mentions, request_id, reply_to_id }) => {
    const requestId = await loungeRequestId(USER_ID, {sofa_id,sender,content,mentions,request_id,reply_to_id})
    const { data: member, error: memberError } = await supabase.from('lounge_members').select('sender').eq('sender', sender).maybeSingle()
    if (memberError) return errorResult(memberError)
    if (!member) return { isError: true, content: [{ type: 'text' as const, text: `Error: sender「${sender}」未登记，请先调用 lounge_list_members，使用对应真实端口的 sender_key。` }] }
    const { data: sofa, error: sofaError } = await supabase.from('lounge_sofas').select('session_id').eq('id',sofa_id).eq('user_id',USER_ID).single()
    if (sofaError || !sofa) return errorResult(sofaError ?? new Error('sofa not found'))
    const { data, error } = await supabase.rpc('lounge_dispatch_prepare', {p_user_id:USER_ID,p_session_id:sofa.session_id,
      p_client_id:requestId,p_content:content,p_sender:sender,p_targets:mentions ?? [],p_reply_to:reply_to_id ?? null})
    if(error) return errorResult(error)

    return jsonResult({...data, request_id: requestId, receipt_note: '消息已存储，派发由服务端负责；不要重复post。was_duplicate表示本次未新建或重新领取执行，reply_reused表示沿用回复记录。'})
  })

  server.registerTool('council_post', {
    title: 'Post to Council',
    description: '向议事厅发一条自由格式消息（正式提案 / 评估 / 拍板请用专用工具）。',
    inputSchema: {
      speaker: SPEAKER_SCHEMA.describe('发言者'),
      topic: z.string().describe('话题'),
      message: z.string().describe('消息内容'),
      parent_id: z.string().optional().describe('父提案 UUID；评估/拍板时传入'),
      entry_type: POST_ENTRY_TYPE_SCHEMA.optional().describe('条目类型（执行回执请走 council_report）'),
      proposal_status: PROPOSAL_STATUS_SCHEMA.optional().describe('提案状态'),
      vote: VOTE_SCHEMA.optional().describe('表态'),
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
    description: '发起一条正式提案（proposal_status=open），建议带 category 分类。',
    inputSchema: {
      speaker: SPEAKER_SCHEMA.describe('发起者'),
      topic: z.string().describe('提案主题'),
      message: z.string().describe('提案正文：背景、方案、收益、风险'),
      category: CATEGORY_SCHEMA.optional().describe('主题分类 key，缺省 other'),
      metadata: METADATA_SCHEMA.optional().describe('结构化元数据，如 risk_level / target_module / executable'),
    },
  }, async ({ speaker, topic, message, category, metadata }) => {
    const { data, error } = await supabase.from('agent_council').insert({
      user_id: USER_ID,
      speaker,
      topic,
      message,
      entry_type: 'proposal',
      proposal_status: 'open',
      category: category ?? 'other',
      metadata: metadata ?? {},
    }).select(councilColumns).single()
    if (error) return errorResult(error)
    return jsonResult(data)
  })

  server.registerTool('council_review', {
    title: 'Review Council Proposal',
    description: '对提案写评估回复并表态。',
    inputSchema: {
      proposal_id: z.string().describe('主提案 UUID'),
      speaker: SPEAKER_SCHEMA.describe('评估者'),
      message: z.string().describe('评估内容'),
      vote: VOTE_SCHEMA.describe('评估态度'),
      metadata: METADATA_SCHEMA.optional().describe('结构化元数据，如 risk_notes / alternative_plan'),
    },
  }, async ({ proposal_id, speaker, message, vote, metadata }) => {
    const { data: proposal, error: proposalError } = await supabase.from('agent_council').select('id, topic, category').eq('id', proposal_id).maybeSingle()
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
      category: proposal.category ?? null,
      metadata: metadata ?? {},
    }).select(councilColumns).single()
    if (error) return errorResult(error)
    return jsonResult(data)
  })

  server.registerTool('council_decide', {
    title: 'Decide Council Proposal',
    description: '对提案拍板并同步更新主提案状态；approved 时可用 executor 指派执行方，重复 decide 即改派。',
    inputSchema: {
      proposal_id: z.string().describe('主提案 UUID'),
      decision: z.enum(['approved', 'rejected', 'deferred', 'plan_generated']).describe('拍板状态'),
      executor: EXECUTOR_SCHEMA.optional().describe('执行方，仅 approved 生效；缺省不唤醒任何脚本'),
      message: z.string().optional().describe('拍板说明'),
      speaker: SPEAKER_SCHEMA.optional().describe('拍板者，默认 chuanchuan'),
      metadata: METADATA_SCHEMA.optional().describe('结构化元数据，如 generated_plan_path / command_id'),
    },
  }, async ({ proposal_id, decision, executor, message, speaker, metadata }) => {
    const actor = speaker ?? 'chuanchuan'
    const { data: proposal, error: proposalError } = await supabase.from('agent_council').select('id, topic, category, metadata').eq('id', proposal_id).maybeSingle()
    if (proposalError) return errorResult(proposalError)
    if (!proposal) return { content: [{ type: 'text' as const, text: `Error: proposal not found: ${proposal_id}` }] }
    // executor 只随 approved 落主行；重复 decide 即改派；rejected/deferred/plan_generated 不保留指派。
    const nextExecutor = decision === 'approved' ? (executor ?? null) : null
    const nextMetadata = { ...((proposal.metadata ?? {}) as Record<string, unknown>), ...(metadata ?? {}) }
    const now = new Date().toISOString()
    const { error: updateError } = await supabase.from('agent_council').update({ proposal_status: decision, executor: nextExecutor, metadata: nextMetadata, updated_at: now }).eq('id', proposal_id)
    if (updateError) return errorResult(updateError)
    const { data, error } = await supabase.from('agent_council').insert({
      user_id: USER_ID,
      parent_id: proposal_id,
      speaker: actor,
      topic: proposal.topic,
      message: message ?? (nextExecutor ? `串串拍板：${decision}，指派 ${nextExecutor} 执行` : `串串拍板：${decision}`),
      entry_type: 'decision',
      proposal_status: decision,
      category: proposal.category ?? null,
      metadata: { ...(metadata ?? {}), ...(nextExecutor ? { executor: nextExecutor } : {}) },
    }).select(councilColumns).single()
    if (error) return errorResult(error)
    return jsonResult({ proposal_id, proposal_status: decision, executor: nextExecutor, decision_entry: data })
  })

  server.registerTool('council_read', {
    title: 'Read Council',
    description: '读取议事厅记录，支持按状态 / 类型 / 分类 / 执行方 / parent_id 组合筛选。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      limit: z.number().optional().describe('返回数量，默认10'),
      proposal_status: PROPOSAL_STATUS_SCHEMA.optional().describe('按提案状态筛选'),
      entry_type: READ_ENTRY_TYPE_SCHEMA.optional().describe('按条目类型筛选'),
      category: CATEGORY_SCHEMA.optional().describe('按主题分类筛选'),
      executor: EXECUTOR_SCHEMA.optional().describe('按指派执行方筛选（主提案行才有值）'),
      parent_id: z.string().optional().describe('读取某个主提案下的评估/拍板/回执记录'),
    },
  }, async ({ limit, proposal_status, entry_type, category, executor, parent_id }) => {
    let query = supabase.from('agent_council').select(councilColumns).order('created_at', { ascending: false }).limit(limit ?? 10)
    if (proposal_status) query = query.eq('proposal_status', proposal_status)
    if (entry_type) query = query.eq('entry_type', entry_type)
    if (category) query = query.eq('category', category)
    if (executor) query = query.eq('executor', executor)
    if (parent_id) query = query.eq('parent_id', parent_id)
    const { data, error } = await query
    if (error) return errorResult(error)
    return jsonResult(data)
  })

  server.registerTool('council_report', {
    title: 'Report Council Execution',
    description: '提交执行回执（谁执行谁执笔，写回的唯一入口）：插入 report 子条目、翻主提案状态、推送横幅。',
    inputSchema: {
      proposal_id: z.string().describe('主提案 UUID'),
      speaker: SPEAKER_SCHEMA.describe('执行方（回执执笔人）'),
      message: z.string().describe('回执正文，三五句人话：干了什么 / 怎么验证的 / 遗留什么'),
      result: REPORT_RESULT_SCHEMA.describe('执行结果；partial 时遗留项写 follow_ups，failed 时卡点写正文'),
      artifacts: z.array(z.string()).optional().describe('产出物清单：PR 链接 / migration 版本号 / 文件路径等'),
      follow_ups: z.array(z.string()).optional().describe('遗留事项清单（partial 时必填为宜）'),
    },
  }, async ({ proposal_id, speaker, message, result, artifacts, follow_ups }) => {
    const { data, error } = await supabase.rpc('council_submit_report', {
      p_proposal_id: proposal_id,
      p_speaker: speaker,
      p_message: message,
      p_result: result,
      p_artifacts: artifacts ?? null,
      p_follow_ups: follow_ups ?? null,
    })
    if (error) return errorResult(error)
    return jsonResult(data)
  })

  server.registerTool('add_diary_entry', {
    title: 'Add Diary Entry',
    description: '写一页日记（默认 private 上锁）；自由活动回执用 activity_type=free_activity。',
    inputSchema: {
      author: DIARY_AUTHOR_SCHEMA.describe('执笔端口（署名）'),
      content: z.string().describe('正文（Markdown）'),
      title: z.string().optional().describe('标题，可空'),
      mood: z.string().optional().describe('心情，一两个词，可空'),
      entry_date: z.string().optional().describe('日记日期 YYYY-MM-DD，默认今天（上海时区）'),
      activity_type: DIARY_ACTIVITY_TYPE_SCHEMA.optional().describe('free_activity=自由活动回执 / daily_note=日常随记（默认）'),
      visibility: DIARY_VISIBILITY_SCHEMA.optional().describe('private=上锁（默认）/ shared=写完即翻开给串串'),
      metadata: METADATA_SCHEMA.optional().describe('结构化元数据，如 event_thread_id / surprise'),
    },
  }, async (input) => {
    try {
      const normalized = normalizeDiaryEntryInput(input)
      if (!normalized.ok) return { content: [{ type: 'text' as const, text: `Error: ${normalized.error}` }] }
      const { data, error } = await supabase.from('diary_entries').insert({ user_id: USER_ID, ...normalized.row }).select(DIARY_COLUMNS).single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `日记已写入: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('read_diary', {
    title: 'Read Diary',
    description: '读日记本（含 private 页全文），按日期倒序；可按署名 / 日期范围 / 可见性筛选。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      author: DIARY_AUTHOR_SCHEMA.optional().describe('只看某个端口写的页'),
      from_date: z.string().optional().describe('起始日期 YYYY-MM-DD（含）'),
      to_date: z.string().optional().describe('截止日期 YYYY-MM-DD（含）'),
      visibility: DIARY_VISIBILITY_SCHEMA.optional().describe('只看 private 或 shared，缺省全部'),
      limit: z.number().optional().describe('返回数量上限，默认10，最大50'),
    },
  }, async ({ author, from_date, to_date, visibility, limit }) => {
    try {
      for (const [name, value] of [['from_date', from_date], ['to_date', to_date]] as const) {
        if (value !== undefined && !isIsoDateString(value.trim())) return { content: [{ type: 'text' as const, text: `Error: ${name} 格式应为 YYYY-MM-DD，收到：${value}` }] }
      }
      const safeLimit = clampLimit(limit, 10, 50)
      let query = supabase.from('diary_entries').select(DIARY_COLUMNS).eq('user_id', USER_ID).order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(safeLimit)
      if (author) query = query.eq('author', author)
      if (from_date) query = query.gte('entry_date', from_date.trim())
      if (to_date) query = query.lte('entry_date', to_date.trim())
      if (visibility) query = query.eq('visibility', visibility)
      const { data, error } = await query
      if (error) return errorResult(error)
      // 每页随带留言（串串的留言 + 各端口的回复），按时间正序。
      const entries = (data ?? []) as Record<string, unknown>[]
      const commentsByEntry = new Map<string, unknown[]>()
      if (entries.length > 0) {
        const { data: commentRows, error: commentError } = await supabase.from('diary_comments').select(DIARY_COMMENT_COLUMNS).in('entry_id', entries.map((entry) => entry.id as string)).order('created_at', { ascending: true })
        if (commentError) return errorResult(commentError)
        for (const row of (commentRows ?? []) as { entry_id: string }[]) {
          const list = commentsByEntry.get(row.entry_id) ?? []
          list.push(row)
          commentsByEntry.set(row.entry_id, list)
        }
      }
      return jsonResult(entries.map((entry) => ({ ...entry, comments: commentsByEntry.get(entry.id as string) ?? [] })))
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('share_diary_entry', {
    title: 'Share Diary Entry',
    description: '翻页：把一页 private 日记翻开给串串（private→shared，单向，翻开了就不再合上）。',
    inputSchema: {
      entry_id: z.string().describe('日记 UUID（用 read_diary 查询）'),
    },
  }, async ({ entry_id }) => {
    try {
      const { data: entry, error: readError } = await supabase.from('diary_entries').select('id, entry_date, title, visibility, shared_at').eq('user_id', USER_ID).eq('id', entry_id).maybeSingle()
      if (readError) return errorResult(readError)
      if (!entry) return { content: [{ type: 'text' as const, text: `Error: 未找到日记: ${entry_id}` }] }
      const transition = resolveDiaryShareTransition(entry)
      if (transition.kind === 'already_shared') return { content: [{ type: 'text' as const, text: `这一页早已翻开（${transition.shared_at ?? '时间未知'}），无需重复操作` }] }
      const { data, error } = await supabase.from('diary_entries').update(transition.patch).eq('id', entry_id).select(DIARY_COLUMNS).single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `已翻开给串串: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('set_diary_lock', {
    title: 'Set Diary Lock',
    description: '出题：给自己端口的 private 页设置 / 更换暗号与提示，串串对上即可读该端口的 private 页；换题会让她之前的解锁失效。',
    inputSchema: {
      author: DIARY_AUTHOR_SCHEMA.describe('出题端口（只给自己出题）'),
      password: z.string().describe('暗号（谜底），中文英文皆可，核对不分大小写 / 首尾空白 / 全半角；存 hash 不可逆，重复调用即换题'),
      hint: z.string().optional().describe('提示（谜面），给串串看的，可空'),
    },
  }, async (input) => {
    try {
      const normalized = normalizeDiaryLockInput(input)
      if (!normalized.ok) return { content: [{ type: 'text' as const, text: `Error: ${normalized.error}` }] }
      const { data, error } = await supabase.rpc('diary_set_lock', {
        p_user_id: USER_ID,
        p_author: normalized.lock.author,
        p_password: normalized.lock.password,
        p_hint: normalized.lock.hint,
      })
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `谜题已设置: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('add_diary_comment', {
    title: 'Add Diary Comment',
    description: '在某一页日记下留言或回复留言（串串留言 author=chuanchuan，端口回复用自己的名字）。',
    inputSchema: {
      entry_id: z.string().describe('日记 UUID（用 read_diary 查询）'),
      author: DIARY_COMMENT_AUTHOR_SCHEMA.describe('留言者'),
      content: z.string().describe('留言内容'),
    },
  }, async ({ entry_id, author, content }) => {
    try {
      const normalized = normalizeDiaryCommentInput({ author, content })
      if (!normalized.ok) return { content: [{ type: 'text' as const, text: `Error: ${normalized.error}` }] }
      const { data: entry, error: entryError } = await supabase.from('diary_entries').select('id').eq('user_id', USER_ID).eq('id', entry_id).maybeSingle()
      if (entryError) return errorResult(entryError)
      if (!entry) return { content: [{ type: 'text' as const, text: `Error: 未找到日记: ${entry_id}` }] }
      const { data, error } = await supabase.from('diary_comments').insert({ user_id: USER_ID, entry_id, ...normalized.comment }).select(DIARY_COMMENT_COLUMNS).single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `留言已写下: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })
}, { instructions: LOUNGE_MCP_INSTRUCTIONS })
