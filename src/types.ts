export type ChatSession = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  isArchived: boolean
  archivedAt: string | null
  overrideModel?: string | null
  overrideReasoning?: boolean | null
}

export type ChatToolCallStatus = {
  name: string
  status: 'running' | 'done' | 'error'
}

export type ChatMessage = {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  clientId: string
  clientCreatedAt: string | null
  meta?: {
    provider?: string
    model?: string
    streaming?: boolean
    reasoning?: string
    reasoning_text?: string
    reasoning_type?: 'reasoning' | 'thinking'
    toolCalls?: ChatToolCallStatus[]
    params?: {
      temperature?: number
      top_p?: number
      max_tokens?: number
    }
  }
  pending?: boolean
}

export type UserSettings = {
  userId: string
  enabledModels: string[]
  defaultModel: string
  compressionEnabled: boolean
  compressionTriggerRatio: number
  compressionKeepRecentMessages: number
  summarizerModel: string | null
  memoryExtractModel: string | null
  memoryMergeEnabled: boolean
  memoryAutoExtractEnabled: boolean
  temperature: number
  topP: number
  maxTokens: number
  systemPrompt: string
  snackSystemOverlay: string
  syzygyPostSystemPrompt: string
  syzygyReplySystemPrompt: string
  letterReplySystemPrompt: string
  chatReasoningEnabled: boolean
  rpReasoningEnabled: boolean
  chatHighThinkingEnabled: boolean
  rpHighThinkingEnabled: boolean
  bubbleChatModel: string | null
  bubbleChatSystemPrompt: string
  bubbleChatMaxTokens: number
  bubbleChatTemperature: number
  loungeScenePrompt: string
  updatedAt: string
}

