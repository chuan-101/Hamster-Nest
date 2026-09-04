import type { EventThread } from '../types'

// 事件集分组 emoji，沿用 Memo 约定：🩷 串串相关 / 💙 Syzygy 相关 / 🤍 仓鼠窝相关。
export const EVENT_GROUP_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '🩷', label: '🩷 串串' },
  { value: '💙', label: '💙 Syzygy' },
  { value: '🤍', label: '🤍 仓鼠窝' },
]

export const EVENT_ORDER_STORAGE_KEY = 'hamster.events.entry-order.v1'

export type EntryOrder = 'asc' | 'desc'

export const readStoredEntryOrder = (): EntryOrder => {
  try {
    const raw = localStorage.getItem(EVENT_ORDER_STORAGE_KEY)
    return raw === 'desc' ? 'desc' : 'asc'
  } catch {
    return 'asc'
  }
}

export const storeEntryOrder = (order: EntryOrder) => {
  try {
    localStorage.setItem(EVENT_ORDER_STORAGE_KEY, order)
  } catch {
    // 私密模式等场景写不进去也无妨，只是下次不记忆。
  }
}

export const getTodayDateKey = () => {
  const date = new Date()
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

// 长文本判定：超过阈值的正文默认收起，提供展开按钮。
export const isLongText = (text: string, charThreshold = 120, lineThreshold = 4) =>
  text.length > charThreshold || text.split('\n').length > lineThreshold

export const formatDateRange = (thread: EventThread) => {
  if (thread.status === 'closed') {
    return `${thread.startedOn} → ${thread.endedOn ?? '？'}`
  }
  return `${thread.startedOn} → 至今`
}

export const describeThreadStatus = (thread: EventThread) => (thread.status === 'closed' ? '已结束' : '进行中')
