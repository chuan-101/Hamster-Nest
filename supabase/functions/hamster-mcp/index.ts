import { readDeviceSnapshot, type Client } from '../_shared/device-sync.ts'
import { z } from 'npm:zod@^4.1.13'
import { clampLimit, errorResult, jsonResult, serveMcp, supabase, USER_ID } from '../_shared/mcp_common.ts'
import {
  MAX_TRAVEL_COMMENT_LENGTH,
  MAX_TRAVEL_STOPS_PER_WRITE,
  MAX_TRAVEL_SUMMARY_LENGTH,
  TRAVEL_CHECKIN_KIND_LABELS,
  TRAVEL_COMMENT_COLUMNS,
  TRAVEL_STOP_KIND_LABELS,
  TRAVEL_TRIP_COLUMNS,
  buildAmapMarkerUrl,
  compareTravel,
  nextTravelSortOrders,
  normalizeTravelStopInput,
  normalizeTravelTripPatch,
  type TravelTripStatus,
} from './travel_contract.ts'

const TIMELINE_SOURCE_SCHEMA = z.enum(['claude', 'gpt', 'user', 'gemini', 'wechat', 'codex_cli', 'claude_code_cli', 'api'])
const MEMO_SOURCE_SCHEMA = TIMELINE_SOURCE_SCHEMA
const MEMO_COLUMNS = 'id, content, source, is_pinned, created_at, updated_at'
const TODO_COLUMNS = 'id, date, title, notes, status, todo_type, event_date, created_by, sort_order, created_at, completed_at'
const TODO_CREATED_BY_SCHEMA = z.enum(['串串', 'syzygy'])
const TODO_TYPE_SCHEMA = z.enum(['short_term', 'long_term'])
const DEFAULT_TODO_CATEGORY_NAME = '🐹今日待办'
// 事件集（纪事本末体）：event_threads 是大类 / 事件线，event_entries 是大类下按日期排列的条目。
const EVENT_THREAD_COLUMNS = 'id, title, emoji_group, current_status, status, started_on, ended_on, created_at, updated_at'
const EVENT_ENTRY_COLUMNS = 'id, thread_id, entry_date, content, source, created_at'
const EVENT_THREAD_STATUS_SCHEMA = z.enum(['active', 'closed'])
const EVENT_ENTRY_SOURCE_SCHEMA = z.enum(['claude', 'gpt', 'gemini', 'user', 'codex_cli', 'claude_code_cli', 'system', 'api'])

// 服务器级使用说明：跨工具的共性约定统一放这里，工具描述只写"做什么"。
const HAMSTER_MCP_INSTRUCTIONS = [
  '仓鼠窝日常域：时间轴（长期事件记忆）、待办、备忘录 memo（中期活事实）、事件集 event_threads / event_entries（纪事本末体的线程记录层）。',
  '裁决口诀：过去进时间轴，现在进 Memo，永远进档案，将来进 To do，线程进事件集；自己说的进 Wiki，外面看到想留的进囤粮处；要许可的去议事厅。',
  '事件集：记时效期较长、会频繁更新的事项。一件事开一条事件线（thread），进度按日期追加条目（entry），结束后结项归档不删。开机只用 list_event_threads 读进行中事件线的「当前状态」行，对话碰到某件事再 read_event_thread 读条目；已结束的默认不读。同一件事可同时进时间轴（意义与心情）和事件集（进度）。追加条目时顺手用 current_status 刷新状态行。',
  '通用约定：日期按 Asia/Shanghai 时区；source / recorder / created_by 等枚举表示写入端身份，默认 claude / syzygy。',
  '写入习惯：timeline / memo 写入前先用 search_timeline / list_memos 查重，同一事实优先 update_memo 维护而非重复新增；时间轴写错或要补细节用 update_timeline 改原条，不另补一条；带「进行中」标签的 memo 是活跃叙事线，正文以「当前状态」段收尾。时间轴写入标准：三个月后读起来会心动的事。',
  '游记 travel_*：一次旅行（trip）= 攻略区（Syzygy 写的计划停留点，GCJ-02 坐标，可用高德 MCP 查 POI 与路线）+ 路线区（串串在 PWA 按下的打卡，离线补传，时间以按下时刻为准）。read_trip 会把每个打卡标成按计划 / 改道 / 新发现，把计划点标成到过 / 跳过 / 还没到；偏离不算扣分，新发现是惊喜。攻略要路痴友好：每个点写清为什么去、注意事项和导航提示（从上一站怎么过来、认哪个标志物）。改单个攻略点用 update_trip_stop / delete_trip_stop，整份重排才用 write_trip_plan(replace)。旅行结束后可对照两区写复盘（update_trip.summary）。',
  '删除是物理删除，需显式 confirm=true 二次确认。',
].join('\n')

const shanghaiDateString = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

type MemoTagRef = { id: string; name: string }

const normalizeTagNames = (names: string[] | undefined) =>
  Array.from(new Set((names ?? []).map((name) => name.trim()).filter((name) => name.length > 0)))

// 标签名不存在时自动创建，返回全部命中的标签行。
const ensureMemoTags = async (names: string[]): Promise<MemoTagRef[]> => {
  if (names.length === 0) return []
  const { data: existing, error: findError } = await supabase.from('memo_tags').select('id, name').eq('user_id', USER_ID).in('name', names)
  if (findError) throw findError
  const found = (existing ?? []) as MemoTagRef[]
  const missing = names.filter((name) => !found.some((tag) => tag.name === name))
  if (missing.length === 0) return found
  const { data: created, error: createError } = await supabase.from('memo_tags').insert(missing.map((name) => ({ user_id: USER_ID, name }))).select('id, name')
  if (createError) throw createError
  return [...found, ...((created ?? []) as MemoTagRef[])]
}

const fetchTagNamesByEntryIds = async (entryIds: string[]): Promise<Map<string, string[]>> => {
  const tagNames = new Map<string, string[]>()
  if (entryIds.length === 0) return tagNames
  const { data, error } = await supabase.from('memo_entry_tags').select('memo_entry_id, memo_tags(name)').in('memo_entry_id', entryIds)
  if (error) throw error
  for (const row of (data ?? []) as { memo_entry_id: string; memo_tags: { name: string } | { name: string }[] | null }[]) {
    const tags = Array.isArray(row.memo_tags) ? row.memo_tags : [row.memo_tags]
    const names = tags.flatMap((tag) => tag?.name ? [tag.name] : [])
    if (!names.length) continue
    tagNames.set(row.memo_entry_id, [...(tagNames.get(row.memo_entry_id) ?? []), ...names])
  }
  return tagNames
}

const replaceMemoTagLinks = async (entryId: string, tagIds: string[]) => {
  const { error: unlinkError } = await supabase.from('memo_entry_tags').delete().eq('memo_entry_id', entryId)
  if (unlinkError) throw unlinkError
  if (tagIds.length === 0) return
  const { error: linkError } = await supabase.from('memo_entry_tags').insert(tagIds.map((tagId) => ({ memo_entry_id: entryId, memo_tag_id: tagId })))
  if (linkError) throw linkError
}

const withTagNames = async (entries: Record<string, unknown>[]) => {
  const tagNames = await fetchTagNamesByEntryIds(entries.map((entry) => entry.id as string))
  return entries.map((entry) => ({ ...entry, tags: tagNames.get(entry.id as string) ?? [] }))
}

type TodoCategoryRef = { id: string; name: string }