export type ExtractMessageInput = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export type SnackPost = {
  id: string
  userId: string
  content: string
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

export type SnackReply = {
  id: string
  userId: string
  postId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  isDeleted: boolean
  meta?: {
    provider?: string
    model?: string
    reasoning_text?: string
  }
}


export type SyzygyPost = {
  id: string
  userId: string
  content: string
  createdAt: string
  updatedAt: string
  isDeleted: boolean
  modelId?: string | null
}

export type SyzygyReply = {
  id: string
  userId: string
  postId: string
  authorRole: 'user' | 'ai'
  content: string
  createdAt: string
  isDeleted: boolean
  modelId?: string | null
}

export type MemoryStatus = 'confirmed' | 'pending'

export type MemoryEntry = {
  id: string
  userId: string
  content: string
  source: string
  status: MemoryStatus
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

export type CheckinEntry = {
  id: string
  userId: string
  checkinDate: string
  createdAt: string
}

export type RpSession = {
  id: string
  userId: string
  title: string
  tileColor: string | null
  createdAt: string
  updatedAt: string | null
  isArchived: boolean
  archivedAt: string | null
  playerDisplayName: string | null
  playerAvatarUrl: string | null
  worldbookText: string | null
  rpContextTokenLimit: number | null
  rpKeepRecentMessages: number | null
  settings: Record<string, unknown>
}

export type RpMessage = {
  id: string
  sessionId: string
  userId: string
  role: string
  content: string
  createdAt: string
  clientId: string | null
  clientCreatedAt: string | null
  meta?: Record<string, unknown>
}

export type RpNpcCard = {
  id: string
  sessionId: string
  userId: string
  displayName: string
  systemPrompt: string
  modelConfig: Record<string, unknown>
  apiConfig: Record<string, unknown>
  enabled: boolean
  createdAt: string
  updatedAt: string | null
}

export type ForumAuthorType = 'user' | 'ai'

export type ForumThread = {
  id: string
  userId: string
  title: string
  content: string
  authorType: ForumAuthorType
  authorSlot: number | null
  authorName: string | null
  createdAt: string
  updatedAt: string
}

export type ForumReply = {
  id: string
  threadId: string
  userId: string
  content: string
  authorType: ForumAuthorType
  authorSlot: number | null
  authorName: string | null
  parentId: string | null
  depth?: number
  sortPath?: string
  replyToType: 'thread' | 'reply' | null
  replyToReplyId: string | null
  replyToAuthorName: string | null
  createdAt: string
}

export type ForumAiProfile = {
  id: string
  userId: string
  slotIndex: number
  enabled: boolean
  displayName: string
  systemPrompt: string
  model: string
  temperature: number
  topP: number
  contextTokenLimit: number
  apiBaseUrl: string
  createdAt: string
  updatedAt: string
}

export type LetterTriggerType = 'manual' | 'scheduled' | 'event'

export type LetterEntry = {
  id: string
  userId: string
  model: string
  content: string
  triggerType: LetterTriggerType
  triggerReason: string | null
  createdAt: string
  isRead: boolean
  conversationId: string | null
  module: string | null
  metadata: Record<string, unknown> | null
}

export type ChatTimelineMessageItem = {
  type: 'message'
  id: string
  sortTime: string
  message: ChatMessage
}

export type ChatTimelineLetterItem = {
  type: 'letter'
  id: string
  sortTime: string
  letter: LetterEntry
}

export type ChatTimelineItem = ChatTimelineMessageItem | ChatTimelineLetterItem

export type RpStoryGroup = {
  id: string
  userId: string
  name: string
  createdAt: string
  updatedAt: string | null
}

export type AgentCouncilSpeaker =
  | 'claude'
  | 'gpt'
  | 'gemini'
  | 'chuanchuan'
  | 'codex_cli'
  | 'claude_code_cli'

export type AgentCouncilEntryType = 'proposal' | 'review' | 'decision'

export type AgentCouncilProposalStatus =
  | 'open'
  | 'approved'
  | 'rejected'
  | 'deferred'
  | 'plan_generated'

export type AgentCouncilVote = 'support' | 'neutral' | 'against'

export type AgentCouncilMetadata = {
  risk_level?: string
  target_module?: string
  [key: string]: unknown
}

export type AgentCouncilMessage = {
  id: string
  speaker: AgentCouncilSpeaker
  topic: string
  message: string
  createdAt: string
  updatedAt: string | null
  parentId: string | null
  entryType: AgentCouncilEntryType | null
  proposalStatus: AgentCouncilProposalStatus | null
  vote: AgentCouncilVote | null
  metadata: AgentCouncilMetadata
}

export type RpSessionGroup = {
  id: string
  sessionId: string
  storyGroupId: string
  createdAt: string
}

export type BubbleSession = {
  id: string
  userId: string
  sessionDate: string
  createdAt: string
  updatedAt: string
}

export type MemoSource = 'user' | 'ai'

export type MemoTag = {
  id: string
  userId: string
  name: string
  createdAt: string
}

export type MemoEntry = {
  id: string
  userId: string
  content: string
  source: MemoSource
  isPinned: boolean
  createdAt: string
  updatedAt: string
  isDeleted: boolean
  tagIds: string[]
}

export type TimelineRecorder = 'chuanchuan' | 'syzygy'
export type TimelineSource = string

export type TimelineEntry = {
  id: string
  userId: string
  eventDate: string
  summary: string
  recorder: TimelineRecorder
  source: TimelineSource
  createdAt: string
  updatedAt: string
}

export type TodoCreatedBy = '串串' | 'syzygy'
export type TodoStatus = 'pending' | 'in_progress' | 'completed'
export type TodoType = 'short_term' | 'long_term'

export type TodoCategory = {
  id: string
  userId: string
  date: string
  name: string
  sortOrder: number
  createdAt: string
}

export type TodoItem = {
  id: string
  userId: string
  categoryId: string
  date: string
  title: string
  notes: string | null
  status: TodoStatus
  todoType: TodoType
  eventDate: string | null
  createdBy: TodoCreatedBy
  sortOrder: number
  createdAt: string
  completedAt: string | null
}

export type WikiEntryStatus = 'draft' | 'published'

export type WikiEntry = {
  id: string
  userId: string
  title: string
  content: string
  category: string
  tags: string[]
  status: WikiEntryStatus
  createdAt: string
  updatedAt: string
}

export type WalletQuestStatus = 'open' | 'completed' | 'cancelled'
export type WalletQuestCreator = 'chuanchuan' | 'syzygy'

export type WalletQuest = {
  id: string
  userId: string
  createdBy: WalletQuestCreator
  title: string
  description: string
  rewardPoints: number
  status: WalletQuestStatus
  completedAt: string | null
  completedNote: string | null
  createdAt: string
}

export type WalletTransactionType = 'earn' | 'exchange' | 'spend'

export type WalletTransaction = {
  id: string
  type: WalletTransactionType
  pointsDelta: number
  coinsDelta: number
  description: string
  questId: string | null
  createdAt: string
}

export type WalletBalance = {
  points: number
  coins: number
}

export type BubbleMessage = {
  id: string
  sessionId: string
  userId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export type NovelStatus = 'draft' | 'serializing' | 'completed'

export type NovelCharacterCard = {
  name: string
  description: string
  personality: string
}

export type NovelModelConfig = {
  writing_model: string
  summary_model: string
  context_window_chapters: number
  prompts: {
    outline_prompt: string
    writing_prompt: string
    summary_prompt: string
    character_gen_prompt: string
  }
}

export type NovelBook = {
  id: string
  userId: string
  title: string
  summary: string
  status: NovelStatus
  outline: string
  worldSetting: string
  characters: NovelCharacterCard[]
  modelConfig: Record<string, unknown>
  updatedAt: string
  createdAt: string
}

export type NovelChapterStatus = 'draft' | 'published'

export type NovelChapter = {
  id: string
  bookId: string
  chapterNumber: number
  title: string
  content: string
  directorNote: string
  summary: string
  status: NovelChapterStatus
  createdAt: string
  updatedAt: string
}

export type LoungeSofa = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export type LoungeMessage = {
  id: string
  sofaId: string
  sender: string
  content: string
  mentions: string[]
  meta: Record<string, unknown>
  createdAt: string
  pending?: boolean
  streaming?: boolean
}

export type LoungeMember = {
  sender: string
  displayName: string
  emoji: string
  color: string
}

export type ArchiveScope = 'chuanchuan' | 'syzygy'
export type ArchiveImportance = 'low' | 'normal' | 'high' | 'critical'

export type ArchiveCategory = {
  id: string
  userId: string
  parentId: string | null
  scope: ArchiveScope
  name: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type Archive = {
  id: string
  userId: string
  categoryId: string
  title: string
  content: string
  keywords: string[]
  aliases: string[]
  importance: ArchiveImportance
  source: string
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}
