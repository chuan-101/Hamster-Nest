export type ChatSession = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  isArchived: boolean
  archivedAt: string | null
  overrideModel?: string | null
  overrideReasoning?: boolean | null
}

export type ChatMessage = {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  clientId: string
  clientCreatedAt: string | null
  meta?: {
    provider?: string
    model?: string
    streaming?: boolean
    reasoning?: string
    reasoning_text?: string
    reasoning_type?: 'reasoning' | 'thinking'
    params?: {
      temperature?: number
      top_p?: number
      max_tokens?: number
    }
  }
  pending?: boolean
}

export type UserSettings = {
  userId: string
  enabledModels: string[]
  defaultModel: string
  compressionEnabled: boolean
  compressionTriggerRatio: number
  compressionKeepRecentMessages: number
  summarizerModel: string | null
  memoryExtractModel: string | null
  memoryMergeEnabled: boolean
  memoryAutoExtractEnabled: boolean
  temperature: number
  topP: number
  maxTokens: number
  systemPrompt: string
  snackSystemOverlay: string
  syzygyPostSystemPrompt: string
  syzygyReplySystemPrompt: string
  letterReplySystemPrompt: string
  chatReasoningEnabled: boolean
  rpReasoningEnabled: boolean
  chatHighThinkingEnabled: boolean
  rpHighThinkingEnabled: boolean
  updatedAt: string
}

export type ExtractMessageInput = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export type SnackPost = {
  id: string
  userId: string
  content: string
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

export type SnackReply = {
  id: string
  userId: string
  postId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  isDeleted: boolean
  meta?: {
    provider?: string
    model?: string
    reasoning_text?: string
  }
}


export type SyzygyPost = {
  id: string
  userId: string
  content: string
  createdAt: string
  updatedAt: string
  isDeleted: boolean
  modelId?: string | null
}

export type SyzygyReply = {
  id: string
  userId: string
  postId: string
  authorRole: 'user' | 'ai'
  content: string
  createdAt: string
  isDeleted: boolean
  modelId?: string | null
}

export type MemoryStatus = 'confirmed' | 'pending'

export type MemoryEntry = {
  id: string
  userId: string
  content: string
  source: string
  status: MemoryStatus
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

export type CheckinEntry = {
  id: string
  userId: string
  checkinDate: string
  createdAt: string
}

export type RpSession = {
  id: string
  userId: string
  title: string
  tileColor: string | null
  createdAt: string
  updatedAt: string | null
  isArchived: boolean
  archivedAt: string | null
  playerDisplayName: string | null
  playerAvatarUrl: string | null
  worldbookText: string | null
  rpContextTokenLimit: number | null
  rpKeepRecentMessages: number | null
  settings: Record<string, unknown>
}

export type RpMessage = {
  id: string
  sessionId: string
  userId: string
  role: string
  content: string
  createdAt: string
  clientId: string | null
  clientCreatedAt: string | null
  meta?: Record<string, unknown>
}

export type RpNpcCard = {
  id: string
  sessionId: string
  userId: string
  displayName: string
  systemPrompt: string
  modelConfig: Record<string, unknown>
  apiConfig: Record<string, unknown>
  enabled: boolean
  createdAt: string
  updatedAt: string | null
}

export type ForumAuthorType = 'user' | 'ai'

export type ForumThread = {
  id: string
  userId: string
  title: string
  content: string
  authorType: ForumAuthorType
  authorSlot: number | null
  authorName: string | null
  createdAt: string
  updatedAt: string
}

export type ForumReply = {
  id: string
  threadId: string
  userId: string
  content: string
  authorType: ForumAuthorType
  authorSlot: number | null
  authorName: string | null
  parentId: string | null
  depth?: number
  sortPath?: string
  replyToType: 'thread' | 'reply' | null
  replyToReplyId: string | null
  replyToAuthorName: string | null
  createdAt: string
}

export type ForumAiProfile = {
  id: string
  userId: string
  slotIndex: number
  enabled: boolean
  displayName: string
  systemPrompt: string
  model: string
  temperature: number
  topP: number
  contextTokenLimit: number
  apiBaseUrl: string
  createdAt: string
  updatedAt: string
}

export type LetterModel = 'claude' | 'gpt' | 'gemini'

export type LetterTriggerType = 'manual' | 'scheduled' | 'event'

export type LetterEntry = {
  id: string
  userId: string
  model: LetterModel
  content: string
  triggerType: LetterTriggerType
  triggerReason: string | null
  createdAt: string
  isRead: boolean
  conversationId: string | null
  module: string | null
  metadata: Record<string, unknown> | null
}
