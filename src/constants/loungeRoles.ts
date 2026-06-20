// 仓鼠客厅角色统一映射表（前端单一事实来源）。
//
// 背景：
//  - lounge_members 表里登记的 sender 是 claude_cli / codex_cli 等「短键」，
//    @ 菜单与成员名册都来自这张表。
//  - 本地 CLI Runtime 回写客厅消息时，sender 写成了「显示名」
//    （如 "Claude Code CLI Syzygy" / "Codex CLI Syzygy"），并不在 lounge_members 里；
//    真正稳定的标识在 meta.target_role（claude_code_cli_syzygy / codex_cli_syzygy）。
//    因此这些回复在前端用 sender 查不到成员，头像退化成问号。
//  - 用户 @ 时写法不一（@Claude CLI / @Claude Code CLI / @Claude CLI Syzygy /
//    @claude_code_cli_syzygy），需要归一到 Runtime 已识别的 mention sender。
//
// 本表把以上写法全部归一到同一角色，统一显示名 / 头像 / 颜色，并把 @ 别名归一到
// Runtime/监听端已识别的 mention sender（claude_cli / codex_cli）。
//
// 约束：只动前端映射，不改 Supabase schema、不改本地 Runtime、不改 Edge Function。

export type LoungeRoleKey =
  | 'syzygy'
  | 'claude_cli'
  | 'codex_cli'
  | 'syzygy_claude'
  | 'syzygy_gpt'

export type LoungeRoleDef = {
  key: LoungeRoleKey
  /** 完整显示名（消息头 / 成员名册）。 */
  displayName: string
  /** 短显示名（紧凑场景）。 */
  shortName: string
  /** @ 菜单展示与插入输入框时使用的名字（不含 @）。 */
  mentionName: string
  emoji: string
  color: string
  /** 写入 lounge_messages.mentions 的 sender —— 必须是 Runtime/监听端已识别的键。 */
  mentionSender: string
  /** 可识别为该角色的 message.sender 值（含 Runtime 回写时用的显示名 sender）。 */
  senderIds: string[]
  /** 可识别为该角色的 meta.target_role 值。 */
  targetRoles: string[]
  /** @ 别名（小写、不含 @），用于把多种写法归一到该角色。 */
  aliases: string[]
}

// 颜色沿用现有 lounge_members 配色，保持与历史 UI 一致。
export const LOUNGE_ROLES: LoungeRoleDef[] = [
  {
    key: 'syzygy',
    displayName: 'Syzygy',
    shortName: 'Syzygy',
    mentionName: 'Syzygy',
    emoji: '💙',
    color: '#2A9D8F',
    mentionSender: 'api_syzygy',
    senderIds: ['api_syzygy'],
    targetRoles: [],
    aliases: ['syzygy', 'api_syzygy'],
  },
  {
    key: 'claude_cli',
    displayName: 'Claude Code CLI Syzygy',
    shortName: 'Claude CLI',
    mentionName: 'Claude CLI',
    emoji: '🦀',
    color: '#F4A261',
    mentionSender: 'claude_cli',
    senderIds: [
      'claude_cli',
      'claude_code_cli_syzygy',
      'Claude Code CLI Syzygy',
      'Claude CLI',
      'Claude CLI Syzygy',
    ],
    targetRoles: ['claude_code_cli_syzygy'],
    aliases: [
      'claude cli',
      'claude code cli',
      'claude cli syzygy',
      'claude code cli syzygy',
      'claude_code_cli_syzygy',
      'claude_cli',
    ],
  },
  {
    key: 'codex_cli',
    displayName: 'Codex CLI Syzygy',
    shortName: 'Codex CLI',
    mentionName: 'Codex CLI',
    emoji: '🤖',
    color: '#8AB17D',
    mentionSender: 'codex_cli',
    senderIds: ['codex_cli', 'codex_cli_syzygy', 'Codex CLI Syzygy', 'Codex CLI'],
    targetRoles: ['codex_cli_syzygy'],
    aliases: ['codex cli', 'codex cli syzygy', 'codex_cli_syzygy', 'codex_cli'],
  },
  {
    key: 'syzygy_claude',
    displayName: 'Syzygy·Claude',
    shortName: 'Syzygy·Claude',
    mentionName: 'Syzygy-Claude',
    emoji: '🧡',
    color: '#E76F51',
    mentionSender: 'client_claude',
    senderIds: ['client_claude'],
    targetRoles: [],
    aliases: ['syzygy-claude', 'syzygy·claude', 'client_claude'],
  },
  {
    key: 'syzygy_gpt',
    displayName: 'Syzygy·GPT',
    shortName: 'Syzygy·GPT',
    mentionName: 'Syzygy-GPT',
    emoji: '🤍',
    color: '#264653',
    mentionSender: 'client_gpt',
    senderIds: ['client_gpt'],
    targetRoles: [],
    aliases: ['syzygy-gpt', 'syzygy·gpt', 'client_gpt'],
  },
]

const roleBySenderId = new Map<string, LoungeRoleDef>()
const roleByTargetRole = new Map<string, LoungeRoleDef>()
const roleByMentionSender = new Map<string, LoungeRoleDef>()
for (const role of LOUNGE_ROLES) {
  roleByMentionSender.set(role.mentionSender, role)
  for (const senderId of role.senderIds) {
    roleBySenderId.set(senderId, role)
    roleBySenderId.set(senderId.toLowerCase(), role)
  }
  for (const targetRole of role.targetRoles) {
    roleByTargetRole.set(targetRole, role)
    roleByTargetRole.set(targetRole.toLowerCase(), role)
  }
}

