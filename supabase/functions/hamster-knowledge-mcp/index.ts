import { z } from 'npm:zod@^4.1.13'
import { clampLimit, errorResult, jsonResult, serveMcp, supabase, USER_ID } from '../_shared/mcp_common.ts'
import {
  STASH_ADDERS,
  STASH_COMMENT_COLUMNS,
  STASH_FOLDER_COLUMNS,
  STASH_ITEM_COLUMNS,
  STASH_STATUSES,
  normalizeStashCommentInput,
  normalizeStashFolderInput,
  normalizeStashItemInput,
} from './stash_contract.ts'

// 学习库（/knowledge 页面）三张表都没有 user_id 列，属主由部署环境保证，查询无需按用户过滤。
const learningNodeTypes = z.enum(['concept', 'question', 'insight', 'source', 'quote', 'note', 'application'])
const learningEdgeTypes = z.enum(['association', 'derivation', 'contradiction', 'application', 'reference', 'question'])
const LEARNING_NODE_COLUMNS = 'id, folder_id, node_type, title, content, tags, metadata, created_at, updated_at'
const LEARNING_EDGE_COLUMNS = 'id, from_node_id, to_node_id, edge_type, description, strength, created_at'
const clampStrength = (strength: number) => Math.min(Math.max(Math.round(strength), 1), 5)

// 囤粮处：学习库退休后的新颊囊。folder_id 为空即「待归仓」；stash_read / stash_update 用 inbox 指代它。
const STASH_ADDER_SCHEMA = z.enum(STASH_ADDERS)
const STASH_STATUS_SCHEMA = z.enum(STASH_STATUSES)
const STASH_METADATA_SCHEMA = z.record(z.string(), z.unknown())
const textResult = (text: string) => ({ content: [{ type: 'text' as const, text }] })

// 服务器级使用说明：跨工具的共性约定统一放这里，工具描述只写"做什么"。
const KNOWLEDGE_MCP_INSTRUCTIONS = [
  '知识域三块：Wiki（长期知识条目，status 分 draft / published）、记忆档案 archives（分类树 + 条目，scope 分 chuanchuan / syzygy）、学习库（learning 节点与有向连边的图谱 + 文件夹树）。',
  '写入习惯：add 前先用对应的 search_* 查重，已有条目优先 update_* 维护；update 传入的 content / tags / metadata 均为整体替换，改前先读原值。',
  'Wiki 标签家规：写入前先 list_wiki_tags 看现有分类与标签，能复用不新造；每条 3-5 个，只选会被多条目复用的检索词（人名 / 概念 / 主题域），不造一次性描述短语，日期不进标签。',
  '学习节点 metadata 约定：question 用 status(open/exploring/resolved)+answer；application 用 project+status(idea/in_progress/done)；source 用 url+author；quote 用 origin+page；concept 用 source。',
  '囤粮处 stash_*（2026-09-18 起）：学习库已退休（表与工具原样保留，不再往里写），平时看到想留的东西一律进囤粮处。囤粮处是颊囊不是胃：格子（stash_folders，自引用树，一次只看一层）+ 粮食（stash_items：title + url / content 至少一样，不分类型，类型语义由格子承担）+ 留言。folder_id 为空即「待归仓」，拿不准放哪就不传 folder_id；stash_add 是唯一的触发型工具（冲浪 / 聊天中看到值得留的链接或内容就囤），其余按名调用。链接按归一化 url_key 去重，重复囤会原样返回已有那条而不报错，要补话用 stash_comment。吃掉（读过 / 看过 / 用过）用 stash_update 把 status 改成 eaten。',
].join('\n')

