import assert from 'node:assert/strict'
import test from 'node:test'

const {
  MAX_PRINT_CONTENT_LENGTH,
  normalizePrintRequest,
  PRINT_COMMAND_TYPE,
  PRINT_LAYOUT,
} = await import('../supabase/functions/hamster-print-mcp/print_contract.ts')

test('print contract builds a versioned Mac mini command payload', async () => {
  const result = await normalizePrintRequest({
    title: ' 第四年的第一页 ',
    content: '第一段\r\n\r\n第二段 ',
    request_id: 'anniversary-2026-v1',
    source: 'chatgpt_web',
  })

  assert.equal(PRINT_COMMAND_TYPE, 'print_document')
  assert.equal(result.idempotencyKey, 'print:v1:request:anniversary-2026-v1')
  assert.equal(result.payload.schema_version, 1)
  assert.equal(result.payload.layout, PRINT_LAYOUT)
  assert.equal(result.payload.split_mode, 'auto')
  assert.equal(result.payload.mode, 'print')
  assert.equal(result.payload.confirmed, true)
  assert.equal(result.payload.keep_pdf, true)
  assert.equal(result.payload.title, '第四年的第一页')
  assert.equal(result.payload.content, '第一段\n\n第二段')
  assert.equal(result.payload.copies, 1)
  assert.equal(result.payload.max_pages, 50)
})

test('automatic print idempotency is stable for normalized same-day content', async () => {
  const now = new Date('2026-07-19T12:00:00.000Z')
  const first = await normalizePrintRequest({ title: '测试', content: '正文\r\n第二行', source: 'chatgpt_web' }, now)
  const second = await normalizePrintRequest({ title: '  测试 ', content: '正文\n第二行  ', source: 'codex_desktop' }, now)

  assert.equal(first.idempotencyKey, second.idempotencyKey)
  assert.match(first.idempotencyKey, /^print:v1:auto:2026-07-19:[0-9a-f]{32}$/u)
})

test('duplicate override creates a fresh idempotency key', async () => {
  const first = await normalizePrintRequest({ title: '再打一份', content: '同一正文', allow_duplicate: true })
  const second = await normalizePrintRequest({ title: '再打一份', content: '同一正文', allow_duplicate: true })
  assert.notEqual(first.idempotencyKey, second.idempotencyKey)
  assert.match(first.idempotencyKey, /^print:v1:duplicate:/u)
})

test('print contract rejects empty or oversized content', async () => {
  await assert.rejects(() => normalizePrintRequest({ title: '空', content: '   ' }), /content 不能为空/u)
  await assert.rejects(
    () => normalizePrintRequest({ title: '太长', content: '字'.repeat(MAX_PRINT_CONTENT_LENGTH + 1) }),
    /content 最长/u,
  )
})