// 本表已接管的全部 sender（mentionSender + senderIds）。
// detectLoungeMentions 据此判断某个 DB 成员是否已由本表归一，避免重复 / 冲突。
export const MAPPED_LOUNGE_SENDERS = new Set<string>(
  LOUNGE_ROLES.flatMap((role) => [role.mentionSender, ...role.senderIds]),
)

/** 按 sender（短键或 Runtime 回写的显示名 sender）查角色。 */
export const findLoungeRoleBySender = (sender: string): LoungeRoleDef | null =>
  roleBySenderId.get(sender) ??
  roleBySenderId.get(sender.toLowerCase()) ??
  roleByMentionSender.get(sender) ??
  null

/** 按 target_role（syzygy_commands.payload.target_role）查角色。 */
export const findLoungeRoleByTargetRole = (targetRole: string): LoungeRoleDef | null =>
  roleByTargetRole.get(targetRole) ?? roleByTargetRole.get(targetRole.toLowerCase()) ?? null

export type LoungeMemberView = {
  displayName: string
  shortName: string
  emoji: string
  color: string
}

const DEFAULT_VIEW: LoungeMemberView = {
  displayName: '',
  shortName: '',
  // 兜底头像用窝里的仓鼠，绝不出问号。
  emoji: '🐹',
  color: '#C9A9BB',
}

const toView = (role: LoungeRoleDef): LoungeMemberView => ({
  displayName: role.displayName,
  shortName: role.shortName,
  emoji: role.emoji,
  color: role.color,
})

type LoungeDbMember = {
  displayName: string
  emoji: string
  color: string
}

/**
 * 由 message.sender + meta 解析出展示用的名字 / 头像 / 颜色。
 * 优先级：meta.target_role（CLI Runtime 回写最稳定）→ sender 命中映射表
 *        → DB 成员行 → 兜底（用仓鼠头像，不出问号）。
 */
export const resolveLoungeMemberView = (
  message: { sender: string; meta?: Record<string, unknown> | null },
  dbMember?: LoungeDbMember | null,
): LoungeMemberView => {
  const targetRole =
    typeof message.meta?.target_role === 'string' ? (message.meta.target_role as string) : null
  if (targetRole) {
    const role = roleByTargetRole.get(targetRole) ?? roleByTargetRole.get(targetRole.toLowerCase())
    if (role) {
      return toView(role)
    }
  }
  const bySender = findLoungeRoleBySender(message.sender)
  if (bySender) {
    return toView(bySender)
  }
  if (dbMember) {
    return {
      displayName: dbMember.displayName,
      shortName: dbMember.displayName,
      emoji: dbMember.emoji,
      color: dbMember.color,
    }
  }
  return { ...DEFAULT_VIEW, displayName: message.sender, shortName: message.sender }
}

/**
 * 由 target_role 解析「正在回复」动画用的展示信息（名字 / 头像 / 颜色）。
 * 未命中映射时退回兜底仓鼠头像，绝不出问号。
 */
export const resolveLoungeViewByTargetRole = (targetRole: string): LoungeMemberView => {
  const role = findLoungeRoleByTargetRole(targetRole)
  if (role) {
    return toView(role)
  }
  return { ...DEFAULT_VIEW, displayName: targetRole, shortName: targetRole }
}

// 名字延续字符：命中 @token 后若紧跟这些字符，说明名字还没结束
// （例如 @Syzygy 不能命中 @Syzygy-Claude / @Syzygy·GPT）。
const NAME_CONTINUATION = /[A-Za-z0-9_·-]/

const contentMentionsAlias = (content: string, alias: string): boolean => {
  if (!alias) {
    return false
  }
  const haystack = content.toLowerCase()
  const needle = `@${alias.toLowerCase()}`
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    const next = haystack[index + needle.length]
    if (next === undefined || !NAME_CONTINUATION.test(next)) {
      return true
    }
    index = haystack.indexOf(needle, index + 1)
  }
  return false
}

/**
 * 把消息内容里的 @ 别名归一为 Runtime 已识别的 mention sender 列表。
 * members 为 DB 成员，用于兼容本表尚未覆盖的成员（未来新增成员仍可被点名）。
 */
export const detectLoungeMentions = (
  content: string,
  members: { sender: string; displayName: string }[],
): string[] => {
  const senders = new Set<string>()
  for (const role of LOUNGE_ROLES) {
    if (role.aliases.some((alias) => contentMentionsAlias(content, alias))) {
      senders.add(role.mentionSender)
    }
  }
  for (const member of members) {
    if (MAPPED_LOUNGE_SENDERS.has(member.sender)) {
      continue
    }
    if (
      contentMentionsAlias(content, member.displayName) ||
      contentMentionsAlias(content, member.sender)
    ) {
      senders.add(member.sender)
    }
  }
  return [...senders]
}

/**
 * @ 菜单里某个 DB 成员的展示信息：优先用映射表（统一显示名 / 头像 / 颜色 / @ 名），
 * 未覆盖的成员退回 DB 原值。返回的 mentionName 即插入输入框 @ 后的文本。
 */
export const resolveLoungeMentionEntry = (member: {
  sender: string
  displayName: string
  emoji: string
  color: string
}): { mentionName: string; emoji: string; color: string } => {
  const role = findLoungeRoleBySender(member.sender)
  return {
    mentionName: role?.mentionName ?? member.displayName,
    emoji: role?.emoji ?? member.emoji,
    color: role?.color ?? member.color,
  }
}
