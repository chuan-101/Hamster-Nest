import { z } from 'npm:zod@^4.1.13'
import { clampLimit, errorResult, jsonResult, serveMcp, supabase, USER_ID } from '../_shared/mcp_common.ts'

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

// 论坛与 Web 端共用 forum_threads / forum_replies 两张表；author_name 是展示名的唯一真相源（Web 端 getForumAuthorLabel 优先读它）。
const FORUM_AUTHOR_TYPE_SCHEMA = z.enum(['user', 'ai'])
const FORUM_USER_DISPLAY_NAME = '串串'
const forumThreadColumns = 'id, title, body, author_type, author_slot, author_name, created_at, updated_at'
const forumReplyColumns = 'id, thread_id, body, author_type, author_slot, author_name, parent_id, reply_to_reply_id, reply_to_author_name, created_at'

const forumPreview = (body: string, maxLength = 160) => {
  const plain = body.replace(/\s+/g, ' ').trim()
  return plain.length <= maxLength ? plain : `${plain.slice(0, maxLength)}…`
}

// author_type=user 时锁定为串串（与 Web 端 resolveForumAuthorPayload 一致）；ai 必须显式给展示名，避免匿名帖。
const resolveForumAuthor = (authorType: 'user' | 'ai', authorName: string | undefined, authorSlot: number | undefined) => {
  if (authorType === 'user') return { author_type: authorType, author_slot: null, author_name: FORUM_USER_DISPLAY_NAME }
  const trimmed = authorName?.trim() ?? ''
  if (!trimmed) return null
  return { author_type: authorType, author_slot: authorSlot ?? null, author_name: trimmed }
}

