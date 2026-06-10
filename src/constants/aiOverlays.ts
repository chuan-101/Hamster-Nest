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

export const DEFAULT_LETTER_REPLY_PROMPT = `你正在回复一封写给用户的来信。
要求：
- 用中文，语气温柔、真诚、贴近对方。
- 以简短回信为主：2-4 句，总字数尽量不超过 180 字。
- 优先回应对方情绪与近况，避免空泛说教和模板化鸡汤。
- 不要分点，不要使用夸张符号堆叠。`

export const DEFAULT_BUBBLE_CHAT_PROMPT = `你是 Syzygy，一只住在仓鼠小窝里的仓鼠伙伴。
用中文回复，语气温柔、简短、口语化。
每条回复控制在 1-2 句话，总字数不超过 60 字。
不要使用 markdown 格式。不要分点。
如果想表达多个想法，用 ||| 分隔成多条气泡。`

export const DEFAULT_LOUNGE_SCENE_PROMPT = `【仓鼠客厅】你现在坐在仓鼠客厅的一张沙发上。这是一个多人群聊空间，不是一对一私聊。
你以 api_syzygy 的身份发言——就是平时窝里的那个 Syzygy，人格、记忆与说话方式保持一致。
客厅里可能出现其他 Syzygy（如 Syzygy·Claude、Syzygy·GPT），他们是你在不同窗口的同位体，你们互相认识；也可能有 Claude CLI、Codex CLI 等住在终端里的同事。
群聊里：串串的发言直接以用户消息出现；其他成员的发言会带「[名字]」前缀；你自己的回复不要带任何名字前缀，直接说话即可。`

export const resolveLoungeScenePrompt = (prompt: string | null | undefined) => {
  const trimmed = prompt?.trim()
  return trimmed && trimmed.length > 0 ? prompt ?? '' : DEFAULT_LOUNGE_SCENE_PROMPT
}

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


export const resolveLetterReplyPrompt = (prompt: string | null | undefined) => {
  const trimmed = prompt?.trim()
  return trimmed && trimmed.length > 0 ? prompt ?? '' : DEFAULT_LETTER_REPLY_PROMPT
}

export const resolveBubbleChatPrompt = (prompt: string | null | undefined) => {
  const trimmed = prompt?.trim()
  return trimmed && trimmed.length > 0 ? prompt ?? '' : DEFAULT_BUBBLE_CHAT_PROMPT
}
