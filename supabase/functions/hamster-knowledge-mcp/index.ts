import { z } from 'npm:zod@^4.1.13'
import { clampLimit, errorResult, jsonResult, serveMcp, supabase, USER_ID } from '../_shared/mcp_common.ts'

// 学习库（/knowledge 页面）三张表都没有 user_id 列，属主由部署环境保证，查询无需按用户过滤。
const learningNodeTypes = z.enum(['concept', 'question', 'insight', 'source', 'quote', 'note', 'application'])
const learningEdgeTypes = z.enum(['association', 'derivation', 'contradiction', 'application', 'reference', 'question'])
const LEARNING_NODE_COLUMNS = 'id, folder_id, node_type, title, content, tags, metadata, created_at, updated_at'
const LEARNING_EDGE_COLUMNS = 'id, from_node_id, to_node_id, edge_type, description, strength, created_at'
const clampStrength = (strength: number) => Math.min(Math.max(Math.round(strength), 1), 5)

// 服务器级使用说明：跨工具的共性约定统一放这里，工具描述只写"做什么"。
const KNOWLEDGE_MCP_INSTRUCTIONS = [
  '知识域三块：Wiki（长期知识条目，status 分 draft / published）、记忆档案 archives（分类树 + 条目，scope 分 chuanchuan / syzygy）、学习库（learning 节点与有向连边的图谱 + 文件夹树）。',
  '写入习惯：add 前先用对应的 search_* 查重，已有条目优先 update_* 维护；update 传入的 content / tags / metadata 均为整体替换，改前先读原值。',
  '学习节点 metadata 约定：question 用 status(open/exploring/resolved)+answer；application 用 project+status(idea/in_progress/done)；source 用 url+author；quote 用 origin+page；concept 用 source。',
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

  server.registerTool('add_wiki', {
    title: 'Add Wiki Entry',
    description: '新建一条 Wiki 条目，status 默认 draft。',
    inputSchema: {
      title: z.string().describe('条目标题'),
      content: z.string().describe('条目正文（Markdown）'),
      category: z.string().optional().describe('分类名称，默认「未分类」'),
      tags: z.array(z.string()).optional().describe('标签数组，默认空'),
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
      tags: z.array(z.string()).optional().describe('新标签数组（整体替换）'),
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
}, { instructions: KNOWLEDGE_MCP_INSTRUCTIONS })
