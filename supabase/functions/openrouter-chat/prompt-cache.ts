const EPHEMERAL_CACHE_CONTROL = { type: 'ephemeral' } as const

const withCacheControlText = (text: string) => [
  { type: 'text', text, cache_control: EPHEMERAL_CACHE_CONTROL },
]

/**
 * Index of the message that carries the conversation-history breakpoint: the
 * last `user` message that comes before the last `assistant` message.
 *
 * Anthropic caches everything up to a breakpoint, and a later request reuses
 * the cache only when its prefix matches byte for byte. Breaking on the user
 * turn that opened the previous exchange keeps the newest exchange, the
 * incoming user message, and any trailing runtime note (current time) out of
 * the cached prefix, so the next request still finds this one's entry.
 * `cache_control` on user content parts is the documented OpenRouter form.
 */
export const findHistoryBreakpointIndex = (messages: unknown[]): number => {
  let lastAssistantIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if ((messages[index] as Record<string, unknown> | null)?.role === 'assistant') {
      lastAssistantIndex = index
      break
    }
  }
  for (let index = lastAssistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index] as Record<string, unknown> | null
    if (message?.role !== 'user') continue
    // Already-wrapped content means a breakpoint is in place; don't add a second.
    if (Array.isArray(message.content)) return -1
    if (typeof message.content === 'string' && message.content.length > 0) return index
  }
  return -1
}

// Anthropic prompt caching: mark the stable request prefix with `cache_control`
// so repeated rounds in a session reuse the cached tokens at a fraction of the
// input cost. Only Claude models honor this; other providers ignore the extra
// field. Three breakpoints (Anthropic allows four): the last tool covers the
// tools block, the system prompt covers the system text, and one user turn in
// the history covers the conversation so far.
export const applyAnthropicPromptCaching = (payload: Record<string, unknown>): void => {
  // 1) Tool definitions: a single breakpoint on the last tool caches the entire
  //    tools block. Idempotent — re-applying the same marker is harmless.
  const tools = payload.tools
  if (Array.isArray(tools) && tools.length > 0) {
    const lastTool = tools[tools.length - 1]
    if (lastTool && typeof lastTool === 'object') {
      ;(lastTool as Record<string, unknown>).cache_control = EPHEMERAL_CACHE_CONTROL
    }
  }

  // 2) Conversation history. Replace the message with a copy so the caller's
  //    canonical history objects keep their plain-string content.
  const messages = payload.messages
  if (Array.isArray(messages)) {
    const breakpointIndex = findHistoryBreakpointIndex(messages)
    if (breakpointIndex >= 0) {
      const message = messages[breakpointIndex] as Record<string, unknown>
      const nextMessages = [...messages]
      nextMessages[breakpointIndex] = {
        ...message,
        content: withCacheControlText(message.content as string),
      }
      payload.messages = nextMessages
    }
  }

  // 3) System prompt, two shapes depending on provider path:
  //    - top-level `system` string (Anthropic-native / AiHubMix hoist)
  //    - a `role: "system"` message (OpenRouter pass-through)
  //    The `typeof … === 'string'` guards keep this safe to call more than once
  //    (already-wrapped content is an array and is skipped).
  if (typeof payload.system === 'string' && payload.system.length > 0) {
    payload.system = withCacheControlText(payload.system)
    return
  }
  const outgoingMessages = payload.messages
  if (Array.isArray(outgoingMessages)) {
    const systemMessage = outgoingMessages.find(
      (message) => (message as Record<string, unknown>)?.role === 'system',
    ) as Record<string, unknown> | undefined
    if (systemMessage && typeof systemMessage.content === 'string' && systemMessage.content.length > 0) {
      systemMessage.content = withCacheControlText(systemMessage.content)
    }
  }
}
