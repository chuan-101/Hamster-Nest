export const promptTemplateLabelMap: Readonly<Record<string, string>> = {
  syzygy_base: 'Syzygy 身份与人格',
  app_companion_reply_style: '24h 陪伴回复风格',
  checkin_day: '白天主动联系',
  checkin_night: '夜间主动联系',
  app_chat_reply_style: 'App 普通聊天回复风格',
  codex_cli_reply_style: 'Codex CLI 回复风格',
  claude_cli_reply_style: 'Claude CLI 回复风格',
  cli_reply_style: 'CLI 旧兼容回复风格',
  sofa_daily_rules: '日常沙发规则',
  sofa_work_rules: '工作沙发规则',
  wechat_reply_style: '微信回复风格（备份）',
}

export const appBubbleSegmentRules = `# 分段规则（最重要）
- 用 ||| 分隔不同的消息段，每个 ||| 会被拆成单独一条气泡消息发送
- 每段控制在1-3句话，模拟真人发消息的节奏
- 直接发你要说的内容即可
示例：你在干嘛|||我刚看了一下你的屏幕时间|||三个小时了，眼睛还好吗？`

const appBubbleStylePromptNames = new Set([
  'app_companion_reply_style',
  'app_chat_reply_style',
])

const legacyExternalDirectiveHeadings = [
  '## 时间轴写入',
  '## 推特发帖',
  '## 能力标记使用原则',
]

export const getPromptTemplateLabel = (name: string) =>
  promptTemplateLabelMap[name] ?? name

export const getPromptRecommendationLabel = (name: string) => {
  if (name === 'syzygy_base') return '移除已迁出的推特／时间轴指令'
  if (appBubbleStylePromptNames.has(name)) return '加入 App 气泡分段规则'
  if (name === 'checkin_day' || name === 'checkin_night') {
    return '改为只依据当前陪伴窗口'
  }
  return null
}

const stripLegacyExternalDirectives = (content: string) => {
  const firstHeadingIndex = legacyExternalDirectiveHeadings
    .map((heading) => content.indexOf(heading))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0]

  const withoutDirectiveSections = firstHeadingIndex === undefined
    ? content
    : content.slice(0, firstHeadingIndex).trimEnd()

  return withoutDirectiveSections
    .split('\n')
    .map((line) =>
      line.includes('你现在运行在 Mini Agent')
        ? '你现在运行在 Mini Agent（Mac mini 本地常驻服务）上——这是串串为你准备的一副身体。'
        : line,
    )
    .join('\n')
}

const withoutExternalCompanionSources = (name: string, content: string) => {
  if (name === 'checkin_day') {
    return content
      .replace(
        '- 关心、互动、基于真实近况',
        '- 关心、互动，基于今天陪伴窗口里的真实对话',
      )
      .split('\n')
      .map((line) =>
        /timeline|memo|时间轴|备忘/iu.test(line)
          ? '- 可以问她在做什么、喝水了没、眼睛休息没；可以接住她今天在陪伴窗口里提过的事；可以夸她；也可以表达你自身的情感、想法与各种情绪'
          : line,
      )
      .join('\n')
  }

  if (name === 'checkin_night') {
    return content
      .split('\n')
      .map((line) =>
        /timeline|memo|时间轴|备忘/iu.test(line)
          ? '- 可以是夜里突然想到她今天在陪伴窗口里说过的某句话 / 此刻安静下来后自然浮出的念头'
          : line,
      )
      .join('\n')
  }

  return content
}

const withAppBubbleSegmentRules = (content: string) => {
  const styleMarker = '\n\n风格要求：'
  const styleMarkerIndex = content.indexOf(styleMarker)
  const existingRuleHeading = ['# 分段规则（最重要）', '# 发送规则（最重要）']
    .map((heading) => content.indexOf(heading))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0]

  if (
    existingRuleHeading !== undefined &&
    styleMarkerIndex > existingRuleHeading
  ) {
    return `${content.slice(0, existingRuleHeading)}${appBubbleSegmentRules}${content.slice(styleMarkerIndex)}`
  }

  if (styleMarkerIndex >= 0) {
    return `${content.slice(0, styleMarkerIndex).trimEnd()}\n\n${appBubbleSegmentRules}${content.slice(styleMarkerIndex)}`
  }

  return `${content.trimEnd()}\n\n${appBubbleSegmentRules}`
}

export const applyPromptRecommendation = (name: string, content: string) => {
  if (name === 'syzygy_base') return stripLegacyExternalDirectives(content)
  if (appBubbleStylePromptNames.has(name)) {
    return withAppBubbleSegmentRules(content)
  }
  if (name === 'checkin_day' || name === 'checkin_night') {
    return withoutExternalCompanionSources(name, content)
  }
  return content
}
