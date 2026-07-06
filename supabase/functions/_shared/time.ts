// Beijing-time helpers shared by letter/wechat functions.

const toBeijingDate = (from: Date = new Date()): Date => {
  const bjOffset = 8 * 60
  const utcMs = from.getTime() + from.getTimezoneOffset() * 60000
  return new Date(utcMs + bjOffset * 60000)
}

export const getBeijingDate = () => {
  const bjDate = toBeijingDate()
  return {
    month: bjDate.getMonth() + 1,
    day: bjDate.getDate(),
    hour: bjDate.getHours(),
    minute: bjDate.getMinutes(),
    dateStr: bjDate.toISOString().slice(0, 10),
    fullDate: bjDate,
  }
}

export const getBeijingTimeString = (): string => {
  const bjDate = toBeijingDate()
  const year = bjDate.getFullYear()
  const month = bjDate.getMonth() + 1
  const day = bjDate.getDate()
  const hour = bjDate.getHours()
  const minute = bjDate.getMinutes()
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const weekday = weekdays[bjDate.getDay()]

  let period = ''
  if (hour >= 5 && hour < 9) period = '早晨'
  else if (hour >= 9 && hour < 12) period = '上午'
  else if (hour >= 12 && hour < 14) period = '中午'
  else if (hour >= 14 && hour < 17) period = '下午'
  else if (hour >= 17 && hour < 19) period = '傍晚'
  else if (hour >= 19 && hour < 22) period = '晚上'
  else if (hour >= 22 || hour < 1) period = '深夜'
  else period = '凌晨'

  return `${year}年${month}月${day}日 ${weekday} ${period} ${hour}:${String(minute).padStart(2, '0')}`
}

export const formatBeijingClock = (from: Date): string => {
  const bj = toBeijingDate(from)
  return `${bj.getHours()}:${String(bj.getMinutes()).padStart(2, '0')}`
}