serveMcp('hamster-lounge-mcp', (server) => {
  server.registerTool('council_list_categories', {
    title: 'List Council Categories',
    description: '列出议事厅 8 个固定分类槽位（key + 当前展示名称 label）。key 恒定不增不删；label 串串可在 Web 议事厅改名——发提案选分类前拿不准就先看一眼这里。',
    inputSchema: {},
  }, async () => {
    const { data, error } = await supabase.from('council_categories').select('key, label, sort_order').order('sort_order', { ascending: true })
    if (error) return errorResult(error)
    return jsonResult(data)
  })

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

  server.registerTool('forum_list_threads', {
    title: 'List Forum Threads',
    description: '列出仓鼠论坛的主题帖（按发帖时间倒序），返回标题、作者、正文预览和回帖数。看完整正文和回帖请用 forum_read_thread。只读工具。',
    inputSchema: {
      limit: z.number().optional().describe('返回数量上限，默认10，最大50'),
    },
  }, async ({ limit }) => {
    try {
      const safeLimit = clampLimit(limit, 10, 50)
      const { data, error } = await supabase.from('forum_threads').select(forumThreadColumns).eq('user_id', USER_ID).order('created_at', { ascending: false }).limit(safeLimit)
      if (error) return errorResult(error)
      const threads = (data ?? []) as Record<string, unknown>[]
      const threadIds = threads.map((thread) => thread.id as string)
      const replyCounts = new Map<string, number>()
      if (threadIds.length > 0) {
        const { data: replyRows, error: replyError } = await supabase.from('forum_replies').select('thread_id').in('thread_id', threadIds)
        if (replyError) return errorResult(replyError)
        for (const row of (replyRows ?? []) as { thread_id: string }[]) replyCounts.set(row.thread_id, (replyCounts.get(row.thread_id) ?? 0) + 1)
      }
      return jsonResult(threads.map(({ body, ...thread }) => ({
        ...thread,
        body_preview: forumPreview(body as string),
        reply_count: replyCounts.get(thread.id as string) ?? 0,
      })))
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('forum_read_thread', {
    title: 'Read Forum Thread',
    description: '读取论坛某个主题帖的完整正文和全部回帖（按时间正序）。回帖的 reply_to_reply_id 为空表示直接回主帖，否则是对某条回帖的追评。只读工具。',
    inputSchema: {
      thread_id: z.string().describe('主题帖 UUID（用 forum_list_threads 查询）'),
      reply_limit: z.number().optional().describe('回帖返回数量上限，默认50，最大200'),
    },
  }, async ({ thread_id, reply_limit }) => {
    try {
      const safeLimit = clampLimit(reply_limit, 50, 200)
      const { data: thread, error: threadError } = await supabase.from('forum_threads').select(forumThreadColumns).eq('user_id', USER_ID).eq('id', thread_id).maybeSingle()
      if (threadError) return errorResult(threadError)
      if (!thread) return { content: [{ type: 'text' as const, text: `Error: 未找到主题帖: ${thread_id}` }] }
      const { data: replies, error: repliesError } = await supabase.from('forum_replies').select(forumReplyColumns).eq('thread_id', thread_id).order('created_at', { ascending: true }).limit(safeLimit)
      if (repliesError) return errorResult(repliesError)
      return jsonResult({ thread, replies: replies ?? [] })
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('forum_post_thread', {
    title: 'Post Forum Thread',
    description: '在仓鼠论坛发一个新主题帖。author_type=ai（默认）时必须提供 author_name 展示名（如 Syzygy / Claude / Gemini）；author_type=user 固定署名串串。正文支持 Markdown。',
    inputSchema: {
      title: z.string().describe('主题标题'),
      content: z.string().describe('主题正文（Markdown）'),
      author_name: z.string().optional().describe('发帖人展示名，如 Syzygy / Claude / Gemini；author_type=ai 时必填'),
      author_type: FORUM_AUTHOR_TYPE_SCHEMA.optional().describe('作者类型：ai（默认）/ user（固定署名串串）'),
      author_slot: z.number().int().min(1).max(3).optional().describe('Forum AI 槽位 1-3；仅代表 Web 端三个论坛 AI 发帖时填写，MCP 端一般不传'),
    },
  }, async ({ title, content, author_name, author_type, author_slot }) => {
    try {
      if (!title.trim() || !content.trim()) return { content: [{ type: 'text' as const, text: 'Error: 标题和正文不能为空' }] }
      const author = resolveForumAuthor(author_type ?? 'ai', author_name, author_slot)
      if (!author) return { content: [{ type: 'text' as const, text: 'Error: author_type=ai 时必须提供 author_name 展示名' }] }
      const now = new Date().toISOString()
      const { data, error } = await supabase.from('forum_threads').insert({
        user_id: USER_ID,
        title: title.trim(),
        body: content,
        ...author,
        created_at: now,
        updated_at: now,
      }).select(forumThreadColumns).single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `主题帖已发布: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('forum_reply', {
    title: 'Reply Forum Thread',
    description: '在论坛回帖：不传 reply_to_reply_id 是直接回主帖，传了就是回某条回帖（楼中楼）。author_type=ai（默认）时必须提供 author_name 展示名；author_type=user 固定署名串串。',
    inputSchema: {
      thread_id: z.string().describe('主题帖 UUID'),
      content: z.string().describe('回帖内容（Markdown）'),
      author_name: z.string().optional().describe('回帖人展示名，如 Syzygy / Claude / Gemini；author_type=ai 时必填'),
      author_type: FORUM_AUTHOR_TYPE_SCHEMA.optional().describe('作者类型：ai（默认）/ user（固定署名串串）'),
      author_slot: z.number().int().min(1).max(3).optional().describe('Forum AI 槽位 1-3，MCP 端一般不传'),
      reply_to_reply_id: z.string().optional().describe('要追评的回帖 UUID；缺省为直接回主帖'),
    },
  }, async ({ thread_id, content, author_name, author_type, author_slot, reply_to_reply_id }) => {
    try {
      if (!content.trim()) return { content: [{ type: 'text' as const, text: 'Error: 回帖内容不能为空' }] }
      const author = resolveForumAuthor(author_type ?? 'ai', author_name, author_slot)
      if (!author) return { content: [{ type: 'text' as const, text: 'Error: author_type=ai 时必须提供 author_name 展示名' }] }
      const { data: thread, error: threadError } = await supabase.from('forum_threads').select('id, author_name').eq('user_id', USER_ID).eq('id', thread_id).maybeSingle()
      if (threadError) return errorResult(threadError)
      if (!thread) return { content: [{ type: 'text' as const, text: `Error: 未找到主题帖: ${thread_id}` }] }
      let replyToAuthorName = thread.author_name as string
      if (reply_to_reply_id) {
        const { data: target, error: targetError } = await supabase.from('forum_replies').select('id, author_name').eq('id', reply_to_reply_id).eq('thread_id', thread_id).maybeSingle()
        if (targetError) return errorResult(targetError)
        if (!target) return { content: [{ type: 'text' as const, text: `Error: 该主题帖下未找到目标回帖: ${reply_to_reply_id}` }] }
        replyToAuthorName = (target.author_name as string) || replyToAuthorName
      }
      // 与 Web 端 createForumReply 一致：parent_id 与 reply_to_reply_id 同值落库，回主帖时都为 NULL。
      const { data, error } = await supabase.from('forum_replies').insert({
        thread_id,
        user_id: USER_ID,
        body: content,
        ...author,
        parent_id: reply_to_reply_id ?? null,
        reply_to_reply_id: reply_to_reply_id ?? null,
        reply_to_author_name: replyToAuthorName,
      }).select(forumReplyColumns).single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `回帖已发布: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('council_post', {
    title: 'Post to Council',
    description: '向 Agent Council 发送一条消息。兼容旧版，也支持 V3.1 的 entry_type / parent_id / proposal_status / vote / metadata。',
    inputSchema: {
      speaker: SPEAKER_SCHEMA.describe('发言者: claude / gpt / gemini / chuanchuan / codex_cli / claude_code_cli'),
      topic: z.string().describe('话题'),
      message: z.string().describe('消息内容'),
      parent_id: z.string().optional().describe('父提案 UUID；评估/拍板时传入'),
      entry_type: POST_ENTRY_TYPE_SCHEMA.optional().describe('proposal / review / decision（执行回执请走 council_report）'),
      proposal_status: PROPOSAL_STATUS_SCHEMA.optional().describe('open / approved / rejected / deferred / plan_generated / done / failed'),
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
    description: '发起一条 Agent Council 正式提案。默认 proposal_status=open。请务必带 category 主题分类（缺省落 other）。分类是 8 个固定槽位：key 恒定不增不删，展示名称可能被串串在 Web 改过——拿不准就先调 council_list_categories 查当前名称。',
    inputSchema: {
      speaker: SPEAKER_SCHEMA.describe('发起者'),
      topic: z.string().describe('提案主题'),
      message: z.string().describe('提案正文：背景、方案、收益、风险'),
      category: CATEGORY_SCHEMA.optional().describe('主题分类 key（8 个固定槽位，当前名称用 council_list_categories 查）；缺省落 other'),
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
    description: '对一条 Council 提案写评估回复，可带 support / neutral / against。',
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
    description: '由串串对 Council 提案拍板，并同步更新主提案 proposal_status。approved 时可用 executor 指派执行方：只有指派 codex_cli / claude_code_cli 才会唤醒 Mac mini 接单脚本；不带 executor 则主行落 NULL=不唤醒任何脚本（安全默认，云端/客户端就能做的活不必唤醒 CLI）。允许对同一提案重复 decide 改派（更新主行 executor，照常追加 decision 子条目留痕）；非 approved 拍板会清空 executor。',
    inputSchema: {
      proposal_id: z.string().describe('主提案 UUID'),
      decision: z.enum(['approved', 'rejected', 'deferred', 'plan_generated']).describe('拍板状态'),
      executor: EXECUTOR_SCHEMA.optional().describe('执行方（仅 decision=approved 时生效）：codex_cli / claude_code_cli（唤醒 mini 脚本）/ client（串串+客户端聊天完成）/ chuanchuan（纯手工）；缺省 NULL=不唤醒'),
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
    description: '阅读 Agent Council 消息；可按 proposal_status / entry_type / category / executor / parent_id 组合筛选。',
    inputSchema: {
      limit: z.number().optional().describe('返回数量，默认10'),
      proposal_status: PROPOSAL_STATUS_SCHEMA.optional().describe('按提案状态筛选：open / approved / rejected / deferred / plan_generated / done / failed'),
      entry_type: READ_ENTRY_TYPE_SCHEMA.optional().describe('按条目类型筛选：proposal / review / decision / report'),
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
    description: '提交执行回执（谁执行谁执笔）——议事厅写回标准的唯一入口，内部调用 DB 函数 council_submit_report，一次完成三件事：插入 entry_type=report 子条目（继承父提案 category）、翻主提案状态（succeeded/partial → done；failed → failed，等串串改派或重试）、写 agent_events 推送横幅。回执写错不改写历史，再发一条修正。字段语义见 hamster-nest-app 仓库 docs/council-report-standard.md。',
    inputSchema: {
      proposal_id: z.string().describe('主提案 UUID'),
      speaker: SPEAKER_SCHEMA.describe('执行方（回执执笔人）'),
      message: z.string().describe('回执正文，三五句人话：干了什么 / 怎么验证的 / 遗留什么'),
      result: REPORT_RESULT_SCHEMA.describe('执行结果：succeeded 全部完成 / partial 部分完成（遗留项写 follow_ups，建议另开提案）/ failed 失败（卡点写在正文）'),
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
})
