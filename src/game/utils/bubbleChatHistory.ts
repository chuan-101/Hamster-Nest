const STORAGE_KEY = 'hamster-nest:bubble-chat-history'

export type BubbleChatEntry = {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

function loadAll(): BubbleChatEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveAll(entries: BubbleChatEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // storage full – silently drop
  }
}

function startOfToday(): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

export function getTodayEntries(): BubbleChatEntry[] {
  const cutoff = startOfToday()
  return loadAll().filter((entry) => entry.timestamp >= cutoff)
}

export function appendEntry(role: BubbleChatEntry['role'], content: string): void {
  const all = loadAll()
  all.push({ role, content, timestamp: Date.now() })

  // keep at most 200 entries to avoid unbounded growth
  const trimmed = all.length > 200 ? all.slice(all.length - 200) : all
  saveAll(trimmed)
}
