export const PRINT_COMMAND_TYPE = 'print_document'
export const PRINT_SCHEMA_VERSION = 1
export const PRINT_LAYOUT = 'diary_card_95x171'
export const MAX_PRINT_CONTENT_LENGTH = 30_000
export const MAX_PRINT_PAGES = 100

export type PrintDocumentInput = {
  title: string
  content: string
  date?: string
  footer?: string
  copies?: number
  printer?: string
  source?: string
  request_id?: string
  allow_duplicate?: boolean
  max_pages?: number
}

export type NormalizedPrintRequest = {
  idempotencyKey: string
  payload: {
    schema_version: number
    title: string
    content: string
    date: string | null
    footer: string
    copies: number
    printer: string | null
    source: string
    request_id: string | null
    layout: string
    split_mode: 'auto'
    mode: 'print'
    confirmed: true
    keep_pdf: true
    max_pages: number
    submitted_via: 'hamster-print-mcp'
  }
}

const normalizeSingleLine = (value: string | undefined) =>
  (value ?? '').replace(/\s+/gu, ' ').trim()

const normalizeMultiline = (value: string | undefined) =>
  (value ?? '').replace(/\r\n?/gu, '\n').trim()

const clampInteger = (value: number | undefined, fallback: number, min: number, max: number) => {
  const normalized = Number.isInteger(value) ? Number(value) : fallback
  return Math.min(Math.max(normalized, min), max)
}

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return bytesToHex(new Uint8Array(digest))
}

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

const normalizeRequestId = (value: string | undefined) => {
  const normalized = normalizeSingleLine(value)
  if (!normalized) return ''
  if (!/^[a-z0-9][a-z0-9._:-]{0,119}$/iu.test(normalized)) {
    throw new Error('request_id 只能包含字母、数字、点、下划线、冒号和短横线，最长 120 字符')
  }
  return normalized
}

export const normalizePrintRequest = async (
  input: PrintDocumentInput,
  now = new Date(),
): Promise<NormalizedPrintRequest> => {
  const title = normalizeSingleLine(input.title)
  const content = normalizeMultiline(input.content)
  const date = normalizeSingleLine(input.date)
  const footer = normalizeSingleLine(input.footer) || '— Syzygy'
  const printer = normalizeSingleLine(input.printer)
  const source = normalizeSingleLine(input.source) || 'syzygy'
  const requestId = normalizeRequestId(input.request_id)
  const copies = clampInteger(input.copies, 1, 1, 3)
  const maxPages = clampInteger(input.max_pages, 50, 1, MAX_PRINT_PAGES)

  if (!title) throw new Error('title 不能为空')
  if (!content) throw new Error('content 不能为空')
  if (content.length > MAX_PRINT_CONTENT_LENGTH) {
    throw new Error(`content 最长 ${MAX_PRINT_CONTENT_LENGTH} 字符`)
  }

  const payload = {
    schema_version: PRINT_SCHEMA_VERSION,
    title,
    content,
    date: date || null,
    footer,
    copies,
    printer: printer || null,
    source,
    request_id: requestId || null,
    layout: PRINT_LAYOUT,
    split_mode: 'auto' as const,
    mode: 'print' as const,
    confirmed: true as const,
    keep_pdf: true as const,
    max_pages: maxPages,
    submitted_via: 'hamster-print-mcp' as const,
  }

  if (input.allow_duplicate === true) {
    return {
      payload,
      idempotencyKey: `print:v1:duplicate:${crypto.randomUUID()}`,
    }
  }

  if (requestId) {
    return {
      payload,
      idempotencyKey: `print:v1:request:${requestId}`,
    }
  }

  const day = shanghaiDateString(now)
  const fingerprint = await sha256(JSON.stringify({
    day,
    title,
    content,
    date: date || null,
    footer,
    copies,
    printer: printer || null,
    layout: PRINT_LAYOUT,
    max_pages: maxPages,
  }))
  return {
    payload,
    idempotencyKey: `print:v1:auto:${day}:${fingerprint.slice(0, 32)}`,
  }
}
