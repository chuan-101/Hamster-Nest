export type ChatSession = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
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
  memoryExtractModel: string | null
  memoryMergeEnabled: boolean
  temperature: number
  topP: number
  maxTokens: number
  systemPrompt: string
  snackSystemOverlay: string
  syzygyPostSystemPrompt: string
  syzygyReplySystemPrompt: string
  enableReasoning: boolean
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
