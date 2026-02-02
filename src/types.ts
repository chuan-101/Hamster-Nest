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
  meta?: {
    provider?: string
    model?: string
  }
}
