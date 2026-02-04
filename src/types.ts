export type ChatSession = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
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
  temperature: number
  topP: number
  maxTokens: number
  systemPrompt: string
  updatedAt: string
}
