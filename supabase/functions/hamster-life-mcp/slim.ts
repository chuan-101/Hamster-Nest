// Third-party MCP replies are written for apps, not for a model's context
// window: a Luckin tools/call wraps its JSON in a JSON-RPC envelope, escapes it
// a second time inside content[].text, and ships picture URLs plus a fully
// expanded attribute tree with every option. These helpers keep what a caller
// needs to take the next step (ids, skuCode, prices, coupon codes, selected
// specs) and drop the rest. Pure functions, no Deno APIs, so tests import them.

type Json = unknown
type JsonRecord = Record<string, Json>

const asRecord = (value: Json): JsonRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null

const parseJson = (text: string): Json | undefined => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// Image fields carry long CDN URLs a model never opens. Matched on word
// boundaries (pictureUrl, breviaryPicUrl, image_url) so "topic" survives.
const IMAGE_KEY = /^(pic|picture|image|img|icon)(Url|URL|_url)?$|[a-z0-9](Pic|Picture|Image|Img|Icon)(Url|URL)?$|_(pic|picture|image|img|icon)(_url)?$/
const isUrl = (value: Json) => typeof value === 'string' && /^(https?:)?\/\//.test(value)

const isEmpty = (value: Json) =>
  value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)

/** Drops nulls, empty strings/arrays and image URLs at every depth. */
export const pruneJson = (value: Json): Json => {
  if (Array.isArray(value)) return value.map(pruneJson)
  const record = asRecord(value)
  if (!record) return value
  const out: JsonRecord = {}
  for (const [key, child] of Object.entries(record)) {
    if (isEmpty(child)) continue
    if (IMAGE_KEY.test(key) && isUrl(child)) continue
    const pruned = pruneJson(child)
    if (Array.isArray(pruned) && pruned.every(isEmpty)) continue
    out[key] = pruned
  }
  return out
}

/**
 * Unwraps a JSON-RPC tools/call response: returns the tool's own payload,
 * parsing text content that is itself JSON. Errors come back as text so the
 * caller sees them instead of an empty object.
 */
export const unwrapToolCall = (
  response: Json,
): { payload: Json; isError: boolean; protocolError?: true } => {
  const record = asRecord(response)
  const rpcError = asRecord(record?.error)
  // Keep the whole error: code and data carry validation details, and raw=true
  // can't recover what this step drops.
  if (rpcError) return { payload: rpcError, isError: true, protocolError: true }
  const result = asRecord(record?.result)
  if (!result) return { payload: response, isError: false }
  const isError = result.isError === true
  // McDonald's sends every reply twice: once inside a Markdown field guide in
  // content[].text, once clean in structuredContent. The clean copy wins.
  if (asRecord(result.structuredContent)) return { payload: result.structuredContent, isError }
  const content = Array.isArray(result.content) ? result.content : null
  if (!content) return { payload: result.structuredContent ?? result, isError }
  const parts = content.map((part) => {
    const item = asRecord(part)
    if (item?.type !== 'text' || typeof item.text !== 'string') return part
    return parseJson(item.text) ?? item.text
  })
  return { payload: parts.length === 1 ? parts[0] : parts, isError }
}

/** tools/list without outputSchema and schema boilerplate, which no caller reads. */
export const slimToolList = (response: Json): Json => {
  const result = asRecord(asRecord(response)?.result)
  const tools = Array.isArray(result?.tools) ? result.tools : null
  if (!tools) return unwrapToolCall(response).payload
  const stripSchema = (schema: Json): Json => {
    if (Array.isArray(schema)) return schema.map(stripSchema)
    const node = asRecord(schema)
    if (!node) return schema
    const out: JsonRecord = {}
    for (const [key, child] of Object.entries(node)) {
      // additionalProperties: true is the same as leaving it out; false and a
      // schema both narrow the contract and must survive.
      if (key === 'additionalProperties' && child === true) continue
      if (key === 'returnDirect' && typeof child === 'boolean') continue
      if (key === '$schema') continue
      out[key] = stripSchema(child)
    }
    return out
  }
  return tools.map((tool) => {
    const item = asRecord(tool) ?? {}
    return pruneJson({ name: item.name, description: item.description, inputSchema: stripSchema(item.inputSchema) })
  })
}

// ── Luckin ────────────────────────────────────────────────────────────────

/**
 * productAttrs → { "杯型#64": "✓大杯#365 | 超大杯#594+3" }. Group and option
 * ids stay because switchProduct takes them; ✓ marks the selected option.
 */
export const compactLuckinAttrs = (attrs: Json): Json => {
  if (!Array.isArray(attrs)) return attrs
  const out: Record<string, string> = {}
  for (const attr of attrs) {
    const group = asRecord(attr)
    if (!group) continue
    const options = Array.isArray(group.productSubAttrs) ? group.productSubAttrs : []
    out[`${group.attributeName}#${group.attributeId}`] = options
      .map((option) => {
        const sub = asRecord(option) ?? {}
        const price = typeof sub.price === 'number' && sub.price > 0 ? `+${sub.price}` : ''
        const blocked = sub.canSelected === 0 ? '(不可选)' : ''
        return `${sub.selected === true ? '✓' : ''}${sub.attributeName}#${sub.attributeId}${price}${blocked}`
      })
      .join(' | ')
  }
  return out
}

const LUCKIN_SHOP_KEYS = ['deptId', 'deptName', 'number', 'workStatus'] as const

// Fields that repeat what the caller already has or that no next step reads.
const LUCKIN_DROP_KEYS = new Set([
  'longitude', 'latitude', 'cafeKuIdList', 'coffeeVoucherType', 'productType', 'type', 'fallback',
  'orderGranularCommodityList', 'supportSend',
])

