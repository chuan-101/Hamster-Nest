const pad = (value: number) => value.toString().padStart(2, '0')

const formatOffset = (offsetMinutes: number) => {
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absoluteMinutes = Math.abs(offsetMinutes)
  const hours = pad(Math.floor(absoluteMinutes / 60))
  const minutes = pad(absoluteMinutes % 60)
  return `${sign}${hours}:${minutes}`
}

export const formatLocalTimestamp = (isoString: string) => {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) {
    return '1970-01-01 00:00 +00:00'
  }

  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const offset = formatOffset(-date.getTimezoneOffset())

  return `${year}-${month}-${day} ${hours}:${minutes} ${offset}`
}

export const withTimePrefix = (text: string, isoString: string) =>
  `[${formatLocalTimestamp(isoString)}] ${text}`
