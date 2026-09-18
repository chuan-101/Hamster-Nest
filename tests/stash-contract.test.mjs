import assert from 'node:assert/strict'
import test from 'node:test'

const {
  STASH_ADDERS,
  MAX_STASH_TITLE_LENGTH,
  deriveStashTitleFromUrl,
  normalizeStashCommentInput,
  normalizeStashFolderInput,
  normalizeStashItemInput,
  normalizeStashTags,
  normalizeStashUrl,
} = await import('../supabase/functions/hamster-knowledge-mcp/stash_contract.ts')

test('stash url key strips tracking params, www, fragment and trailing slash', () => {
  const result = normalizeStashUrl('https://www.GitHub.com/anthropics/claude-code/?utm_source=xhs&ref=abc#readme')
  assert.equal(result.ok, true)
  assert.equal(result.url, 'https://www.github.com/anthropics/claude-code/?utm_source=xhs&ref=abc#readme')
  assert.equal(result.url_key, 'https://github.com/anthropics/claude-code?ref=abc')
})

test('stash url key sorts surviving params and keeps xiaohongshu note ids while dropping share noise', () => {
  const noisy = normalizeStashUrl(
    'https://www.xiaohongshu.com/explore/66f1abc?xsec_token=ABC&xsec_source=pc_share&app_platform=ios&apptime=1&share_id=9&b=2&a=1',
  )
  const clean = normalizeStashUrl('https://xiaohongshu.com/explore/66f1abc?a=1&b=2')
  assert.equal(noisy.ok, true)
  assert.equal(clean.ok, true)
  assert.equal(noisy.url_key, clean.url_key)
  assert.equal(noisy.url_key, 'https://xiaohongshu.com/explore/66f1abc?a=1&b=2')
})

test('stash url accepts a bare domain, keeps the root path and rejects garbage', () => {
  const bare = normalizeStashUrl('github.com')
  assert.equal(bare.ok, true)
  assert.equal(bare.url, 'https://github.com/')
  assert.equal(bare.url_key, 'https://github.com/')

  assert.equal(normalizeStashUrl('   ').ok, false)
  assert.equal(normalizeStashUrl('not a url').ok, false)
  assert.equal(normalizeStashUrl('ftp://example.com/file').ok, false)
  assert.equal(normalizeStashUrl('localhost').ok, false)
})

test('stash item derives a readable title from the url when none is given', () => {
  assert.equal(deriveStashTitleFromUrl('https://www.github.com/chuan-101/Hamster-Nest/'), 'github.com/chuan-101/Hamster-Nest')
  const result = normalizeStashItemInput({ url: 'https://github.com/chuan-101/Hamster-Nest' })
  assert.equal(result.ok, true)
  assert.equal(result.row.title, 'github.com/chuan-101/Hamster-Nest')
  assert.equal(result.row.added_by, 'chuanchuan')
  assert.equal(result.row.status, 'stashed')
  assert.equal(result.row.folder_id, null)
  assert.equal(result.row.content, null)
  assert.deepEqual(result.row.tags, [])
  assert.deepEqual(result.row.metadata, {})
})

test('stash item keeps url and url_key paired and trims everything else', () => {
  const result = normalizeStashItemInput({
    title: '  好  仓库 ',
    url: ' https://www.example.com/a/?utm_medium=x ',
    content: ' 第一行\r\n第二行 ',
    tags: [' agent ', 'agent', '', 'UI'],
    folder_id: ' abc ',
    added_by: 'claude_code_cli',
    status: 'eaten',
    metadata: { stars: 12 },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.row, {
    folder_id: 'abc',
    title: '好 仓库',
    url: 'https://www.example.com/a/?utm_medium=x',
    url_key: 'https://example.com/a',
    content: '第一行\n第二行',
    tags: ['agent', 'UI'],
    added_by: 'claude_code_cli',
    status: 'eaten',
    metadata: { stars: 12 },
  })
})

test('stash item rejects empty payloads, bad adders, bad statuses and overlong titles', () => {
  assert.equal(normalizeStashItemInput({}).ok, false)
  assert.equal(normalizeStashItemInput({ title: '只有标题' }).ok, false)
  assert.equal(normalizeStashItemInput({ content: '只有正文没标题' }).ok, false)
  assert.equal(normalizeStashItemInput({ title: 'x', content: 'y', added_by: 'someone' }).ok, false)
  assert.equal(normalizeStashItemInput({ title: 'x', content: 'y', status: 'digested' }).ok, false)
  assert.equal(normalizeStashItemInput({ title: '字'.repeat(MAX_STASH_TITLE_LENGTH + 1), content: 'y' }).ok, false)
  assert.equal(normalizeStashItemInput({ title: 'x', url: 'nope' }).ok, false)
  assert.equal(normalizeStashItemInput({ title: '只有正文', content: '也行' }).ok, true)
  assert.ok(STASH_ADDERS.includes('gemini'))
})

test('stash tags dedupe after trimming', () => {
  assert.deepEqual(normalizeStashTags(['a', ' a', 'b ', '', '  ']), ['a', 'b'])
  assert.deepEqual(normalizeStashTags(undefined), [])
})

test('stash folder normalizes name / icon / parent and rejects blanks', () => {
  const result = normalizeStashFolderInput({ name: '  GitHub 可学习仓库 ', icon: ' 🐙 ', description: '', parent_id: '', sort_order: 2.7 })
  assert.equal(result.ok, true)
  assert.deepEqual(result.row, { name: 'GitHub 可学习仓库', icon: '🐙', description: null, parent_id: null, sort_order: 2 })
  assert.equal(normalizeStashFolderInput({ name: '   ' }).ok, false)
  assert.equal(normalizeStashFolderInput({ name: 'x', icon: '不是一个emoji吧' }).ok, false)
})

test('stash comment requires a known author and non-blank content', () => {
  const ok = normalizeStashCommentInput({ author: 'gpt', content: ' 这个仓库我看过了 \n' })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.comment, { author: 'gpt', content: '这个仓库我看过了' })
  assert.equal(normalizeStashCommentInput({ author: 'stranger', content: 'x' }).ok, false)
  assert.equal(normalizeStashCommentInput({ author: 'chuanchuan', content: '  ' }).ok, false)
})
