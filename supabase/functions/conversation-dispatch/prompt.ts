export type ConversationPromptRow = {
  name: string
  content: string
  version: number
}

export type ConversationPromptNames = {
  identityPromptName: string
  stylePromptName: string | null
  rulesPromptName: string | null
}

export const resolveConversationProfileKey = ({
  conversationProfileKey,
  sessionKey,
}: {
  conversationProfileKey: string | null
  sessionKey: string | null
}) => {
  const explicitProfile = conversationProfileKey?.trim()
  if (explicitProfile) {
    return explicitProfile
  }

  if (sessionKey === 'syzygy_instant' || sessionKey === 'syzygy_companion') {
    return 'app_companion'
  }
  if (sessionKey === 'syzygy_cli' || sessionKey === 'syzygy_codex_cli') {
    return 'codex_cli'
  }
  if (sessionKey === 'syzygy_claude_cli') {
    return 'claude_cli'
  }
  return 'app_chat'
}

export const composeConversationSystemPrompt = ({
  names,
  activePrompts,
  legacySystemPrompt,
}: {
  names: ConversationPromptNames | null
  activePrompts: ConversationPromptRow[]
  legacySystemPrompt: string
}) => {
  const legacyPrompt = legacySystemPrompt.trim()
  if (!names) {
    return legacyPrompt
  }

  const promptByName = new Map(
    activePrompts.map((prompt) => [prompt.name, prompt.content.trim()]),
  )
  const requiredNames = [
    names.identityPromptName,
    names.stylePromptName,
    names.rulesPromptName,
  ].filter((name): name is string => Boolean(name))

  const resolvedLayers = requiredNames.map((name) => promptByName.get(name) ?? '')
  if (
    resolvedLayers.length !== requiredNames.length ||
    resolvedLayers.some((content) => !content)
  ) {
    return legacyPrompt
  }

  return resolvedLayers.join('\n\n')
}
