export const stripSpeakerPrefix = (content: string): string => {
  return content.replace(/^【[^】\r\n]+】\s*/, '')
}
