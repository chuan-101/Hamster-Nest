import type { BubbleMessage, BubbleSession } from '../../types'
import {
  resolveOrCreateBubbleSession,
  createBubbleMessage,
  fetchBubbleMessages,
} from '../../storage/supabaseSync'

export type BubbleChatEntry = {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

let cachedSession: BubbleSession | null = null
let cachedDateStr: string | null = null

function todayDateStr(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isCacheValid(): boolean {
  return cachedSession !== null && cachedDateStr === todayDateStr()
}

export async function resolveTodaySession(): Promise<BubbleSession> {
  const dateStr = todayDateStr()

  if (isCacheValid() && cachedSession) {
    return cachedSession
  }

  const session = await resolveOrCreateBubbleSession(dateStr)
  cachedSession = session
  cachedDateStr = dateStr
  return session
}

export async function persistBubbleMessage(
  role: 'user' | 'assistant',
  content: string,
): Promise<BubbleMessage> {
  const session = await resolveTodaySession()
  return createBubbleMessage(session.id, role, content)
}

function toBubbleChatEntry(msg: BubbleMessage): BubbleChatEntry {
  return {
    role: msg.role,
    content: msg.content,
    timestamp: new Date(msg.createdAt).getTime(),
  }
}

export async function getTodayEntries(): Promise<BubbleChatEntry[]> {
  try {
    const session = await resolveTodaySession()
    const messages = await fetchBubbleMessages(session.id)
    return messages.map(toBubbleChatEntry)
  } catch (error) {
    console.error('[bubble-chat] Failed to fetch today entries:', error)
    return []
  }
}

export function invalidateSessionCache(): void {
  cachedSession = null
  cachedDateStr = null
}