serveMcp('hamster-knowledge-mcp', (server) => {
  server.registerTool('search_wiki', {
    title: 'Search Wiki',
    description: '按关键词搜索 Wiki 条目。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe('搜索关键词'),
      limit: z.number().optional().describe('返回数量上限，默认10'),
    },
  }, async ({ query, limit }) => {
    const { data, error } = await supabase.from('wiki_entries').select('id, title, content, category, tags, status, created_at, updated_at').eq('user_id', USER_ID).or(`title.ilike.%${query}%,content.ilike.%${query}%`).order('updated_at', { ascending: false }).limit(limit ?? 10)
    if (error) return errorResult(error)
    return jsonResult(data)
  })

  server.registerTool('read_wiki', {
    title: 'Read Wiki',
    description: '读取 Wiki 条目列表（更新时间倒序）。',
    annotations: { readOnlyHint: true },
    inputSchema: { limit: z.number().optional().describe('返回数量，默认20') },
  }, async ({ limit }) => {
    const { data, error } = await supabase.from('wiki_entries').select('id, title, category, tags, status, updated_at').eq('user_id', USER_ID).order('updated_at', { ascending: false }).limit(limit ?? 20)
    if (error) return errorResult(error)
    return jsonResult(data)
  })

  server.registerTool('list_wiki_tags', {
    title: 'List Wiki Tags',
    description: '列出 Wiki 现有分类与标签及各自使用次数（按频次降序）。写入 / 改标签前先看这份清单，能复用就不新造。',
    annotations: { readOnlyHint: true },
    inputSchema: {},
  }, async () => {
    const { data, error } = await supabase.from('wiki_entries').select('category, tags').eq('user_id', USER_ID)
    if (error) return errorResult(error)
    const categoryCounts = new Map<string, number>()
    const tagCounts = new Map<string, number>()
    for (const row of (data ?? []) as { category: string; tags: string[] | null }[]) {
      categoryCounts.set(row.category, (categoryCounts.get(row.category) ?? 0) + 1)
      for (const tag of row.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
    }
    const sorted = (counts: Map<string, number>) =>
      Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }))
    return jsonResult({ categories: sorted(categoryCounts), tags: sorted(tagCounts) })
  })

  server.registerTool('add_wiki', {
    title: 'Add Wiki Entry',
    description: '新建一条 Wiki 条目，status 默认 draft。写入前先 search_wiki 查重、list_wiki_tags 看现有分类与标签。',
    inputSchema: {
      title: z.string().describe('条目标题'),
      content: z.string().describe('条目正文（Markdown）'),
      category: z.string().optional().describe('分类名称，默认「未分类」；优先复用现有分类'),
      tags: z.array(z.string()).optional().describe('标签数组，默认空；3-5 个为宜，按标签家规优先复用现有标签'),
      status: z.enum(['draft', 'published']).optional().describe('条目状态，默认 draft'),
    },
  }, async ({ title, content, category, tags, status }) => {
    try {
      if (!title.trim()) return { content: [{ type: 'text' as const, text: 'Error: 条目标题不能为空' }] }
      const { data, error } = await supabase.from('wiki_entries').insert({
        user_id: USER_ID,
        title: title.trim(),
        content,
        category: category?.trim() || '未分类',
        tags: tags ?? [],
        status: status ?? 'draft',
      }).select('id, title, category, tags, status, created_at, updated_at').single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `Wiki 条目已创建: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('update_wiki', {
    title: 'Update Wiki Entry',
    description: '更新 Wiki 条目的标题 / 正文 / 分类 / 标签 / 状态（至少一项；正文整体替换）。',
    inputSchema: {
      id: z.string().describe('条目 UUID（用 search_wiki / read_wiki 查询）'),
      title: z.string().optional().describe('新标题'),
      content: z.string().optional().describe('新正文（整体替换）'),
      category: z.string().optional().describe('新分类名称'),
      tags: z.array(z.string()).optional().describe('新标签数组（整体替换），遵循与 add_wiki 相同的标签家规'),
      status: z.enum(['draft', 'published']).optional().describe('新状态：draft / published'),
    },
  }, async ({ id, title, content, category, tags, status }) => {
    try {
      if (title === undefined && content === undefined && category === undefined && tags === undefined && status === undefined) {
        return { content: [{ type: 'text' as const, text: 'Error: title / content / category / tags / status 至少需要提供一项' }] }
      }
      if (title !== undefined && !title.trim()) return { content: [{ type: 'text' as const, text: 'Error: 条目标题不能为空' }] }
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (title !== undefined) updates.title = title.trim()
      if (content !== undefined) updates.content = content
      if (category !== undefined) updates.category = category.trim() || '未分类'
      if (tags !== undefined) updates.tags = tags
      if (status !== undefined) updates.status = status
      const { data, error } = await supabase.from('wiki_entries').update(updates).eq('user_id', USER_ID).eq('id', id).select('id, title, category, tags, status, created_at, updated_at')
      if (error) return errorResult(error)
      if (!data || data.length === 0) return { content: [{ type: 'text' as const, text: `Error: 未找到 Wiki 条目: ${id}` }] }
      return { content: [{ type: 'text' as const, text: `Wiki 条目已更新: ${JSON.stringify(data[0])}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('list_archive_categories', {
    title: 'List Archive Categories',
    description: '列出记忆档案分类树，可按 scope 筛选。',
    annotations: { readOnlyHint: true },
    inputSchema: { scope: z.enum(['chuanchuan', 'syzygy', 'all']).optional().describe('筛选 scope，默认 all') },
  }, async ({ scope }) => {
    try {
      let query = supabase.from('archive_categories').select('id, scope, name, parent_id, sort_order, created_at, updated_at').eq('user_id', USER_ID).order('scope', { ascending: true }).order('sort_order', { ascending: true })
      if (scope && scope !== 'all') query = query.eq('scope', scope)
      const { data, error } = await query
      if (error) return errorResult(error)
      return jsonResult(data)
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('read_archives', {
    title: 'Read Archives',
    description: '按分类读取记忆档案条目。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      category_id: z.string().describe('分类 UUID'),
      limit: z.number().optional().describe('返回数量上限，默认20，最大100'),
    },
  }, async ({ category_id, limit }) => {
    try {
      const safeLimit = clampLimit(limit, 20, 100)
      const { data, error } = await supabase.from('archives').select('id, category_id, title, content, keywords, aliases, importance, source, created_at, updated_at').eq('user_id', USER_ID).eq('category_id', category_id).eq('is_deleted', false).order('updated_at', { ascending: false }).limit(safeLimit)
      if (error) return errorResult(error)
      return jsonResult(data)
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('search_archives', {
    title: 'Search Archives',
    description: '按关键词搜索记忆档案（标题 / 内容 / 关键词）。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe('搜索关键词'),
      scope: z.enum(['chuanchuan', 'syzygy', 'all']).optional().describe('限定 scope，默认 all'),
      limit: z.number().optional().describe('返回数量上限，默认10，最大50'),
    },
  }, async ({ query, scope, limit }) => {
    try {
      const safeLimit = clampLimit(limit, 10, 50)
      let q = supabase.from('archives').select('id, category_id, title, content, keywords, aliases, importance, source, created_at, updated_at, archive_categories!archives_category_id_fkey!inner(scope, name)').eq('user_id', USER_ID).eq('is_deleted', false).or(`title.ilike.%${query}%,content.ilike.%${query}%,keywords.cs.{${query}}`).order('updated_at', { ascending: false }).limit(safeLimit)
      if (scope && scope !== 'all') q = q.eq('archive_categories.scope', scope)
      const { data, error } = await q
      if (error) return errorResult(error)
      return jsonResult(data)
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('add_archive_category', {
    title: 'Add Archive Category',
    description: '新建记忆档案分类。',
    inputSchema: {
      scope: z.enum(['chuanchuan', 'syzygy']).describe('分类所属 scope'),
      name: z.string().describe('分类名称'),
      parent_id: z.string().optional().describe('父分类 UUID，顶层分类不传'),
      sort_order: z.number().optional().describe('排序序号，默认0'),
    },
  }, async ({ scope, name, parent_id, sort_order }) => {
    try {
      const row: Record<string, unknown> = { user_id: USER_ID, scope, name, sort_order: sort_order ?? 0 }
      if (parent_id) row.parent_id = parent_id
      const { data, error } = await supabase.from('archive_categories').insert(row).select()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `分类已创建: ${JSON.stringify(data[0])}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('add_archive', {
    title: 'Add Archive Entry',
    description: '新建一条记忆档案条目。',
    inputSchema: {
      category_id: z.string().describe('所属分类 UUID'),
      title: z.string().describe('档案标题'),
      content: z.string().describe('档案内容'),
      keywords: z.array(z.string()).optional().describe('关键词标签'),
      aliases: z.array(z.string()).optional().describe('别名列表'),
      importance: z.enum(['low', 'normal', 'high', 'critical']).optional().describe('重要程度，默认 normal'),
      source: z.string().optional().describe('写入端，默认 manual'),
    },
  }, async ({ category_id, title, content, keywords, aliases, importance, source }) => {
    try {
      const row: Record<string, unknown> = {
        user_id: USER_ID,
        category_id,
        title,
        content,
        importance: importance ?? 'normal',
        source: source ?? 'manual',
      }
      if (keywords) row.keywords = keywords
      if (aliases) row.aliases = aliases
      const { data, error } = await supabase.from('archives').insert(row).select()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `档案已创建: ${JSON.stringify(data[0])}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('update_archive', {
    title: 'Update Archive Entry',
    description: '更新记忆档案条目，或用 is_deleted 软删除。',
    inputSchema: {
      id: z.string().describe('档案 UUID'),
      title: z.string().optional().describe('新标题'),
      content: z.string().optional().describe('新内容'),
      keywords: z.array(z.string()).optional().describe('新关键词'),
      aliases: z.array(z.string()).optional().describe('新别名'),
      importance: z.enum(['low', 'normal', 'high', 'critical']).optional().describe('新重要程度'),
      is_deleted: z.boolean().optional().describe('软删除标记'),
    },
  }, async ({ id, title, content, keywords, aliases, importance, is_deleted }) => {
    try {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (title !== undefined) updates.title = title
      if (content !== undefined) updates.content = content
      if (keywords !== undefined) updates.keywords = keywords
      if (aliases !== undefined) updates.aliases = aliases
      if (importance !== undefined) updates.importance = importance
      if (is_deleted !== undefined) updates.is_deleted = is_deleted
      const { data, error } = await supabase.from('archives').update(updates).eq('user_id', USER_ID).eq('id', id).select()
      if (error) return errorResult(error)
      if (!data || data.length === 0) return { content: [{ type: 'text' as const, text: `Error: archive not found: ${id}` }] }
      return { content: [{ type: 'text' as const, text: `档案已更新: ${JSON.stringify(data[0])}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('list_learning_folders', {
    title: 'List Learning Folders',
    description: '列出学习库文件夹树，附节点数。',
    annotations: { readOnlyHint: true },
    inputSchema: {},
  }, async () => {
    try {
      const { data, error } = await supabase.from('knowledge_folders').select('id, name, description, icon, parent_id, sort_order, created_at, updated_at, learning_nodes(count)').order('sort_order', { ascending: true }).order('created_at', { ascending: true })
      if (error) return errorResult(error)
      const folders = (data ?? []).map(({ learning_nodes, ...folder }) => ({ ...folder, node_count: learning_nodes?.[0]?.count ?? 0 }))
      return jsonResult(folders)
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('add_learning_folder', {
    title: 'Add Learning Folder',
    description: '新建学习库文件夹，parent_id 可挂树。',
    inputSchema: {
      name: z.string().describe('文件夹名称'),
      icon: z.string().optional().describe('展示图标（emoji），默认 📁'),
      description: z.string().optional().describe('文件夹说明'),
      parent_id: z.string().optional().describe('父文件夹 UUID，顶层不传'),
      sort_order: z.number().optional().describe('排序序号，默认0'),
    },
  }, async ({ name, icon, description, parent_id, sort_order }) => {
    try {
      if (!name.trim()) return { content: [{ type: 'text' as const, text: 'Error: 文件夹名称不能为空' }] }
      const row: Record<string, unknown> = { name: name.trim(), icon: icon?.trim() || '📁', sort_order: sort_order ?? 0 }
      if (description !== undefined) row.description = description
      if (parent_id) row.parent_id = parent_id
      const { data, error } = await supabase.from('knowledge_folders').insert(row).select('id, name, description, icon, parent_id, sort_order, created_at, updated_at').single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `学习库文件夹已创建: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('read_learning_nodes', {
    title: 'Read Learning Nodes',
    description: '读取学习库节点列表，可按文件夹和类型筛选。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      folder_id: z.string().optional().describe('文件夹 UUID（用 list_learning_folders 查询）；传 none 只看未归档节点，不传则不限文件夹'),
      node_type: learningNodeTypes.optional().describe('节点类型筛选'),
      limit: z.number().optional().describe('返回数量上限，默认20，最大100'),
    },
  }, async ({ folder_id, node_type, limit }) => {
    try {
      const safeLimit = clampLimit(limit, 20, 100)
      let q = supabase.from('learning_nodes').select(`${LEARNING_NODE_COLUMNS}, knowledge_folders(name)`).order('updated_at', { ascending: false }).limit(safeLimit)
      if (folder_id === 'none') q = q.is('folder_id', null)
      else if (folder_id) q = q.eq('folder_id', folder_id)
      if (node_type) q = q.eq('node_type', node_type)
      const { data, error } = await q
      if (error) return errorResult(error)
      return jsonResult(data)
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('search_learning_nodes', {
    title: 'Search Learning Nodes',
    description: '按关键词搜索学习库节点（标题 / 正文 / 标签）。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe('搜索关键词'),
      node_type: learningNodeTypes.optional().describe('限定节点类型'),
      limit: z.number().optional().describe('返回数量上限，默认10，最大50'),
    },
  }, async ({ query, node_type, limit }) => {
    try {
      const safeLimit = clampLimit(limit, 10, 50)
      let q = supabase.from('learning_nodes').select(`${LEARNING_NODE_COLUMNS}, knowledge_folders(name)`).or(`title.ilike.%${query}%,content.ilike.%${query}%,tags.cs.{${query}}`).order('updated_at', { ascending: false }).limit(safeLimit)
      if (node_type) q = q.eq('node_type', node_type)
      const { data, error } = await q
      if (error) return errorResult(error)
      return jsonResult(data)
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('add_learning_node', {
    title: 'Add Learning Node',
    description: '新建学习库节点；metadata 按节点类型约定填写（见服务器说明）。',
    inputSchema: {
      node_type: learningNodeTypes.describe('节点类型'),
      title: z.string().describe('节点标题'),
      content: z.string().optional().describe('节点正文'),
      tags: z.array(z.string()).optional().describe('标签数组，默认空'),
      folder_id: z.string().optional().describe('所属文件夹 UUID（用 list_learning_folders 查询），不传则不归档'),
      metadata: z.record(z.string(), z.string()).optional().describe('按节点类型约定的附加字段（字符串键值对）'),
    },
  }, async ({ node_type, title, content, tags, folder_id, metadata }) => {
    try {
      if (!title.trim()) return { content: [{ type: 'text' as const, text: 'Error: 节点标题不能为空' }] }
      const { data, error } = await supabase.from('learning_nodes').insert({
        node_type,
        title: title.trim(),
        content: content?.trim() || null,
        tags: tags ?? [],
        folder_id: folder_id || null,
        metadata: metadata ?? {},
      }).select(LEARNING_NODE_COLUMNS).single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `学习节点已创建: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('update_learning_node', {
    title: 'Update Learning Node',
    description: '更新学习库节点（至少一项；content / tags / metadata 整体替换；类型不可改）。',
    inputSchema: {
      id: z.string().describe('节点 UUID（用 search_learning_nodes / read_learning_nodes 查询）'),
      title: z.string().optional().describe('新标题'),
      content: z.string().optional().describe('新正文（整体替换）'),
      tags: z.array(z.string()).optional().describe('新标签数组（整体替换）'),
      folder_id: z.string().optional().describe('新文件夹 UUID，传 none 移出文件夹'),
      metadata: z.record(z.string(), z.string()).optional().describe('新 metadata（整体替换）'),
    },
  }, async ({ id, title, content, tags, folder_id, metadata }) => {
    try {
      if (title === undefined && content === undefined && tags === undefined && folder_id === undefined && metadata === undefined) {
        return { content: [{ type: 'text' as const, text: 'Error: title / content / tags / folder_id / metadata 至少需要提供一项' }] }
      }
      if (title !== undefined && !title.trim()) return { content: [{ type: 'text' as const, text: 'Error: 节点标题不能为空' }] }
      const updates: Record<string, unknown> = {}
      if (title !== undefined) updates.title = title.trim()
      if (content !== undefined) updates.content = content.trim() || null
      if (tags !== undefined) updates.tags = tags
      if (folder_id !== undefined) updates.folder_id = folder_id === 'none' ? null : folder_id
      if (metadata !== undefined) updates.metadata = metadata
      const { data, error } = await supabase.from('learning_nodes').update(updates).eq('id', id).select(LEARNING_NODE_COLUMNS)
      if (error) return errorResult(error)
      if (!data || data.length === 0) return { content: [{ type: 'text' as const, text: `Error: 未找到学习节点: ${id}` }] }
      return { content: [{ type: 'text' as const, text: `学习节点已更新: ${JSON.stringify(data[0])}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('read_learning_edges', {
    title: 'Read Learning Edges',
    description: '读取某节点的全部连边（双向，带两端节点信息）。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      node_id: z.string().describe('节点 UUID'),
      limit: z.number().optional().describe('返回数量上限，默认20，最大100'),
    },
  }, async ({ node_id, limit }) => {
    try {
      const safeLimit = clampLimit(limit, 20, 100)
      const { data, error } = await supabase.from('learning_edges').select(`${LEARNING_EDGE_COLUMNS}, from_node:learning_nodes!learning_edges_from_node_id_fkey(id, title, node_type), to_node:learning_nodes!learning_edges_to_node_id_fkey(id, title, node_type)`).or(`from_node_id.eq.${node_id},to_node_id.eq.${node_id}`).order('created_at', { ascending: false }).limit(safeLimit)
      if (error) return errorResult(error)
      return jsonResult(data)
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('add_learning_edge', {
    title: 'Add Learning Edge',
    description: '在两个学习节点之间新建有向连边。',
    inputSchema: {
      from_node_id: z.string().describe('起点节点 UUID'),
      to_node_id: z.string().describe('终点节点 UUID'),
      edge_type: learningEdgeTypes.describe('连边类型'),
      description: z.string().optional().describe('连边说明（为什么关联）'),
      strength: z.number().optional().describe('联想强度 1-5，默认3'),
    },
  }, async ({ from_node_id, to_node_id, edge_type, description, strength }) => {
    try {
      if (from_node_id === to_node_id) return { content: [{ type: 'text' as const, text: 'Error: 不允许建立自连边' }] }
      const row: Record<string, unknown> = { from_node_id, to_node_id, edge_type, strength: clampStrength(strength ?? 3) }
      if (description !== undefined) row.description = description
      const { data, error } = await supabase.from('learning_edges').insert(row).select(LEARNING_EDGE_COLUMNS).single()
      if (error) return errorResult(error)
      return { content: [{ type: 'text' as const, text: `连边已创建: ${JSON.stringify(data)}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('update_learning_edge', {
    title: 'Update Learning Edge',
    description: '更新连边的类型 / 说明 / 强度（至少一项；两端节点不可改）。',
    inputSchema: {
      id: z.string().describe('连边 UUID（用 read_learning_edges 查询）'),
      edge_type: learningEdgeTypes.optional().describe('新连边类型'),
      description: z.string().optional().describe('新说明'),
      strength: z.number().optional().describe('新联想强度 1-5'),
    },
  }, async ({ id, edge_type, description, strength }) => {
    try {
      if (edge_type === undefined && description === undefined && strength === undefined) {
        return { content: [{ type: 'text' as const, text: 'Error: edge_type / description / strength 至少需要提供一项' }] }
      }
      const updates: Record<string, unknown> = {}
      if (edge_type !== undefined) updates.edge_type = edge_type
      if (description !== undefined) updates.description = description
      if (strength !== undefined) updates.strength = clampStrength(strength)
      const { data, error } = await supabase.from('learning_edges').update(updates).eq('id', id).select(LEARNING_EDGE_COLUMNS)
      if (error) return errorResult(error)
      if (!data || data.length === 0) return { content: [{ type: 'text' as const, text: `Error: 未找到连边: ${id}` }] }
      return { content: [{ type: 'text' as const, text: `连边已更新: ${JSON.stringify(data[0])}` }] }
    } catch (err) {
      return errorResult(err)
    }
  })
  // ── 囤粮处 ─────────────────────────────────────────────────────────────────

  server.registerTool('stash_list_folders', {
    title: 'List Stash Folders',
    description: '列出囤粮处全部格子（树以 parent_id 表达），附每格粮食数与待归仓条数。',
    annotations: { readOnlyHint: true },
    inputSchema: {},
  }, async () => {
    try {
      const [foldersRes, itemsRes] = await Promise.all([
        supabase.from('stash_folders').select(STASH_FOLDER_COLUMNS).eq('user_id', USER_ID).order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
        supabase.from('stash_items').select('folder_id, status').eq('user_id', USER_ID),
      ])
      if (foldersRes.error) return errorResult(foldersRes.error)
      if (itemsRes.error) return errorResult(itemsRes.error)
      const counts = new Map<string | null, { total: number; stashed: number }>()
      for (const row of (itemsRes.data ?? []) as { folder_id: string | null; status: string }[]) {
        const current = counts.get(row.folder_id) ?? { total: 0, stashed: 0 }
        current.total += 1
        if (row.status === 'stashed') current.stashed += 1
        counts.set(row.folder_id, current)
      }
      const folders = ((foldersRes.data ?? []) as { id: string }[]).map((folder) => ({ ...folder, item_count: counts.get(folder.id)?.total ?? 0, stashed_count: counts.get(folder.id)?.stashed ?? 0 }))
      const inbox = counts.get(null) ?? { total: 0, stashed: 0 }
      return jsonResult({ inbox: { item_count: inbox.total, stashed_count: inbox.stashed }, folders })
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('stash_add_folder', {
    title: 'Add Stash Folder',
    description: '新建囤粮处格子，parent_id 可挂到已有格子下（层级不限）。建前先 stash_list_folders 看有没有现成的。',
    inputSchema: {
      name: z.string().describe('格子名称'),
      icon: z.string().optional().describe('展示图标（一个 emoji），可空'),
      description: z.string().optional().describe('格子说明，可空'),
      parent_id: z.string().optional().describe('父格子 UUID，一级格子不传'),
      sort_order: z.number().optional().describe('排序序号，默认 0'),
    },
  }, async (input) => {
    try {
      const normalized = normalizeStashFolderInput(input)
      if (!normalized.ok) return textResult(`Error: ${normalized.error}`)
      const { data, error } = await supabase.from('stash_folders').insert({ user_id: USER_ID, ...normalized.row }).select(STASH_FOLDER_COLUMNS).single()
      if (error) return errorResult(error)
      return textResult(`格子已建好: ${JSON.stringify(data)}`)
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('stash_read', {
    title: 'Read Stash',
    description: '读囤粮处的粮食：按格子（folder_id，传 inbox 只看待归仓，不传则不限）/ 关键词（标题 / 正文 / 链接 / 标签）/ 状态 / 谁囤的筛选，新囤的在前，每条随带留言。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      folder_id: z.string().optional().describe('格子 UUID（用 stash_list_folders 查询）；传 inbox 只看待归仓；不传则不限格子'),
      query: z.string().optional().describe('关键词，匹配标题 / 正文 / 链接 / 标签'),
      status: STASH_STATUS_SCHEMA.optional().describe('stashed=囤着 / eaten=吃掉了，缺省全部'),
      added_by: STASH_ADDER_SCHEMA.optional().describe('只看某个人 / 端口囤的'),
      limit: z.number().optional().describe('返回数量上限，默认 20，最大 100'),
    },
  }, async ({ folder_id, query, status, added_by, limit }) => {
    try {
      const safeLimit = clampLimit(limit, 20, 100)
      let q = supabase.from('stash_items').select(`${STASH_ITEM_COLUMNS}, stash_folders(name)`).eq('user_id', USER_ID).order('created_at', { ascending: false }).limit(safeLimit)
      if (folder_id === 'inbox') q = q.is('folder_id', null)
      else if (folder_id) q = q.eq('folder_id', folder_id.trim())
      // PostgREST 的 or() 用逗号 / 括号 / 引号做语法，关键词里的这些字符直接剔掉，不做花式转义。
      const keyword = (query ?? '').replace(/[,()"{}]/gu, ' ').replace(/\s+/gu, ' ').trim()
      if (keyword) {
        const escaped = keyword.replace(/[%_\\]/gu, (match) => `\\${match}`)
        q = q.or(`title.ilike.%${escaped}%,content.ilike.%${escaped}%,url.ilike.%${escaped}%,tags.cs.{"${keyword}"}`)
      }
      if (status) q = q.eq('status', status)
      if (added_by) q = q.eq('added_by', added_by)
      const { data, error } = await q
      if (error) return errorResult(error)
      const items = ((data ?? []) as Record<string, unknown>[]).map(({ stash_folders, ...item }) => ({ ...item, folder_name: (stash_folders as { name: string } | null)?.name ?? null }))
      const commentsByItem = new Map<string, unknown[]>()
      if (items.length > 0) {
        const { data: commentRows, error: commentError } = await supabase.from('stash_comments').select(STASH_COMMENT_COLUMNS).in('item_id', items.map((item) => item.id as string)).order('created_at', { ascending: true })
        if (commentError) return errorResult(commentError)
        for (const row of (commentRows ?? []) as { item_id: string }[]) {
          const list = commentsByItem.get(row.item_id) ?? []
          list.push(row)
          commentsByItem.set(row.item_id, list)
        }
      }
      return jsonResult(items.map((item) => ({ ...item, comments: commentsByItem.get(item.id as string) ?? [] })))
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('stash_add', {
    title: 'Add Stash Item',
    description: '囤一条：链接或文本至少一样（没标题时从链接凑）。拿不准放哪就不传 folder_id（进待归仓）。链接按归一化去重：已囤过会原样返回已有那条，不报错、不重复写。',
    inputSchema: {
      title: z.string().optional().describe('标题；有链接时可不传，会从链接凑一个'),
      url: z.string().optional().describe('链接（http / https；裸域名也行）'),
      content: z.string().optional().describe('正文（Markdown），可空；没链接时必填'),
      tags: z.array(z.string()).optional().describe('标签数组，可空'),
      folder_id: z.string().optional().describe('格子 UUID（用 stash_list_folders 查询），不传即待归仓'),
      added_by: STASH_ADDER_SCHEMA.optional().describe('谁囤的，默认 chuanchuan；端口自己囤请写自己的名字'),
      metadata: STASH_METADATA_SCHEMA.optional().describe('结构化元数据（如 stars / author / cover），可空'),
    },
  }, async (input) => {
    try {
      const normalized = normalizeStashItemInput(input)
      if (!normalized.ok) return textResult(`Error: ${normalized.error}`)
      if (normalized.row.url_key) {
        const { data: existing, error: existingError } = await supabase.from('stash_items').select(STASH_ITEM_COLUMNS).eq('user_id', USER_ID).eq('url_key', normalized.row.url_key).maybeSingle()
        if (existingError) return errorResult(existingError)
        if (existing) return textResult(`这条早囤过了，原样返回（要补话用 stash_comment）: ${JSON.stringify(existing)}`)
      }
      const { data, error } = await supabase.from('stash_items').insert({ user_id: USER_ID, ...normalized.row }).select(STASH_ITEM_COLUMNS).single()
      if (error) return errorResult(error)
      return textResult(`已囤进${normalized.row.folder_id ? '格子' : '待归仓'}: ${JSON.stringify(data)}`)
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('stash_update', {
    title: 'Update Stash Item',
    description: '改一条粮食（至少一项）：挪格子（folder_id，传 inbox 挪回待归仓）、吃掉 / 改回囤着（status）、改标题 / 链接 / 正文 / 标签 / metadata（tags / metadata 整体替换）。',
    inputSchema: {
      id: z.string().describe('粮食 UUID（用 stash_read 查询）'),
      folder_id: z.string().optional().describe('新格子 UUID；传 inbox 挪回待归仓'),
      status: STASH_STATUS_SCHEMA.optional().describe('eaten=吃掉了 / stashed=改回囤着'),
      title: z.string().optional().describe('新标题'),
      url: z.string().optional().describe('新链接（会重新归一化去重）；传空字符串清除链接（此时必须有正文）'),
      content: z.string().optional().describe('新正文（整体替换）；传空字符串清除正文（此时必须有链接）'),
      tags: z.array(z.string()).optional().describe('新标签数组（整体替换）'),
      metadata: STASH_METADATA_SCHEMA.optional().describe('新 metadata（整体替换）'),
    },
  }, async ({ id, folder_id, status, title, url, content, tags, metadata }) => {
    try {
      if ([folder_id, status, title, url, content, tags, metadata].every((value) => value === undefined)) {
        return textResult('Error: folder_id / status / title / url / content / tags / metadata 至少需要提供一项')
      }
      const { data: current, error: readError } = await supabase.from('stash_items').select(STASH_ITEM_COLUMNS).eq('user_id', USER_ID).eq('id', id).maybeSingle()
      if (readError) return errorResult(readError)
      if (!current) return textResult(`Error: 未找到粮食: ${id}`)
      const merged = normalizeStashItemInput({
        title: title ?? current.title,
        url: url ?? current.url,
        content: content ?? current.content,
        tags: tags ?? current.tags,
        folder_id: folder_id === undefined ? current.folder_id : folder_id === 'inbox' ? null : folder_id,
        added_by: current.added_by,
        status: status ?? current.status,
        metadata: metadata ?? (current.metadata as Record<string, unknown>),
      })
      if (!merged.ok) return textResult(`Error: ${merged.error}`)
      if (merged.row.url_key && merged.row.url_key !== current.url_key) {
        const { data: clash, error: clashError } = await supabase.from('stash_items').select('id, title').eq('user_id', USER_ID).eq('url_key', merged.row.url_key).neq('id', id).maybeSingle()
        if (clashError) return errorResult(clashError)
        if (clash) return textResult(`Error: 这条链接已经囤在另一条里了: ${JSON.stringify(clash)}`)
      }
      // added_by 是谁囤的，改内容不改署名。
      const updates: Record<string, unknown> = { ...merged.row }
      delete updates.added_by
      const { data, error } = await supabase.from('stash_items').update(updates).eq('user_id', USER_ID).eq('id', id).select(STASH_ITEM_COLUMNS).single()
      if (error) return errorResult(error)
      return textResult(`粮食已更新: ${JSON.stringify(data)}`)
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('stash_comment', {
    title: 'Comment Stash Item',
    description: '在某条粮食下留言或回复（串串 chuanchuan，端口用自己的名字）。',
    inputSchema: {
      item_id: z.string().describe('粮食 UUID（用 stash_read 查询）'),
      author: STASH_ADDER_SCHEMA.describe('留言者'),
      content: z.string().describe('留言内容'),
    },
  }, async ({ item_id, author, content }) => {
    try {
      const normalized = normalizeStashCommentInput({ author, content })
      if (!normalized.ok) return textResult(`Error: ${normalized.error}`)
      const { data: item, error: itemError } = await supabase.from('stash_items').select('id').eq('user_id', USER_ID).eq('id', item_id).maybeSingle()
      if (itemError) return errorResult(itemError)
      if (!item) return textResult(`Error: 未找到粮食: ${item_id}`)
      const { data, error } = await supabase.from('stash_comments').insert({ user_id: USER_ID, item_id, ...normalized.comment }).select(STASH_COMMENT_COLUMNS).single()
      if (error) return errorResult(error)
      return textResult(`留言已写下: ${JSON.stringify(data)}`)
    } catch (err) {
      return errorResult(err)
    }
  })
}, { instructions: KNOWLEDGE_MCP_INSTRUCTIONS })
