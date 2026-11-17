import type { McpServer } from 'npm:@modelcontextprotocol/sdk@1.25.3/server/mcp.js'
import { z } from 'npm:zod@^4.1.13'
import { errorResult, jsonResult, supabase } from '../_shared/mcp_common.ts'
import { isIsoDateString } from './diary_contract.ts'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
const title = z.string().trim().min(1).max(100)
const day = z.string().refine(value => /^[1-9]/.test(value) && isIsoDateString(value), '请输入有效日期 YYYY-MM-DD')
const entry = z.object({ id: uuid, title, date: day }).passthrough()
const book = z.object({ entries: z.array(entry), since: day.nullable(), featured_id: uuid.nullable(), revision: uuid.nullable() })
type Book = z.infer<typeof book>
type Entry = z.infer<typeof entry>
const columns = 'entries,since,featured_id,revision'
const failure = (message: string) => ({ ...errorResult(message), isError: true as const })

async function readBook(owner: string): Promise<Book> {
  const { data, error } = await supabase.from('home_anniversary_books').select(columns).eq('user_id', owner).maybeSingle()
  if (error) throw Error('纪念日读取失败，请重试。')
  return book.parse(data ?? { entries: [], since: null, featured_id: null, revision: null })
}

// Match the App's whole-book compare-and-swap. Retrying the same entry ID cannot add it twice.
async function saveEntry(owner: string, base: Book, item: Entry, create: boolean) {
  const entries = create ? [...base.entries, item] : base.entries.map(old => old.id === item.id ? item : old)
  const revision = crypto.randomUUID()
  const table = supabase.from('home_anniversary_books')
  const write = base.revision === null
    ? table.insert({ user_id: owner, entries, revision })
    : table.update({ entries, revision }).eq('user_id', owner).eq('revision', base.revision)
  const { data } = await write.select('revision').maybeSingle()
  if (data?.revision === revision) return jsonResult({ entry: item, revision })
  const latest = await readBook(owner)
  const saved = latest.entries.find(row => row.id === item.id)
  if (saved && saved.title === item.title && saved.date === item.date)
    return jsonResult({ entry: saved, revision: latest.revision })
  return failure('写入未确认或记录已变化。请用 anniversary_read 核对最新版本，同一新增操作沿用 entry_id。')
}

export function registerAnniversaryTools(server: McpServer, owner: string) {
  server.registerTool('anniversary_read', {
    description: '读取鼠窝纪念日、陪伴起始日、首页固定项和当前 revision。省略 entry_id 返回全部；指定 ID 读取一条。featured_id 为空表示首页自动选最近日期。',
    annotations: { readOnlyHint: true },
    inputSchema: { entry_id: uuid.optional() },
  }, async ({ entry_id }) => {
    const current = await readBook(owner)
    if (!entry_id) return jsonResult(current)
    const item = current.entries.find(row => row.id === entry_id)
    return item ? jsonResult({ entry: item, revision: current.revision }) : failure('未找到这个纪念日。')
  })
  server.registerTool('anniversary_create', {
    description: '添加每年重复的纪念日，与 App 的列表同步。每个新纪念日生成一个 UUID 作为 entry_id，同一次重试沿用它。首页固定项和陪伴起始日由串串选择。',
    inputSchema: { entry_id: uuid, title, date: day },
  }, async ({ entry_id, title, date }) => {
    const current = await readBook(owner)
    const existing = current.entries.find(row => row.id === entry_id)
    if (existing) return existing.title === title && existing.date === date
      ? jsonResult({ entry: existing, revision: current.revision })
      : failure('此 entry_id 已有不同内容，请先读取；修改已有日期用 anniversary_update。')
    return saveEntry(owner, current, { id: entry_id, title, date }, true)
  })
  server.registerTool('anniversary_update', {
    description: '编辑一个已有纪念日的名称或日期，至少提供一项。expected_revision 使用最近一次 anniversary_read 返回的版本；遇到冲突先重读。',
    inputSchema: { entry_id: uuid, expected_revision: uuid, title: title.optional(), date: day.optional() },
  }, async ({ entry_id, expected_revision, title, date }) => {
    if (title === undefined && date === undefined) return failure('请提供要修改的名称或日期。')
    const current = await readBook(owner)
    const item = current.entries.find(row => row.id === entry_id)
    if (!item) return failure('未找到这个纪念日。')
    const next = { ...item, title: title ?? item.title, date: date ?? item.date }
    if (item.title === next.title && item.date === next.date) return jsonResult({ entry: item, revision: current.revision })
    if (expected_revision !== current.revision) return failure('记录已更新，请重新读取后再编辑。')
    return saveEntry(owner, current, next, false)
  })
}
