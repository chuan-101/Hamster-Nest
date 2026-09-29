/** Diary content is private; this policy applies only to generic CLI diary notices. */
export function isDiaryQuietTime(date = new Date()): boolean {
  const local = new Date(date.getTime() + 8 * 60 * 60_000)
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes()
  const day = local.getUTCDay()
  if (minutes < 8 * 60) {
    const previousDay = (day + 6) % 7
    return ![5, 6].includes(previousDay) || minutes >= 30
  }
  return ![5, 6].includes(day) && minutes >= 23 * 60 + 45
}
