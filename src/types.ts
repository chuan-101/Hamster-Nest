export type ChatMessage = {
  id: string
  author: 'user' | 'assistant'
  text: string
  timestamp: string
}

export type ChatSession = {
  id: string
  title: string
  messages: ChatMessage[]
}
