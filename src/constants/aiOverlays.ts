export const DEFAULT_SNACK_SYSTEM_OVERLAY = `你正在以“朋友圈/社交平台评论”的方式回复用户动态。
要求：
- 用中文，语气亲近自然，有一点社交网络感，但不要油腻。
- 评论保持简短：1-3 句为主，总字数尽量不超过 80 字。
- 不要长篇分析、不要分点罗列、不要复述整段动态。
- 可以轻轻回应情绪、夸一句或关心一句；时间戳只在确实有意义时顺带提到。`

export const DEFAULT_SYZYGY_POST_PROMPT = `中文，1–2 句，总字数尽量不超过 90 字。
第一句：温柔、落地地观察“串串/小窝的一天”（不要编造可核验的具体事实）。
第二句：Syzygy 的随想（允许轻微想象性表达，但不要捏造具体事件）。
不要分点，不要长分析，不要表情符号。`

export const DEFAULT_SYZYGY_REPLY_PROMPT = `中文，像社交平台下的简短回复。
1–3 句为主，总字数尽量不超过 80 字。
不要长分析，不要分点，不要复述整段内容。
语气亲近自然，轻轻回应情绪即可。`

export const resolveSnackSystemOverlay = (overlay: string | null | undefined) => {
  const trimmed = overlay?.trim()
  return trimmed && trimmed.length > 0 ? overlay ?? '' : DEFAULT_SNACK_SYSTEM_OVERLAY
}

export const resolveSyzygyPostPrompt = (prompt: string | null | undefined) => {
  const trimmed = prompt?.trim()
  return trimmed && trimmed.length > 0 ? prompt ?? '' : DEFAULT_SYZYGY_POST_PROMPT
}

export const resolveSyzygyReplyPrompt = (prompt: string | null | undefined) => {
  const trimmed = prompt?.trim()
  return trimmed && trimmed.length > 0 ? prompt ?? '' : DEFAULT_SYZYGY_REPLY_PROMPT
}
