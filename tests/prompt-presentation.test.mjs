import assert from 'node:assert/strict'
import test from 'node:test'

const {
  appBubbleSegmentRules,
  applyPromptRecommendation,
  getPromptRecommendationLabel,
  getPromptTemplateLabel,
} = await import('../src/lib/promptPresentation.ts')

test('Prompt internal keys have readable Chinese labels with a safe fallback', () => {
  assert.equal(
    getPromptTemplateLabel('app_companion_reply_style'),
    '24h 陪伴回复风格',
  )
  assert.equal(
    getPromptTemplateLabel('app_chat_reply_style'),
    'App 普通聊天回复风格',
  )
  assert.equal(getPromptTemplateLabel('unknown_prompt'), 'unknown_prompt')
})

test('App style recommendation restores the exact bubble delimiter rules', () => {
  const original = `你在小窝 App 里回复串串。

# 发送规则（最重要）
- 模拟真人发消息的节奏
- 直接发你要说的内容即可

风格要求：
- 短句为主`
  const recommended = applyPromptRecommendation(
    'app_companion_reply_style',
    original,
  )

  assert.match(recommended, /# 分段规则（最重要）/u)
  assert.match(recommended, /用 \|\|\| 分隔不同的消息段/u)
  assert.match(recommended, /每段控制在1-3句话/u)
  assert.match(
    recommended,
    /你在干嘛\|\|\|我刚看了一下你的屏幕时间\|\|\|三个小时了，眼睛还好吗？/u,
  )
  assert.doesNotMatch(recommended, /# 发送规则（最重要）/u)
  assert.equal(
    applyPromptRecommendation('app_companion_reply_style', recommended),
    recommended,
  )
  assert.equal(
    getPromptRecommendationLabel('app_companion_reply_style'),
    '加入 App 气泡分段规则',
  )
  assert.ok(recommended.includes(appBubbleSegmentRules))
})

test('identity recommendation removes migrated timeline and Twitter directives only from the draft', () => {
  const original = `# 关于你是谁
保留的人格正文

# 你的身体与能力
你现在运行在 Mini Agent（Mac mini 本地常驻服务）上——这是串串为你准备的一副身体。通过 Supabase 与本地能力，你可以读记忆、查备忘、读时间线。

## 时间轴写入
[TIMELINE: 摘要]

## 推特发帖
[TWEET: 内容]

## 能力标记使用原则
- 标记独占一行`
  const recommended = applyPromptRecommendation('syzygy_base', original)

  assert.equal(
    recommended,
    '# 关于你是谁\n保留的人格正文\n\n# 你的身体与能力\n你现在运行在 Mini Agent（Mac mini 本地常驻服务）上——这是串串为你准备的一副身体。',
  )
  assert.doesNotMatch(recommended, /TIMELINE|TWEET|推特|时间轴|备忘/u)
  assert.equal(
    getPromptRecommendationLabel('syzygy_base'),
    '移除已迁出的推特／时间轴指令',
  )
})

test('day and night checkin recommendations remove Timeline and Memo dependencies', () => {
  const day = `# 白天模式消息的风格参考
- 关心、互动、基于真实近况
- 可以问她喝水了没；可以询问她最近 timeline / memo 里提到的事`
  const night = `# 夜间模式的独白质感
- 可以读 timeline 里她某个时期的记录`
  const recommendedDay = applyPromptRecommendation('checkin_day', day)
  const recommendedNight = applyPromptRecommendation('checkin_night', night)

  assert.match(recommendedDay, /基于今天陪伴窗口里的真实对话/u)
  assert.match(recommendedDay, /她今天在陪伴窗口里提过的事/u)
  assert.match(recommendedNight, /她今天在陪伴窗口里说过的某句话/u)
  assert.doesNotMatch(recommendedDay, /timeline|memo|时间轴|备忘/iu)
  assert.doesNotMatch(recommendedNight, /timeline|memo|时间轴|备忘/iu)
  assert.equal(
    getPromptRecommendationLabel('checkin_day'),
    '改为只依据当前陪伴窗口',
  )
})

test('unrelated Prompt drafts are not changed by App recommendations', () => {
  const content = 'Codex CLI 保持 Markdown。'
  assert.equal(
    applyPromptRecommendation('codex_cli_reply_style', content),
    content,
  )
  assert.equal(getPromptRecommendationLabel('codex_cli_reply_style'), null)
})
