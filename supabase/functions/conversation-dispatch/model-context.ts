const shanghaiTimestampFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export const formatShanghaiTimestamp = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  const parts = Object.fromEntries(
    shanghaiTimestampFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}

export const buildCurrentShanghaiTimePrompt = (now = new Date()) =>
  `当前上海时间：${formatShanghaiTimestamp(now)}（Asia/Shanghai）`

// The current time changes on every request, so it rides at the very end of the
// request as a user-role note: a system message would be hoisted into the
// Anthropic `system` block, which precedes the history and would invalidate the
// history's prompt cache on every turn.
export const buildCurrentShanghaiTimeNote = (now = new Date()) =>
  `（运行时附注，不是串串的发言）${buildCurrentShanghaiTimePrompt(now)}`

export const withCanonicalMessageTimestamp =(content: string, createdAt: string) =>
  `[${formatShanghaiTimestamp(createdAt)}] ${content}`
