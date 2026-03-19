const ACTION_TAG_PATTERN = /\[action:\s*[^\]]*\]/gi

export const parseBubbleReply = (raw: string): string[] => {
  const stripped = raw.replace(ACTION_TAG_PATTERN, '').trim()
  if (!stripped) {
    return []
  }
  if (!stripped.includes('|||')) {
    return [stripped]
  }
  return stripped
    .split('|||')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}