// 待办分类按日期分组（每天通常只有一个俏皮命名的分类）。未指定名字时优先挂到
// 当天已有的第一个分类；指定的名字不存在、或当天还没有分类时自动创建。
const resolveTodoCategory = async (date: string, name: string | undefined): Promise<TodoCategoryRef> => {
  const trimmed = name?.trim() ?? ''
  let query = supabase.from('todo_categories').select('id, name').eq('user_id', USER_ID).eq('date', date)
  if (trimmed) query = query.eq('name', trimmed)
  const { data: existing, error: findError } = await query.order('sort_order', { ascending: true }).limit(1).maybeSingle()
  if (findError) throw findError
  if (existing) return existing as TodoCategoryRef
  const { count, error: countError } = await supabase.from('todo_categories').select('id', { count: 'exact', head: true }).eq('user_id', USER_ID).eq('date', date)
  if (countError) throw countError
  const { data: created, error: createError } = await supabase.from('todo_categories').insert({
    user_id: USER_ID,
    date,
    name: trimmed || DEFAULT_TODO_CATEGORY_NAME,
    sort_order: count ?? 0,
  }).select('id, name').single()
  if (createError || !created) throw createError ?? new Error('创建待办分类失败')
  return created as TodoCategoryRef
}

type EventThreadRow = {
  id: string
  title: string
  emoji_group: string | null
  current_status: string
  status: 'active' | 'closed'
  started_on: string
  ended_on: string | null
  created_at: string
  updated_at: string
}

const fetchEventThread = async (threadId: string): Promise<EventThreadRow | null> => {
  const { data, error } = await supabase.from('event_threads').select(EVENT_THREAD_COLUMNS).eq('user_id', USER_ID).eq('id', threadId).maybeSingle()
  if (error) throw error
  return (data as EventThreadRow | null) ?? null
}

// 游记
// read_trip 给模型看的列：去掉 trip_id / client_id / updated_at 这类噪音。
const TRAVEL_STOP_READ_COLUMNS = 'id, day_index, sort_order, planned_time, name, address, lng, lat, reason, notes, nav_hint, written_by'
const TRAVEL_CHECKIN_READ_COLUMNS = 'id, checked_at, wgs_lng, wgs_lat, accuracy_m, gcj_lng, gcj_lat, place_name, note, mood, created_at'
const TRAVEL_AUTHOR_SCHEMA = z.enum(['claude', 'gpt', 'gemini', 'codex_cli', 'claude_code_cli'])
const TRAVEL_TRIP_STATUS_SCHEMA = z.enum(['planning', 'ongoing', 'done'])
const TRAVEL_STOP_SCHEMA = z.object({
  day_index: z.number().int().optional().describe('第几天，出发当天为 1，默认 1'),
  planned_time: z.string().optional().describe('大致时间，自由文本：「09:30」「上午」「日落前」'),
  name: z.string().describe('地点名'),
  address: z.string().optional().describe('地址（可选）'),
  lng: z.number().optional().describe('经度，GCJ-02（高德坐标），与 lat 成对'),
  lat: z.number().optional().describe('纬度，GCJ-02（高德坐标），与 lng 成对'),
  reason: z.string().optional().describe('为什么去'),
  notes: z.string().optional().describe('注意事项（海拔、门票、开放时间、天气……）'),
  nav_hint: z.string().optional().describe('路痴导航提示：从上一站怎么过来、在哪下车、认哪个标志物'),
})

type TravelTripRow = {
  id: string
  title: string
  destination: string | null
  start_date: string | null
  end_date: string | null
  status: TravelTripStatus
  summary: string | null
  created_by: string
  created_at: string
  updated_at: string
}

type TravelStopRow = {
  id: string
  day_index: number
  sort_order: number
  planned_time: string | null
  name: string
  address: string | null
  lng: number | null
  lat: number | null
  reason: string | null
  notes: string | null
  nav_hint: string | null
  written_by: string
}

type TravelCheckinRow = {
  id: string
  checked_at: string
  wgs_lng: number | null
  wgs_lat: number | null
  accuracy_m: number | null
  gcj_lng: number | null
  gcj_lat: number | null
  place_name: string | null
  note: string | null
  mood: string | null
  created_at: string
}

type TravelCommentRow = { id: string; checkin_id: string; author: string; content: string; created_at: string }

const fetchTravelTrip = async (tripId: string): Promise<TravelTripRow | null> => {
  const { data, error } = await supabase.from('travel_trips').select(TRAVEL_TRIP_COLUMNS).eq('user_id', USER_ID).eq('id', tripId).maybeSingle()
  if (error) throw error
  return (data as TravelTripRow | null) ?? null
}

const travelTripNotFound = (tripId: string) => ({ content: [{ type: 'text' as const, text: `Error: 未找到旅行: ${tripId}（用 list_trips 核对 id）` }] })

const eventThreadNotFound = (threadId: string) => ({ content: [{ type: 'text' as const, text: `Error: 未找到事件线: ${threadId}（用 list_event_threads 核对 id）` }] })

