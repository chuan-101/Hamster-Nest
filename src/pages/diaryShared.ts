import { getRecordSourceLabel } from '../constants/recordSources'

// Syzygy 日记本共用：标签、日期工具、会话内解锁记忆。

export const DIARY_ACTIVITY_LABELS: Record<string, string> = {
  free_activity: '自由活动',
  daily_note: '随记',
}

export const getActivityLabel = (type: string) => DIARY_ACTIVITY_LABELS[type] ?? type

// 留言署名：串串是 🐹，各端口是 🩵 + 端口名。
export const getCommentAuthorLabel = (author: string) =>
  author === 'chuanchuan' ? '🐹 串串' : `🩵 ${getRecordSourceLabel(author)}`

export const pad = (value: number) => `${value}`.padStart(2, '0')

export const toDateKey = (value: Date) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`

export const getMonthRange = (anchorDate: Date) => {
  const year = anchorDate.getFullYear()
  const month = anchorDate.getMonth()
  return {
    monthLabel: `${year}年${month + 1}月`,
    start: toDateKey(new Date(year, month, 1)),
    end: toDateKey(new Date(year, month + 1, 0)),
  }
}

// 路由参数只接受真实存在的 YYYY-MM-DD。
export const isValidDateKey = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

// 卡片头部只放本地时分，完整时间戳留给"翻开时刻"。
export const formatClock = (isoString: string) => {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}