const formatShanghaiTime = (ms: number) =>
  new Date(ms + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')

const slimLuckinNode = (value: Json): Json => {
  if (Array.isArray(value)) return value.map(slimLuckinNode)
  const record = asRecord(value)
  if (!record) return value
  const out: JsonRecord = {}
  for (const [key, child] of Object.entries(record)) {
    if (LUCKIN_DROP_KEYS.has(key)) continue
    if (key === 'productAttrs') {
      // Order lines already spell the specs out in additionDesc.
      if (typeof record.additionDesc === 'string') continue
      out.specs = compactLuckinAttrs(child)
      continue
    }
    if (key === 'shopInfo' && asRecord(child)) {
      const shop = asRecord(child)!
      out.shopInfo = Object.fromEntries(LUCKIN_SHOP_KEYS.filter((k) => k in shop).map((k) => [k, shop[k]]))
      continue
    }
    if (key === 'aboutTime' && typeof child === 'number') {
      out.aboutTime = `${formatShanghaiTime(child)}（上海时间）`
      continue
    }
    out[key] = slimLuckinNode(child)
  }
  return out
}

/** Luckin replies are { code, msg, data, success }; keep data on success, the message otherwise. */
export const slimLuckinPayload = (payload: Json): Json => {
  const envelope = asRecord(payload)
  if (!envelope || !('code' in envelope)) return pruneJson(slimLuckinNode(payload))
  if (envelope.code !== 0 || envelope.success === false) {
    return pruneJson({ code: envelope.code, msg: envelope.msg, data: slimLuckinNode(envelope.data) })
  }
  return isEmpty(envelope.data) ? { msg: envelope.msg ?? 'success' } : pruneJson(slimLuckinNode(envelope.data))
}

// ── McDonald's ────────────────────────────────────────────────────────────

const dropZeroCoordinates = (value: Json): Json => {
  if (Array.isArray(value)) return value.map(dropZeroCoordinates)
  const record = asRecord(value)
  if (!record) return value
  const out: JsonRecord = {}
  for (const [key, child] of Object.entries(record)) {
    if ((key === 'longitude' || key === 'latitude') && child === 0) continue
    out[key] = dropZeroCoordinates(child)
  }
  return out
}

/**
 * query-meals → { categories: { 分类: "code,code" }, meals: { code: "名称 ¥现价（原¥…，优惠）[标签]" } }.
 * A 随单购 price only holds when the meal card is bought along, so the card
 * ids ride separately in withOrderCards and the line says which one.
 */
export const compactMcdMenu = (data: Json): Json => {
  const record = asRecord(data)
  const meals = asRecord(record?.meals)
  if (!record || !meals || !Array.isArray(record.categories)) return data
  const tagsByCode = new Map<string, Set<string>>()
  const categories: Record<string, string> = {}
  for (const category of record.categories) {
    const group = asRecord(category)
    if (!group || !Array.isArray(group.meals)) continue
    const codes: string[] = []
    for (const meal of group.meals) {
      const item = asRecord(meal)
      if (typeof item?.code !== 'string') continue
      codes.push(item.code)
      const tags = tagsByCode.get(item.code) ?? new Set<string>()
      if (Array.isArray(item.tags)) item.tags.forEach((tag) => typeof tag === 'string' && tags.add(tag))
      tagsByCode.set(item.code, tags)
    }
    categories[String(group.name).replace(/\s+/g, ' ')] = codes.join(',')
  }
  const cards: string[] = []
  const lines: Record<string, string> = {}
  for (const [code, value] of Object.entries(meals)) {
    const meal = asRecord(value) ?? {}
    const notes: string[] = []
    if (meal.originalPrice !== undefined && meal.originalPrice !== meal.currentPrice) notes.push(`原¥${meal.originalPrice}`)
    if (typeof meal.discountType === 'string') notes.push(meal.discountType)
    const card = asRecord(meal.withOrder)
    if (card) {
      const key = JSON.stringify(card)
      if (!cards.includes(key)) cards.push(key)
      notes.push(`随单购卡#${cards.indexOf(key)}`)
    }
    const tags = [...(tagsByCode.get(code) ?? [])]
    lines[code] = `${meal.name} ¥${meal.currentPrice}${notes.length ? `（${notes.join('，')}）` : ''}${tags.length ? `[${tags.join('/')}]` : ''}`
  }
  const out: JsonRecord = { categories, meals: lines }
  if (cards.length) out.withOrderCards = cards.map((card) => JSON.parse(card))
  for (const [key, value] of Object.entries(record)) {
    if (key !== 'categories' && key !== 'meals') out[key] = value
  }
  return out
}

/** McDonald's replies are { success, code, message, datetime, traceId, data }. */
export const slimMcdPayload = (payload: Json): Json => {
  const envelope = asRecord(payload)
  if (!envelope || !('success' in envelope) || !('data' in envelope || 'message' in envelope)) {
    return pruneJson(dropZeroCoordinates(payload))
  }
  if (envelope.success !== true) {
    return pruneJson({ code: envelope.code, message: envelope.message, data: envelope.data })
  }
  return isEmpty(envelope.data)
    ? { message: envelope.message ?? 'success' }
    : pruneJson(compactMcdMenu(dropZeroCoordinates(envelope.data)))
}

/** Text returned to the MCP client for a proxied tools/call. */
export const formatToolCallResult = (
  response: Json,
  slim: (payload: Json) => Json = pruneJson,
): string => {
  const { payload, isError, protocolError } = unwrapToolCall(response)
  // A JSON-RPC error is the protocol's shape, not the vendor's: vendor
  // slimmers would misread its code/message, so it goes out as is.
  const body = typeof payload === 'string' ? payload : JSON.stringify(protocolError ? payload : slim(payload))
  return isError ? `Error: ${body}` : body
}
