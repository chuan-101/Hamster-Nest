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
export const unwrapToolCall = (response: Json): { payload: Json; isError: boolean } => {
  const record = asRecord(response)
  const rpcError = asRecord(record?.error)
  if (rpcError) return { payload: rpcError.message ?? rpcError, isError: true }
  const result = asRecord(record?.result)
  if (!result) return { payload: response, isError: false }
  const isError = result.isError === true
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
      if (key === 'additionalProperties' || key === 'returnDirect' || key === '$schema') continue
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

/** Text returned to the MCP client for a proxied tools/call. */
export const formatToolCallResult = (
  response: Json,
  slim: (payload: Json) => Json = pruneJson,
): string => {
  const { payload, isError } = unwrapToolCall(response)
  const body = typeof payload === 'string' ? payload : JSON.stringify(slim(payload))
  return isError ? `Error: ${body}` : body
}