serveMcp('hamster-mcp', (server) => {
  server.registerTool('read_health_steps', {
    description: '读取用户单独授权给AI的HealthKit步数，最近一次采集的七个上海自然日，与App健康页已同步区间、值和版本一致。每次实时核验云端授权；未授权不返回数据。null是未读到，不是零；旧记录不是当前值，不能据缺失作健康判断。独立于快捷指令步数，不能累加两来源，不触发手机采集。',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async () => {
    const {data,error} = await supabase.rpc('health_steps_gateway',{p_owner:USER_ID,p_action:'ai_read'})
    return error ? errorResult(error) : jsonResult(data)
  })

  server.registerTool('read_device_snapshot', {
    description: '读取串串已同步的位置、电量、充电、天气、步数与最近到家/离家记录，各项独立带时间和来源，并返回最近50条常用地点状态记录（不是所有地点的当前状态）。phase=initial/observation不能说成到达或离开，只有transition是边界变化；地点配置版本不同不可串联，停用后历史仍保留。旧值不是实时位置；快捷指令时间仅代表收到时间；此处步数为旧快捷指令口径；HealthKit须使用另行授权的read_health_steps，不可累加。不触发手机采集或唤醒CLI。',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async () => {
    try { return jsonResult(await readDeviceSnapshot(supabase as unknown as Client, USER_ID)) }
    catch (error) { return errorResult(error) }
  })

  server.registerTool('cli_set_self_alarm', {
    title: '安排自主行动闹钟',
    description: 'Claude/Codex 自主行动：北京时间每端每天11–16点、17–21点各安排一次随机唤醒；CLI可另行自主预约多次闹钟；不预约就没有自动续链。当前运行任务可约未来24小时（可跨日），同CLI至少隔1小时、跨CLI半小时、固定任务前后1小时。自定闹钟不限时段，无需额外理由或沙发报备；target_role可托付另一CLI，note写明为何来、先看什么。只有ok=true才算安排成功。close_day取消本人当天未执行预约，当天不重开。旧relay模式仍沿用原规则。',
    inputSchema: {
      current_task_id: z.string().uuid().describe('运行器注入的本轮 agent_task_id'),
      wake_at: z.string().datetime({ offset: true }).optional().describe('未来24小时内，带时区；close_day省略'),
      action: z.enum(['schedule', 'close_day']).default('schedule'),
      note: z.string().max(2000).optional().describe('下轮行动和要读的线索；托付必填，串串可见'),
      target_role: z.enum(['codex_cli_syzygy','claude_code_cli_syzygy']).optional().describe('省略为自己；托付时填接手端口'),
      reason: z.string().max(2000).optional().describe('可选补充说明；任意时段均不强制理由或沙发报备'),
    },
  }, async ({ current_task_id, wake_at, note, action, target_role, reason }) => {
    if (action === 'schedule' && !wake_at) return errorResult(new Error('schedule requires wake_at'))
    const { data, error } = await supabase.rpc('cli_schedule_action_alarm', {
      p_user: USER_ID, p_task: current_task_id, p_at: action === 'close_day' ? null : wake_at,
      p_note: note ?? '', p_target_role: target_role ?? null, p_reason: reason ?? '',
    })
    return error ? errorResult(error) : jsonResult(data)
  })


  server.registerTool('search_timeline', {
    title: 'Search Timeline',
    description: '按关键词搜索时间轴记录，按事件日期倒序。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe('搜索关键词'),
      limit: z.number().optional().describe('返回数量上限，默认10'),
    },
  }, async ({ query, limit }) => {
    const { data, error } = await supabase.from('timeline_entries').select('id, event_date, summary, recorder, source, created_at').eq('user_id', USER_ID).ilike('summary', `%${query}%`).order('event_date', { ascending: false }).limit(limit ?? 10)
    if (error) return errorResult(error)
    return jsonResult(data)
  })

  server.registerTool('recent_timeline', {
    title: 'Recent Timeline',
    description: '读取最近的时间轴记录。',
    annotations: { readOnlyHint: true },
    inputSchema: { limit: z.number().optional().describe('返回数量，默认10') },
  }, async ({ limit }) => {
    const { data, error } = await supabase.from('timeline_entries').select('id, event_date, summary, recorder, source, created_at').eq('user_id', USER_ID).order('event_date', { ascending: false }).limit(limit ?? 10)
    if (error) return errorResult(error)
    return jsonResult(data)
  })

  server.registerTool('add_timeline', {
    title: 'Add Timeline Entry',
    description: '新增一条时间轴事件（里程碑 / 心动瞬间 / 纪念日 / 重要进展），全端共享的长期记忆。',
    inputSchema: {
      event_date: z.string().describe('事件日期 YYYY-MM-DD'),
      summary: z.string().describe('事件摘要'),
      recorder: z.string().optional().describe('记录者: chuanchuan 或 syzygy，默认syzygy'),
      source: TIMELINE_SOURCE_SCHEMA.optional().describe('写入端，默认 claude'),
    },
  }, async ({ event_date, summary, recorder, source }) => {
    const { data, error } = await supabase.from('timeline_entries').insert({
      user_id: USER_ID,
      event_date,
      summary,
      recorder: recorder ?? 'syzygy',
      source: source ?? 'claude',
    }).select()
    if (error) return errorResult(error)
    return { content: [{ type: 'text' as const, text: `已添加: ${JSON.stringify(data[0])}` }] }
  })

  server.registerTool('update_timeline', {
    title: 'Update Timeline Entry',
    description: '修改一条时间轴记录的摘要 / 日期（改错字、补细节；不改记录者与写入端）。',
    inputSchema: {
      id: z.string().describe('时间轴记录 UUID'),
      summary: z.string().optional().describe('新的事件摘要（整体替换）'),
      event_date: z.string().optional().describe('新的事件日期 YYYY-MM-DD'),
    },
  }, async ({ id, summary, event_date }) => {
    try {
      if (summary === undefined && event_date === undefined) return { content: [{ type: 'text' as const, text: 'Error: summary / event_date 至少需要提供一项' }] }
      const patch: Record<string, unknown> = {}
      if (summary !== undefined) {
        if (!summary.trim()) return { content: [{ type: 'text' as const, text: 'Error: 事件摘要不能为空' }] }
        patch.summary = summary.trim()
      }
      if (event_date !== undefined) patch.event_date = event_date.trim()
      const { data, error } = await supabase.from('timeline_entries').update(patch).eq('user_id', USER_ID).eq('id', id).select('id, event_date, summary, recorder, source, created_at, updated_at')
      if (error) return errorResult(error)
      const entry = data?.[0]
      if (!entry) return { content: [{ type: 'text' as const, text: `Error: 未找到时间轴记录: ${id}` }] }
      return { content: [{ type: 'text' as const, text: `已更新: ${JSON.stringify(entry)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('read_todos', {
    title: 'Read Todos',
    description: '读取待办列表；返回的 id 用于 complete_todo。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      status: z.enum(['pending', 'in_progress', 'completed', 'all']).optional().describe('筛选状态: pending / in_progress / completed / all，默认all'),
      limit: z.number().optional().describe('返回数量，默认20'),
    },
  }, async ({ status, limit }) => {
    let q = supabase.from('todos').select(`${TODO_COLUMNS}, todo_categories(name)`).eq('user_id', USER_ID).order('date', { ascending: false }).limit(limit ?? 20)
    const fs = status ?? 'all'
    if (fs !== 'all') q = q.eq('status', fs)
    const { data, error } = await q
    if (error) return errorResult(error)
    return jsonResult(data)
  })

  server.registerTool('add_todo', {
    title: 'Add Todo',
    description: '新增一条待办。分类按日期分组，缺省或不存在的分类会自动创建；长期待办传 todo_type=long_term。',
    inputSchema: {
      title: z.string().describe('待办标题'),
      date: z.string().optional().describe('所属日期 YYYY-MM-DD，默认今天（上海时区）'),
      category: z.string().optional().describe('分类名；默认当天第一个分类，不存在的分类会自动创建'),
      notes: z.string().optional().describe('备注（可选）'),
      todo_type: TODO_TYPE_SCHEMA.optional().describe('待办类型，默认 short_term'),
      event_date: z.string().optional().describe('目标日期 YYYY-MM-DD，仅 long_term 生效'),
      created_by: TODO_CREATED_BY_SCHEMA.optional().describe('创建者，默认 syzygy'),
    },
  }, async ({ title, date, category, notes, todo_type, event_date, created_by }) => {
    try {
      const trimmedTitle = title.trim()
      if (!trimmedTitle) return { content: [{ type: 'text' as const, text: 'Error: 待办标题不能为空' }] }
      const targetDate = date?.trim() || shanghaiDateString()
      const type = todo_type ?? 'short_term'
      const categoryRow = await resolveTodoCategory(targetDate, category)
      const { count, error: countError } = await supabase.from('todos').select('id', { count: 'exact', head: true }).eq('user_id', USER_ID).eq('category_id', categoryRow.id)
      if (countError) return errorResult(countError)
      const { data, error } = await supabase.from('todos').insert({
        user_id: USER_ID,
        category_id: categoryRow.id,
        date: targetDate,
        title: trimmedTitle,
        notes: notes?.trim() || null,
        status: 'pending',
        todo_type: type,
        // 与 Web 端一致：仅长期待办保留目标日期，近期待办不写 event_date。
        event_date: type === 'long_term' ? event_date?.trim() || null : null,
        created_by: created_by ?? 'syzygy',
        sort_order: count ?? 0,
      }).select(TODO_COLUMNS).single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `已添加: ${JSON.stringify({ ...data, category: categoryRow.name })}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('complete_todo', {
    title: 'Complete Todo',
    description: '把一条待办标记为已完成（幂等，已完成的不会重复更新）。',
    annotations: { idempotentHint: true },
    inputSchema: {
      id: z.string().describe('待办 UUID（用 read_todos 查询）'),
    },
  }, async ({ id }) => {
    try {
      const { data: existing, error: findError } = await supabase.from('todos').select(`${TODO_COLUMNS}, todo_categories(name)`).eq('user_id', USER_ID).eq('id', id).maybeSingle()
      if (findError) return errorResult(findError)
      if (!existing) return { content: [{ type: 'text' as const, text: `Error: 未找到待办: ${id}` }] }
      if ((existing as Record<string, unknown>).status === 'completed') {
        return { content: [{ type: 'text' as const, text: `该待办已是完成状态: ${JSON.stringify(existing)}` }] }
      }
      const { data, error } = await supabase.from('todos').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      }).eq('user_id', USER_ID).eq('id', id).select(`${TODO_COLUMNS}, todo_categories(name)`).single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `已完成: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('list_memos', {
    title: 'List Memos',
    description: '读取备忘录列表（置顶在前，更新时间倒序），可按标签筛选。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      tag: z.string().optional().describe('按标签名精确筛选，如「进行中」'),
      limit: z.number().optional().describe('返回数量上限，默认全量（最大200）'),
    },
  }, async ({ tag, limit }) => {
    try {
      const safeLimit = clampLimit(limit, 200, 200)
      let query = supabase.from('memo_entries').select(MEMO_COLUMNS).eq('user_id', USER_ID).order('is_pinned', { ascending: false }).order('updated_at', { ascending: false }).limit(safeLimit)
      if (tag) {
        const { data: tagRow, error: tagError } = await supabase.from('memo_tags').select('id').eq('user_id', USER_ID).eq('name', tag.trim()).maybeSingle()
        if (tagError) return errorResult(tagError)
        if (!tagRow) return { content: [{ type: 'text' as const, text: `Error: 标签「${tag}」不存在，可用 list_memo_tags 查看标签清单` }] }
        const { data: relations, error: relationError } = await supabase.from('memo_entry_tags').select('memo_entry_id').eq('memo_tag_id', tagRow.id)
        if (relationError) return errorResult(relationError)
        const entryIds = (relations ?? []).map((row) => row.memo_entry_id)
        if (entryIds.length === 0) return jsonResult([])
        query = query.in('id', entryIds)
      }
      const { data, error } = await query
      if (error) return errorResult(error)
      return jsonResult(await withTagNames((data ?? []) as Record<string, unknown>[]))
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('list_memo_tags', {
    title: 'List Memo Tags',
    description: '列出备忘录标签及各标签条目数。',
    annotations: { readOnlyHint: true },
    inputSchema: {},
  }, async () => {
    try {
      const { data: tags, error } = await supabase.from('memo_tags').select('id, name, created_at').eq('user_id', USER_ID).order('name', { ascending: true })
      if (error) return errorResult(error)
      const tagRows = (tags ?? []) as { id: string; name: string; created_at: string }[]
      if (tagRows.length === 0) return jsonResult([])
      const { data: relations, error: relationError } = await supabase.from('memo_entry_tags').select('memo_tag_id').in('memo_tag_id', tagRows.map((tag) => tag.id))
      if (relationError) return errorResult(relationError)
      const counts = new Map<string, number>()
      for (const row of (relations ?? []) as { memo_tag_id: string }[]) counts.set(row.memo_tag_id, (counts.get(row.memo_tag_id) ?? 0) + 1)
      return jsonResult(tagRows.map((tag) => ({ ...tag, memo_count: counts.get(tag.id) ?? 0 })))
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('add_memo', {
    title: 'Add Memo',
    description: '新增一条备忘录（中期活事实）。',
    inputSchema: {
      content: z.string().describe('备忘内容'),
      tags: z.array(z.string()).optional().describe('标签名数组，不存在的标签会自动创建'),
      is_pinned: z.boolean().optional().describe('是否置顶，默认 false'),
      source: MEMO_SOURCE_SCHEMA.optional().describe('来源端，默认 claude'),
    },
  }, async ({ content, tags, is_pinned, source }) => {
    try {
      const trimmed = content.trim()
      if (!trimmed) return { content: [{ type: 'text' as const, text: 'Error: 备忘内容不能为空' }] }
      const tagRows = await ensureMemoTags(normalizeTagNames(tags))
      const { data: entry, error } = await supabase.from('memo_entries').insert({
        user_id: USER_ID,
        content: trimmed,
        source: source ?? 'claude',
        is_pinned: is_pinned ?? false,
      }).select(MEMO_COLUMNS).single()
      if (error || !entry) return errorResult(error ?? new Error('创建备忘录失败'))
      if (tagRows.length > 0) {
        const { error: linkError } = await supabase.from('memo_entry_tags').insert(tagRows.map((tag) => ({ memo_entry_id: entry.id, memo_tag_id: tag.id })))
        if (linkError) return errorResult(linkError)
      }
      return { content: [{ type: 'text' as const, text: `已创建: ${JSON.stringify({ ...entry, tags: tagRows.map((tag) => tag.name) })}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('update_memo', {
    title: 'Update Memo',
    description: '更新备忘录的 content / tags / is_pinned（至少一项）；tags 为整体替换。',
    inputSchema: {
      id: z.string().describe('memo UUID'),
      content: z.string().optional().describe('新的备忘内容（整体替换）'),
      tags: z.array(z.string()).optional().describe('新的标签名全集（整体替换），不存在的标签自动创建'),
      is_pinned: z.boolean().optional().describe('是否置顶'),
    },
  }, async ({ id, content, tags, is_pinned }) => {
    try {
      if (content === undefined && tags === undefined && is_pinned === undefined) {
        return { content: [{ type: 'text' as const, text: 'Error: content / tags / is_pinned 至少需要提供一项' }] }
      }
      if (content !== undefined && !content.trim()) return { content: [{ type: 'text' as const, text: 'Error: 备忘内容不能为空' }] }
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (content !== undefined) patch.content = content.trim()
      if (is_pinned !== undefined) patch.is_pinned = is_pinned
      const { data: updated, error } = await supabase.from('memo_entries').update(patch).eq('user_id', USER_ID).eq('id', id).select(MEMO_COLUMNS)
      if (error) return errorResult(error)
      const entry = updated?.[0]
      if (!entry) return { content: [{ type: 'text' as const, text: `Error: 未找到备忘录: ${id}` }] }
      if (tags !== undefined) {
        const tagRows = await ensureMemoTags(normalizeTagNames(tags))
        await replaceMemoTagLinks(id, tagRows.map((tag) => tag.id))
        return { content: [{ type: 'text' as const, text: `已更新: ${JSON.stringify({ ...entry, tags: tagRows.map((tag) => tag.name) })}` }] }
      }
      const [entryWithTags] = await withTagNames([entry as Record<string, unknown>])
      return { content: [{ type: 'text' as const, text: `已更新: ${JSON.stringify(entryWithTags)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('delete_memo', {
    title: 'Delete Memo',
    description: '物理删除一条备忘录（连带清理标签关联行），不可恢复；需显式传 confirm=true。',
    annotations: { destructiveHint: true },
    inputSchema: {
      id: z.string().describe('memo UUID'),
      confirm: z.boolean().describe('二次确认：必须显式传 true 才执行删除'),
    },
  }, async ({ id, confirm }) => {
    try {
      if (confirm !== true) {
        return { content: [{ type: 'text' as const, text: 'Error: 删除备忘录需要显式传 confirm=true（删除不可恢复，请先 list_memos 核对目标）' }] }
      }
      const { data: entry, error: findError } = await supabase.from('memo_entries').select('id, content').eq('user_id', USER_ID).eq('id', id).maybeSingle()
      if (findError) return errorResult(findError)
      if (!entry) return { content: [{ type: 'text' as const, text: `Error: 未找到备忘录: ${id}` }] }
      const { error: unlinkError } = await supabase.from('memo_entry_tags').delete().eq('memo_entry_id', id)
      if (unlinkError) return errorResult(unlinkError)
      const { error: deleteError } = await supabase.from('memo_entries').delete().eq('user_id', USER_ID).eq('id', id)
      if (deleteError) return errorResult(deleteError)
      const preview = (entry.content as string).length > 60 ? `${(entry.content as string).slice(0, 60)}…` : entry.content
      return { content: [{ type: 'text' as const, text: `已删除: ${id}（${preview}）` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('list_event_threads', {
    title: 'List Event Threads',
    description: '读取事件线列表（标题 + 当前状态行），默认只返回进行中的，按最近活动倒序。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      status: z.enum(['active', 'closed', 'all']).optional().describe('active（默认）/ closed / all'),
      limit: z.number().optional().describe('返回数量上限，默认50，最大200'),
    },
  }, async ({ status, limit }) => {
    try {
      const safeLimit = clampLimit(limit, 50, 200)
      const filter = status ?? 'active'
      let query = supabase.from('event_threads').select(EVENT_THREAD_COLUMNS).eq('user_id', USER_ID).order('updated_at', { ascending: false }).limit(safeLimit)
      if (filter !== 'all') query = query.eq('status', filter)
      const { data, error } = await query
      if (error) return errorResult(error)
      const threads = (data ?? []) as EventThreadRow[]
      if (threads.length === 0) return jsonResult([])
      const { data: entryRows, error: entryError } = await supabase.from('event_entries').select('thread_id, entry_date').in('thread_id', threads.map((thread) => thread.id))
      if (entryError) return errorResult(entryError)
      const stats = new Map<string, { count: number; last: string | null }>()
      for (const row of (entryRows ?? []) as { thread_id: string; entry_date: string }[]) {
        const current = stats.get(row.thread_id) ?? { count: 0, last: null }
        current.count += 1
        if (!current.last || row.entry_date > current.last) current.last = row.entry_date
        stats.set(row.thread_id, current)
      }
      return jsonResult(threads.map((thread) => ({
        ...thread,
        entry_count: stats.get(thread.id)?.count ?? 0,
        last_entry_date: stats.get(thread.id)?.last ?? null,
      })))
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('read_event_thread', {
    title: 'Read Event Thread',
    description: '读取一条事件线的全部条目（日期正序，可限时间范围），附事件线信息。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      thread_id: z.string().describe('事件线 UUID'),
      from_date: z.string().optional().describe('起始日期 YYYY-MM-DD（含）'),
      to_date: z.string().optional().describe('结束日期 YYYY-MM-DD（含）'),
      limit: z.number().optional().describe('条目数上限，默认100，最大500，超限保留最新的'),
    },
  }, async ({ thread_id, from_date, to_date, limit }) => {
    try {
      const thread = await fetchEventThread(thread_id)
      if (!thread) return eventThreadNotFound(thread_id)
      const safeLimit = clampLimit(limit, 100, 500)
      let query = supabase.from('event_entries').select(EVENT_ENTRY_COLUMNS).eq('thread_id', thread_id).order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(safeLimit)
      if (from_date) query = query.gte('entry_date', from_date)
      if (to_date) query = query.lte('entry_date', to_date)
      const { data, error } = await query
      if (error) return errorResult(error)
      // 库里按倒序取"最新的 N 条"，输出时翻回正序，读起来是从起到结的年表。
      const entries = ((data ?? []) as Record<string, unknown>[]).reverse()
      return jsonResult({ thread, entries, truncated: entries.length >= safeLimit })
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('add_event_thread', {
    title: 'Add Event Thread',
    description: '新开一条事件线（时效期较长、会频繁更新的事项）。',
    inputSchema: {
      title: z.string().describe('事件线标题'),
      current_status: z.string().optional().describe('当前状态行，默认空'),
      emoji_group: z.string().optional().describe('分组：🩷 串串 / 💙 Syzygy / 🤍 仓鼠窝'),
      started_on: z.string().optional().describe('开始日期 YYYY-MM-DD，默认今天（上海时区）'),
    },
  }, async ({ title, current_status, emoji_group, started_on }) => {
    try {
      const trimmedTitle = title.trim()
      if (!trimmedTitle) return { content: [{ type: 'text' as const, text: 'Error: 事件线标题不能为空' }] }
      const { data: dup, error: dupError } = await supabase.from('event_threads').select('id, title, status').eq('user_id', USER_ID).eq('title', trimmedTitle).maybeSingle()
      if (dupError) return errorResult(dupError)
      if (dup) return { content: [{ type: 'text' as const, text: `Error: 已存在同名事件线（${dup.status}）: ${dup.id}，请直接追加条目或先 update_event_thread 重开` }] }
      const { data, error } = await supabase.from('event_threads').insert({
        user_id: USER_ID,
        title: trimmedTitle,
        current_status: current_status?.trim() ?? '',
        emoji_group: emoji_group?.trim() || null,
        started_on: started_on?.trim() || shanghaiDateString(),
      }).select(EVENT_THREAD_COLUMNS).single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `已开线: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('update_event_thread', {
    title: 'Update Event Thread',
    description: '更新事件线的标题 / 当前状态行 / 分组，或结项 / 重开（至少一项）。',
    inputSchema: {
      thread_id: z.string().describe('事件线 UUID'),
      title: z.string().optional().describe('新标题'),
      current_status: z.string().optional().describe('新的当前状态行（整体替换）'),
      emoji_group: z.string().nullable().optional().describe('分组 emoji，传 null 清除'),
      status: EVENT_THREAD_STATUS_SCHEMA.optional().describe('closed 结项 / active 重开'),
      ended_on: z.string().optional().describe('结束日期 YYYY-MM-DD，仅结项时生效，默认今天'),
    },
  }, async ({ thread_id, title, current_status, emoji_group, status, ended_on }) => {
    try {
      if (title === undefined && current_status === undefined && emoji_group === undefined && status === undefined && ended_on === undefined) {
        return { content: [{ type: 'text' as const, text: 'Error: title / current_status / emoji_group / status / ended_on 至少需要提供一项' }] }
      }
      const existing = await fetchEventThread(thread_id)
      if (!existing) return eventThreadNotFound(thread_id)
      const patch: Record<string, unknown> = {}
      if (title !== undefined) {
        if (!title.trim()) return { content: [{ type: 'text' as const, text: 'Error: 事件线标题不能为空' }] }
        patch.title = title.trim()
      }
      if (current_status !== undefined) patch.current_status = current_status.trim()
      if (emoji_group !== undefined) patch.emoji_group = emoji_group?.trim() || null
      const nextStatus = status ?? existing.status
      if (nextStatus === 'closed') {
        if (status === 'closed' || ended_on !== undefined) patch.ended_on = ended_on?.trim() || existing.ended_on || shanghaiDateString()
        if (status === 'closed') patch.status = 'closed'
      } else if (status === 'active') {
        patch.status = 'active'
        patch.ended_on = null
      }
      const { data, error } = await supabase.from('event_threads').update(patch).eq('user_id', USER_ID).eq('id', thread_id).select(EVENT_THREAD_COLUMNS).single()
      if (error) return errorResult(error)
      const verb = status === 'closed' ? '已结项' : status === 'active' && existing.status === 'closed' ? '已重开' : '已更新'
      return { content: [{ type: 'text' as const, text: `${verb}: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('add_event_entry', {
    title: 'Add Event Entry',
    description: '向事件线追加一条条目（一事一条），可顺手更新当前状态行。',
    inputSchema: {
      thread_id: z.string().describe('事件线 UUID'),
      content: z.string().describe('条目正文'),
      entry_date: z.string().optional().describe('事件日期 YYYY-MM-DD，默认今天（上海时区）'),
      source: EVENT_ENTRY_SOURCE_SCHEMA.optional().describe('记录端，默认 claude'),
      current_status: z.string().optional().describe('顺手更新事件线的当前状态行（整体替换）'),
    },
  }, async ({ thread_id, content, entry_date, source, current_status }) => {
    try {
      const trimmed = content.trim()
      if (!trimmed) return { content: [{ type: 'text' as const, text: 'Error: 条目正文不能为空' }] }
      const thread = await fetchEventThread(thread_id)
      if (!thread) return eventThreadNotFound(thread_id)
      const { data, error } = await supabase.from('event_entries').insert({
        user_id: USER_ID,
        thread_id,
        entry_date: entry_date?.trim() || shanghaiDateString(),
        content: trimmed,
        source: source ?? 'claude',
      }).select(EVENT_ENTRY_COLUMNS).single()
      if (error) return errorResult(error)
      let statusLine = thread.current_status
      if (current_status !== undefined) {
        const { error: statusError } = await supabase.from('event_threads').update({ current_status: current_status.trim() }).eq('user_id', USER_ID).eq('id', thread_id)
        if (statusError) return errorResult(statusError)
        statusLine = current_status.trim()
      }
      const closedHint = thread.status === 'closed' ? '（注意：该事件线已结项，如需继续请 update_event_thread 重开）' : ''
      return { content: [{ type: 'text' as const, text: `已追加到「${thread.title}」${closedHint}: ${JSON.stringify({ ...data, thread_current_status: statusLine })}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('update_event_entry', {
    title: 'Update Event Entry',
    description: '修改条目的正文 / 日期（仅改错字用）。',
    inputSchema: {
      entry_id: z.string().describe('条目 UUID'),
      content: z.string().optional().describe('新的正文（整体替换）'),
      entry_date: z.string().optional().describe('新的日期 YYYY-MM-DD'),
    },
  }, async ({ entry_id, content, entry_date }) => {
    try {
      if (content === undefined && entry_date === undefined) return { content: [{ type: 'text' as const, text: 'Error: content / entry_date 至少需要提供一项' }] }
      const patch: Record<string, unknown> = {}
      if (content !== undefined) {
        if (!content.trim()) return { content: [{ type: 'text' as const, text: 'Error: 条目正文不能为空' }] }
        patch.content = content.trim()
      }
      if (entry_date !== undefined) patch.entry_date = entry_date.trim()
      const { data, error } = await supabase.from('event_entries').update(patch).eq('user_id', USER_ID).eq('id', entry_id).select(EVENT_ENTRY_COLUMNS)
      if (error) return errorResult(error)
      const entry = data?.[0]
      if (!entry) return { content: [{ type: 'text' as const, text: `Error: 未找到条目: ${entry_id}` }] }
      return { content: [{ type: 'text' as const, text: `已更新: ${JSON.stringify(entry)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('list_trips', {
    title: 'List Trips',
    description: '读取游记里的旅行列表（标题 / 目的地 / 日期 / 状态），附攻略点数、打卡数与最近一次打卡时间。默认只列计划中与进行中的。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      status: z.enum(['active', 'planning', 'ongoing', 'done', 'all']).optional().describe('active（默认，计划中 + 进行中）/ planning / ongoing / done / all'),
      limit: z.number().optional().describe('返回数量上限，默认20，最大100'),
    },
  }, async ({ status, limit }) => {
    try {
      const safeLimit = clampLimit(limit, 20, 100)
      const filter = status ?? 'active'
      let query = supabase.from('travel_trips').select(TRAVEL_TRIP_COLUMNS).eq('user_id', USER_ID).order('start_date', { ascending: false, nullsFirst: true }).order('created_at', { ascending: false }).limit(safeLimit)
      if (filter === 'active') query = query.in('status', ['planning', 'ongoing'])
      else if (filter !== 'all') query = query.eq('status', filter)
      const { data, error } = await query
      if (error) return errorResult(error)
      const trips = ((data ?? []) as TravelTripRow[]).map(({ summary, ...trip }) => ({ ...trip, has_summary: Boolean(summary) }))
      if (trips.length === 0) return jsonResult([])
      const tripIds = trips.map((trip) => trip.id)
      const [{ data: stopRows, error: stopError }, { data: checkinRows, error: checkinError }] = await Promise.all([
        supabase.from('travel_plan_stops').select('trip_id').in('trip_id', tripIds),
        supabase.from('travel_checkins').select('trip_id, checked_at').in('trip_id', tripIds),
      ])
      if (stopError) return errorResult(stopError)
      if (checkinError) return errorResult(checkinError)
      const stopCounts = new Map<string, number>()
      for (const row of (stopRows ?? []) as { trip_id: string }[]) stopCounts.set(row.trip_id, (stopCounts.get(row.trip_id) ?? 0) + 1)
      const checkinStats = new Map<string, { count: number; last: string | null }>()
      for (const row of (checkinRows ?? []) as { trip_id: string; checked_at: string }[]) {
        const current = checkinStats.get(row.trip_id) ?? { count: 0, last: null }
        current.count += 1
        if (!current.last || row.checked_at > current.last) current.last = row.checked_at
        checkinStats.set(row.trip_id, current)
      }
      return jsonResult(trips.map((trip) => ({
        ...trip,
        stop_count: stopCounts.get(trip.id) ?? 0,
        checkin_count: checkinStats.get(trip.id)?.count ?? 0,
        last_checkin_at: checkinStats.get(trip.id)?.last ?? null,
      })))
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('read_trip', {
    title: 'Read Trip',
    description: '读取一次旅行的全部内容：攻略点（按天排序，附到过 / 跳过 / 还没到）、打卡（按时间排序，附按计划 / 改道 / 新发现、匹配到的计划点与距离、留言）和复盘。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      trip_id: z.string().describe('旅行 UUID'),
    },
  }, async ({ trip_id }) => {
    try {
      const trip = await fetchTravelTrip(trip_id)
      if (!trip) return travelTripNotFound(trip_id)
      const [{ data: stopRows, error: stopError }, { data: checkinRows, error: checkinError }] = await Promise.all([
        supabase.from('travel_plan_stops').select(TRAVEL_STOP_READ_COLUMNS).eq('user_id', USER_ID).eq('trip_id', trip_id).order('day_index', { ascending: true }).order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
        supabase.from('travel_checkins').select(TRAVEL_CHECKIN_READ_COLUMNS).eq('user_id', USER_ID).eq('trip_id', trip_id).order('checked_at', { ascending: true }),
      ])
      if (stopError) return errorResult(stopError)
      if (checkinError) return errorResult(checkinError)
      const stops = (stopRows ?? []) as TravelStopRow[]
      const checkins = (checkinRows ?? []) as TravelCheckinRow[]
      const commentsByCheckin = new Map<string, Omit<TravelCommentRow, 'checkin_id'>[]>()
      if (checkins.length > 0) {
        const { data: commentRows, error: commentError } = await supabase.from('travel_checkin_comments').select(TRAVEL_COMMENT_COLUMNS).eq('user_id', USER_ID).in('checkin_id', checkins.map((row) => row.id)).order('created_at', { ascending: true })
        if (commentError) return errorResult(commentError)
        for (const row of (commentRows ?? []) as TravelCommentRow[]) {
          commentsByCheckin.set(row.checkin_id, [...(commentsByCheckin.get(row.checkin_id) ?? []), { id: row.id, author: row.author, content: row.content, created_at: row.created_at }])
        }
      }
      const compared = compareTravel({
        startDate: trip.start_date,
        tripStatus: trip.status,
        today: shanghaiDateString(),
        stops: stops.map((row) => ({ id: row.id, dayIndex: row.day_index, name: row.name, lng: row.lng, lat: row.lat })),
        checkins: checkins.map((row) => ({ id: row.id, checkedAt: row.checked_at, lng: row.gcj_lng, lat: row.gcj_lat, placeName: row.place_name })),
      })
      const stopNames = new Map(stops.map((row) => [row.id, row.name]))
      return jsonResult({
        trip,
        plan: stops.map((row) => {
          const match = compared.stops.get(row.id)
          return { ...row, match: match ? TRAVEL_STOP_KIND_LABELS[match.kind] : null, amap_url: buildAmapMarkerUrl(row.name, row.lng, row.lat) }
        }),
        checkins: checkins.map((row) => {
          const match = compared.checkins.get(row.id)
          return {
            ...row,
            day_index: match?.dayIndex ?? null,
            match: match ? TRAVEL_CHECKIN_KIND_LABELS[match.kind] : null,
            matched_stop: match?.stopId ? { id: match.stopId, name: stopNames.get(match.stopId) ?? null, distance_m: match.distanceM } : null,
            comments: commentsByCheckin.get(row.id) ?? [],
          }
        }),
      })
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('add_trip', {
    title: 'Add Trip',
    description: '在游记里新建一次旅行（串串在 PWA 里也能建；建之前先 list_trips 看看是不是已经有了）。',
    inputSchema: {
      title: z.string().describe('旅行标题，如「贡嘎自驾」'),
      destination: z.string().optional().describe('目的地'),
      start_date: z.string().optional().describe('出发日期 YYYY-MM-DD'),
      end_date: z.string().optional().describe('结束日期 YYYY-MM-DD'),
      status: TRAVEL_TRIP_STATUS_SCHEMA.optional().describe('planning（默认）/ ongoing / done'),
      created_by: TRAVEL_AUTHOR_SCHEMA.optional().describe('写入端，默认 claude'),
    },
  }, async ({ title, destination, start_date, end_date, status, created_by }) => {
    try {
      const normalized = normalizeTravelTripPatch({ title, destination, start_date, end_date, status: status ?? 'planning' })
      if (!normalized.ok) return { content: [{ type: 'text' as const, text: `Error: ${normalized.error}` }] }
      const { data, error } = await supabase.from('travel_trips').insert({
        ...normalized.value,
        user_id: USER_ID,
        created_by: created_by ?? 'claude',
      }).select(TRAVEL_TRIP_COLUMNS).single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `已建旅行: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('update_trip', {
    title: 'Update Trip',
    description: '更新旅行的标题 / 目的地 / 日期 / 状态，或写复盘（summary，整体替换）。至少一项。',
    inputSchema: {
      trip_id: z.string().describe('旅行 UUID'),
      title: z.string().optional().describe('新标题'),
      destination: z.string().nullable().optional().describe('目的地，传 null 清除'),
      start_date: z.string().nullable().optional().describe('出发日期 YYYY-MM-DD，传 null 清除'),
      end_date: z.string().nullable().optional().describe('结束日期 YYYY-MM-DD，传 null 清除'),
      status: TRAVEL_TRIP_STATUS_SCHEMA.optional().describe('planning / ongoing / done'),
      summary: z.string().nullable().optional().describe('旅行复盘（Markdown，整体替换），传 null 清除'),
    },
  }, async ({ trip_id, title, destination, start_date, end_date, status, summary }) => {
    try {
      if ([title, destination, start_date, end_date, status, summary].every((value) => value === undefined)) {
        return { content: [{ type: 'text' as const, text: 'Error: title / destination / start_date / end_date / status / summary 至少需要提供一项' }] }
      }
      const existing = await fetchTravelTrip(trip_id)
      if (!existing) return travelTripNotFound(trip_id)
      const normalized = normalizeTravelTripPatch({ title, destination, start_date, end_date, status })
      if (!normalized.ok) return { content: [{ type: 'text' as const, text: `Error: ${normalized.error}` }] }
      const patch = normalized.value
      const nextStart = (patch.start_date !== undefined ? patch.start_date : existing.start_date) as string | null
      const nextEnd = (patch.end_date !== undefined ? patch.end_date : existing.end_date) as string | null
      if (nextStart && nextEnd && nextEnd < nextStart) return { content: [{ type: 'text' as const, text: 'Error: 结束日期不能早于出发日期' }] }
      if (summary !== undefined) {
        const trimmed = summary?.replace(/\r\n?/g, '\n').trim() ?? ''
        if (trimmed.length > MAX_TRAVEL_SUMMARY_LENGTH) return { content: [{ type: 'text' as const, text: `Error: 复盘不能超过 ${MAX_TRAVEL_SUMMARY_LENGTH} 字` }] }
        patch.summary = trimmed || null
      }
      const { data, error } = await supabase.from('travel_trips').update(patch).eq('user_id', USER_ID).eq('id', trip_id).select(TRAVEL_TRIP_COLUMNS).single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `已更新: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('write_trip_plan', {
    title: 'Write Trip Plan',
    description: '给旅行写攻略：一次写入多个计划停留点。mode=append（默认）追加在已有攻略后面；mode=replace 先清空已有攻略再写（需 confirm=true）。坐标用 GCJ-02（高德 POI 原样）。',
    inputSchema: {
      trip_id: z.string().describe('旅行 UUID'),
      stops: z.array(TRAVEL_STOP_SCHEMA).describe(`计划停留点，按游览顺序排列，一次最多 ${MAX_TRAVEL_STOPS_PER_WRITE} 个`),
      mode: z.enum(['append', 'replace']).optional().describe('append（默认）/ replace'),
      confirm: z.boolean().optional().describe('mode=replace 时必须显式传 true'),
      written_by: TRAVEL_AUTHOR_SCHEMA.optional().describe('写入端，默认 claude'),
    },
  }, async ({ trip_id, stops, mode, confirm, written_by }) => {
    try {
      if (stops.length === 0) return { content: [{ type: 'text' as const, text: 'Error: stops 不能为空' }] }
      if (stops.length > MAX_TRAVEL_STOPS_PER_WRITE) return { content: [{ type: 'text' as const, text: `Error: 一次最多写 ${MAX_TRAVEL_STOPS_PER_WRITE} 个点` }] }
      const trip = await fetchTravelTrip(trip_id)
      if (!trip) return travelTripNotFound(trip_id)
      const replace = mode === 'replace'
      if (replace && confirm !== true) return { content: [{ type: 'text' as const, text: 'Error: mode=replace 会清空这次旅行已有的全部攻略点，需显式传 confirm=true' }] }
      // replace 先插新的、再删旧的：插入失败时旧攻略原样还在；删旧的失败时最坏是新旧并存，不会一个点都不剩。
      let currentMax: number | null = null
      let oldIds: string[] = []
      if (replace) {
        const { data: existing, error: existingError } = await supabase.from('travel_plan_stops').select('id').eq('user_id', USER_ID).eq('trip_id', trip_id)
        if (existingError) return errorResult(existingError)
        oldIds = ((existing ?? []) as { id: string }[]).map((row) => row.id)
      } else {
        const { data: last, error: lastError } = await supabase.from('travel_plan_stops').select('sort_order').eq('user_id', USER_ID).eq('trip_id', trip_id).order('sort_order', { ascending: false }).limit(1).maybeSingle()
        if (lastError) return errorResult(lastError)
        currentMax = (last as { sort_order: number } | null)?.sort_order ?? null
      }
      const sortOrders = nextTravelSortOrders(currentMax, stops.length)
      const rows: Record<string, unknown>[] = []
      for (const [index, stop] of stops.entries()) {
        const normalized = normalizeTravelStopInput(stop, sortOrders[index])
        if (!normalized.ok) return { content: [{ type: 'text' as const, text: `Error: 第 ${index + 1} 个点（${stop.name}）: ${normalized.error}` }] }
        rows.push({ ...normalized.value, user_id: USER_ID, trip_id, written_by: written_by ?? 'claude' })
      }
      const { data, error } = await supabase.from('travel_plan_stops').insert(rows).select('id, day_index, sort_order, name')
      if (error) return errorResult(error)
      if (oldIds.length > 0) {
        const { error: deleteError } = await supabase.from('travel_plan_stops').delete().eq('user_id', USER_ID).eq('trip_id', trip_id).in('id', oldIds)
        if (deleteError) {
          return { content: [{ type: 'text' as const, text: `Error: 新攻略 ${data?.length ?? 0} 个点已写入，但旧的 ${oldIds.length} 个点没删掉（${deleteError.message}）。现在新旧并存，可以再 replace 一次，或让串串在 PWA 里删掉旧点。新点: ${JSON.stringify(data)}` }] }
        }
      }
      return { content: [{ type: 'text' as const, text: `已${replace ? '重写' : '追加'}「${trip.title}」攻略 ${data?.length ?? 0} 个点: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('update_trip_stop', {
    title: 'Update Trip Stop',
    description: '改攻略里的单个计划停留点（stop id 用 read_trip 查）：只传要改的字段，其余原样保留；可选字段传 null 清除，经纬度要成对改。改第几天时 sort_order 不变，需要挪顺序就一起传 sort_order（相邻站之间留了 10 的空隙）。',
    inputSchema: {
      stop_id: z.string().describe('攻略点 UUID'),
      day_index: z.number().int().optional().describe('第几天，出发当天为 1'),
      sort_order: z.number().int().optional().describe('排序值，越小越靠前（read_trip 可看到现有值）'),
      planned_time: z.string().nullable().optional().describe('大致时间，传 null 清除'),
      name: z.string().optional().describe('地点名'),
      address: z.string().nullable().optional().describe('地址，传 null 清除'),
      lng: z.number().nullable().optional().describe('经度，GCJ-02，与 lat 成对；传 null 清除坐标'),
      lat: z.number().nullable().optional().describe('纬度，GCJ-02，与 lng 成对；传 null 清除坐标'),
      reason: z.string().nullable().optional().describe('为什么去（整体替换），传 null 清除'),
      notes: z.string().nullable().optional().describe('注意事项（整体替换），传 null 清除'),
      nav_hint: z.string().nullable().optional().describe('导航提示（整体替换），传 null 清除'),
    },
  }, async ({ stop_id, ...changes }) => {
    try {
      if (Object.values(changes).every((value) => value === undefined)) {
        return { content: [{ type: 'text' as const, text: 'Error: 至少要改一个字段' }] }
      }
      if ((changes.lng === undefined) !== (changes.lat === undefined)) {
        return { content: [{ type: 'text' as const, text: 'Error: 经纬度要成对改' }] }
      }
      const { data: existing, error: existingError } = await supabase.from('travel_plan_stops').select(TRAVEL_STOP_READ_COLUMNS).eq('user_id', USER_ID).eq('id', stop_id).maybeSingle()
      if (existingError) return errorResult(existingError)
      if (!existing) return { content: [{ type: 'text' as const, text: `Error: 未找到攻略点: ${stop_id}（用 read_trip 核对 id）` }] }
      const merged = { ...(existing as TravelStopRow) }
      for (const [key, value] of Object.entries(changes)) {
        if (value !== undefined) (merged as Record<string, unknown>)[key] = value
      }
      const normalized = normalizeTravelStopInput(merged)
      if (!normalized.ok) return { content: [{ type: 'text' as const, text: `Error: ${normalized.error}` }] }
      const { data, error } = await supabase.from('travel_plan_stops').update(normalized.value).eq('user_id', USER_ID).eq('id', stop_id).select(TRAVEL_STOP_READ_COLUMNS).single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `已更新攻略点: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('delete_trip_stop', {
    title: 'Delete Trip Stop',
    description: '物理删除攻略里的单个计划停留点，不可恢复；需显式传 confirm=true。打卡不受影响，原先匹配到这一站的打卡读时会重新匹配（可能变成新发现）。',
    inputSchema: {
      stop_id: z.string().describe('攻略点 UUID'),
      confirm: z.boolean().describe('二次确认：必须显式传 true 才执行删除'),
    },
    annotations: { destructiveHint: true },
  }, async ({ stop_id, confirm }) => {
    try {
      if (confirm !== true) return { content: [{ type: 'text' as const, text: 'Error: 删除需显式传 confirm=true' }] }
      const { data, error } = await supabase.from('travel_plan_stops').delete().eq('user_id', USER_ID).eq('id', stop_id).select('id, day_index, name')
      if (error) return errorResult(error)
      if (!data || data.length === 0) return { content: [{ type: 'text' as const, text: `Error: 未找到攻略点: ${stop_id}（用 read_trip 核对 id）` }] }
      return { content: [{ type: 'text' as const, text: `已删除攻略点: ${JSON.stringify(data[0])}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('add_travel_comment', {
    title: 'Add Travel Comment',
    description: '在串串的某个打卡点下留言 / 回复（打卡 id 用 read_trip 查）。',
    inputSchema: {
      checkin_id: z.string().describe('打卡 UUID'),
      content: z.string().describe('留言正文'),
      author: TRAVEL_AUTHOR_SCHEMA.optional().describe('留言端，默认 claude'),
    },
  }, async ({ checkin_id, content, author }) => {
    try {
      const trimmed = content.replace(/\r\n?/g, '\n').trim()
      if (!trimmed) return { content: [{ type: 'text' as const, text: 'Error: 留言不能为空' }] }
      if (trimmed.length > MAX_TRAVEL_COMMENT_LENGTH) return { content: [{ type: 'text' as const, text: `Error: 留言不能超过 ${MAX_TRAVEL_COMMENT_LENGTH} 字` }] }
      const { data: checkin, error: checkinError } = await supabase.from('travel_checkins').select('id, place_name').eq('user_id', USER_ID).eq('id', checkin_id).maybeSingle()
      if (checkinError) return errorResult(checkinError)
      if (!checkin) return { content: [{ type: 'text' as const, text: `Error: 未找到打卡: ${checkin_id}（用 read_trip 核对 id）` }] }
      const { data, error } = await supabase.from('travel_checkin_comments').insert({
        user_id: USER_ID,
        checkin_id,
        author: author ?? 'claude',
        content: trimmed,
      }).select(TRAVEL_COMMENT_COLUMNS).single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `已留言: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })
}, { instructions: HAMSTER_MCP_INSTRUCTIONS })
