import { z } from 'npm:zod@^4.1.13'
import { clampLimit, errorResult, jsonResult, serveMcp, supabase, USER_ID } from '../_shared/mcp_common.ts'

serveMcp('hamster-knowledge-mcp', (server) => {
  server.registerTool('search_wiki', {
    title: 'Search Wiki',
    description: '按关键词搜索Wiki知识库条目。',
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
    description: '读取所有Wiki条目列表。不需要任何参数。',
    inputSchema: { limit: z.number().optional().describe('返回数量，默认20') },
  }, async ({ limit }) => {
    const { data, error } = await supabase.from('wiki_entries').select('id, title, category, tags, status, updated_at').eq('user_id', USER_ID).order('updated_at', { ascending: false }).limit(limit ?? 20)
    if (error) return errorResult(error)
    return jsonResult(data)
  })

  server.registerTool('add_wiki', {
    title: 'Add Wiki Entry',
    description: '新建一条 Wiki 知识库条目。写入前建议先用 search_wiki 查重，已有同主题条目时优先用 update_wiki 维护。status 默认 draft（草稿），确认成熟的内容可直接传 published。',
    inputSchema: {
      title: z.string().describe('条目标题'),
      content: z.string().describe('条目正文（Markdown）'),
      category: z.string().optional().describe('分类名称，默认「未分类」'),
      tags: z.array(z.string()).optional().describe('标签数组，默认空'),
      status: z.enum(['draft', 'published']).optional().describe('条目状态：draft 草稿（默认）/ published 已发布'),
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
    description: '更新已有的 Wiki 条目：标题、正文、分类、标签或状态（draft/published），至少传一项。content 为整体替换，改前建议先 search_wiki 拿到原文。',
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
    description: '列出所有记忆档案分类，可按 scope 筛选（chuanchuan / syzygy）。返回分类树结构。只读工具。',
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
    description: '按分类读取记忆档案条目，返回该分类下所有未删除的档案。只读工具。',
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
    description: '按关键词搜索记忆档案，匹配标题、内容和关键词字段。只读工具。',
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
    description: '创建新的记忆档案分类。',
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
    description: '创建一条新的记忆档案条目。',
    inputSchema: {
      category_id: z.string().describe('所属分类 UUID'),
      title: z.string().describe('档案标题'),
      content: z.string().describe('档案内容'),
      keywords: z.array(z.string()).optional().describe('关键词标签'),
      aliases: z.array(z.string()).optional().describe('别名列表'),
      importance: z.enum(['low', 'normal', 'high', 'critical']).optional().describe('重要程度，默认 normal'),
      source: z.string().optional().describe('来源: manual / claude / gpt / codex，默认 manual'),
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
    description: '更新已有的记忆档案条目。可修改标题、内容、关键词、别名、重要程度，或软删除。',
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
})
