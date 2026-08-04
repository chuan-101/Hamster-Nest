const PREVIEW_LENGTH = 140

/** Push 只展示模型正文的短预览；展示分段符不泄露为生硬的 `|||`。 */
export const normalizeConversationPushPreview = (content: string, maxLength = PREVIEW_LENGTH) => {
  const normalized = content.replace(/\|\|\|/gu, ' ').replace(/\s+/gu, ' ').trim()
  if (!normalized) return null
  const characters = Array.from(normalized)
  return characters.length <= maxLength
    ? normalized
    : `${characters.slice(0, Math.max(1, maxLength - 1)).join('')}…`
}

export const supportsConversationPushPreview = (entityType: string | null) =>
  entityType === 'conversation_message' || entityType === 'conversation_reply'

/** 陪伴通知以联系人名作标题；审批等其他事件继续保留 canonical event title。 */
export const resolvePushTitle = (eventTitle: string, entityType: string | null) =>
  supportsConversationPushPreview(entityType) ? 'Syzygy' : eventTitle
