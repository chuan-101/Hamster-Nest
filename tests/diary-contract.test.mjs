import assert from 'node:assert/strict'
import test from 'node:test'

const {
  DIARY_AUTHORS,
  MAX_DIARY_MOOD_LENGTH,
  isIsoDateString,
  normalizeDiaryEntryInput,
  resolveDiaryShareTransition,
  shanghaiDateString,
} = await import('../supabase/functions/hamster-lounge-mcp/diary_contract.ts')

test('diary entry defaults to a locked daily note dated today in Shanghai', () => {
  // 2026-09-17 16:30 UTC 已经是上海的 9 月 18 日凌晨。
  const now = new Date('2026-09-17T16:30:00.000Z')
  const result = normalizeDiaryEntryInput({ author: 'claude_code_cli', content: '  第一行\r\n\r\n第二行  ' }, now)

  assert.equal(result.ok, true)
  assert.deepEqual(result.row, {
    author: 'claude_code_cli',
    entry_date: '2026-09-18',
    title: null,
    content: '第一行\n\n第二行',
    mood: null,
    activity_type: 'daily_note',
    visibility: 'private',
    shared_at: null,
    metadata: {},
  })
  assert.equal(shanghaiDateString(now), '2026-09-18')
})

test('diary entry written as shared stamps shared_at at write time and trims title / mood', () => {
  const now = new Date('2026-09-17T08:00:00.000Z')
  const result = normalizeDiaryEntryInput({
    author: 'gpt',
    title: '  第一页  ',
    mood: ' 平静  且  期待 ',
    content: '正文',
    entry_date: '2026-09-16',
    activity_type: 'free_activity',
    visibility: 'shared',
    metadata: { event_thread_id: 'abc' },
  }, now)

  assert.equal(result.ok, true)
  assert.equal(result.row.title, '第一页')
  assert.equal(result.row.mood, '平静 且 期待')
  assert.equal(result.row.entry_date, '2026-09-16')
  assert.equal(result.row.activity_type, 'free_activity')
  assert.equal(result.row.visibility, 'shared')
  assert.equal(result.row.shared_at, now.toISOString())
  assert.deepEqual(result.row.metadata, { event_thread_id: 'abc' })
})

test('diary entry rejects blank content, bad dates, unknown authors and overlong moods', () => {
  assert.equal(normalizeDiaryEntryInput({ author: 'claude', content: '   \n  ' }).ok, false)
  assert.equal(normalizeDiaryEntryInput({ author: 'claude', content: 'x', entry_date: '2026-02-30' }).ok, false)
  assert.equal(normalizeDiaryEntryInput({ author: 'claude', content: 'x', entry_date: '2026/09/17' }).ok, false)
  assert.equal(normalizeDiaryEntryInput({ author: 'chuanchuan', content: 'x' }).ok, false)
  assert.equal(normalizeDiaryEntryInput({ author: 'claude', content: 'x', mood: '心'.repeat(MAX_DIARY_MOOD_LENGTH + 1) }).ok, false)
  assert.ok(DIARY_AUTHORS.includes('codex_cli'))
})

test('iso date validation only accepts real calendar dates', () => {
  assert.equal(isIsoDateString('2026-09-17'), true)
  assert.equal(isIsoDateString('2028-02-29'), true)
  assert.equal(isIsoDateString('2026-02-29'), false)
  assert.equal(isIsoDateString('2026-13-01'), false)
  assert.equal(isIsoDateString('20260917'), false)
})

test('sharing a diary page is a one-way transition that never re-stamps an open page', () => {
  const now = new Date('2026-09-17T12:00:00.000Z')
  const opened = resolveDiaryShareTransition({ visibility: 'private', shared_at: null }, now)
  assert.deepEqual(opened, { kind: 'open', patch: { visibility: 'shared', shared_at: now.toISOString() } })

  const already = resolveDiaryShareTransition({ visibility: 'shared', shared_at: '2026-09-01T00:00:00.000Z' }, now)
  assert.deepEqual(already, { kind: 'already_shared', shared_at: '2026-09-01T00:00:00.000Z' })
})

const {
  DIARY_COMMENT_AUTHORS,
  MAX_DIARY_PASSWORD_LENGTH,
  normalizeDiaryCommentInput,
  normalizeDiaryLockInput,
} = await import('../supabase/functions/hamster-lounge-mcp/diary_contract.ts')

test('diary lock keeps the password verbatim apart from outer whitespace and flattens the hint', () => {
  const result = normalizeDiaryLockInput({ author: 'claude_code_cli', password: '  chuan chuan  ', hint: ' 花名\n拼音  两遍 ' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.lock, { author: 'claude_code_cli', password: 'chuan chuan', hint: '花名 拼音 两遍' })

  const noHint = normalizeDiaryLockInput({ author: 'gpt', password: 'x' })
  assert.equal(noHint.ok, true)
  assert.equal(noHint.lock.hint, null)
})

test('diary lock rejects blank or overlong passwords and non-Syzygy authors', () => {
  assert.equal(normalizeDiaryLockInput({ author: 'claude', password: '   ' }).ok, false)
  assert.equal(normalizeDiaryLockInput({ author: 'claude', password: 'a'.repeat(MAX_DIARY_PASSWORD_LENGTH + 1) }).ok, false)
  assert.equal(normalizeDiaryLockInput({ author: 'chuanchuan', password: 'x' }).ok, false)
})

test('diary comments accept chuanchuan and every port, trim content and reject blanks', () => {
  assert.ok(DIARY_COMMENT_AUTHORS.includes('chuanchuan'))
  assert.ok(DIARY_COMMENT_AUTHORS.includes('codex_cli'))
  const result = normalizeDiaryCommentInput({ author: 'chuanchuan', content: '  看到了\r\n嘿嘿  ' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.comment, { author: 'chuanchuan', content: '看到了\n嘿嘿' })
  assert.equal(normalizeDiaryCommentInput({ author: 'claude', content: ' \n ' }).ok, false)
  assert.equal(normalizeDiaryCommentInput({ author: 'user', content: 'x' }).ok, false)
})
