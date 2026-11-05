// Stable permission IDs; schemas are discovered from the owning MCP service.
export const API_TOOL_CATALOG = [
  ['timeline', 'recent_timeline', '最近时间轴', 'read'],
  ['timeline', 'search_timeline', '搜索时间轴', 'read'],
  ['timeline', 'add_timeline', '新增时间轴', 'write'],
  ['timeline', 'update_timeline', '修改时间轴', 'write'],
  ['reading', 'reading_status', '当前阅读与最近摘抄', 'read'],
  ['reading', 'reading_history', '查找书目', 'read'],
  ['reading', 'reading_stats', '阅读统计', 'read'],
  ['reading', 'list_chapters', '章节目录', 'read'],
  ['reading', 'book_excerpts', '读取摘抄', 'read'],
  ['reading', 'read_excerpt_resonances', '读取旁批', 'read'],
  ['reading', 'read_book_questions', '读取问答', 'read'],
  ['reading', 'read_book_guides', '读取导读', 'read'],
  ['reading', 'read_book_summaries', '读取总结', 'read'],
  ['reading', 'add_excerpt_resonance', '写旁批', 'write'],
  ['reading', 'add_book_question', '写阅读问题', 'write'],
  ['reading', 'add_book_answer', '回答阅读问题', 'write'],
  ['reading', 'add_book_guide', '写导读', 'write'],
  ['reading', 'update_book_guide', '修改导读', 'write'],
  ['reading', 'add_book_summary', '写阅读总结', 'write'],
  ['reading', 'update_book_summary', '修改阅读总结', 'write'],
].map(([group, name, label, access]) => ({
  id: `${group}__${name}`,
  group,
  name,
  label,
  access,
  server: group === 'timeline' ? 'hamster-mcp' : 'hamster-reading-mcp',
}))

export function normalizeToolSelection(value: unknown): string[] {
  if (
    !Array.isArray(value) || value.length > API_TOOL_CATALOG.length ||
    value.some((id) => typeof id !== 'string' || !API_TOOL_CATALOG.some((t) => t.id === id))
  ) {
    throw new Error('工具选择无效，请刷新后重试')
  }
  return [...new Set(value as string[])].sort()
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')
    }}`
  }
  return JSON.stringify(value)
}

export function toolResult(result: Record<string, unknown>) {
  const text = Array.isArray(result.content)
    ? result.content.map((part) => typeof part?.text === 'string' ? part.text : '').filter(Boolean)
      .join('\n')
    : ''
  // Legacy MCP handlers sometimes return Error: text without isError.
  const ok = !result.isError && !/(^|\n)\s*(Error:|工具执行报错:)/iu.test(text)
  return { ok, text: text || (ok ? '操作完成，无返回内容' : '工具执行失败') }
}

export function summarizeApiUsage(rows: readonly { usage: unknown; status: string }[]) {
  let cost = 0, unknown = 0, input = 0, output = 0, cached = 0, written = 0
  for (const row of rows) {
    const u = (row.usage ?? {}) as Record<string, unknown>
    const details = (u.prompt_tokens_details ?? {}) as Record<string, unknown>
    if (typeof u.cost === 'number' && Number.isFinite(u.cost)) cost += u.cost
    else unknown++
    const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : 0
    input += number(u.prompt_tokens)
    output += number(u.completion_tokens)
    cached += number(details.cached_tokens ?? u.cache_read_input_tokens)
    written += number(details.cache_write_tokens ?? u.cache_creation_input_tokens)
  }
  return {
    calls: rows.length,
    cost_usd: cost,
    unknown_calls: unknown,
    prompt_tokens: input,
    completion_tokens: output,
    cached_tokens: cached,
    cache_write_tokens: written,
  }
}
