// 写入端（source）标签：时间轴与事件集共用。source 表示"哪个端写的"，
// 和 recorder（记录者：串串 / Syzygy）是两个维度。

export const RECORD_SOURCE_META: Record<string, { label: string }> = {
  frontend: { label: '仓鼠窝前端' },
  wechat_api: { label: '微信' },
  client_gpt: { label: '客户端 GPT' },
  client_claude: { label: '客户端 Claude' },
  codex_cli: { label: 'Codex CLI' },
  claude_code_cli: { label: 'Claude Code CLI' },
  system: { label: '系统' },
  expo_app: { label: '鼠窝 App' },
  api: { label: 'API' },
  // 历史数据里已存在的旧来源值，保留可读标签。
  claude: { label: 'Claude' },
  gpt: { label: 'GPT' },
  gemini: { label: 'Gemini' },
  user: { label: '手动' },
}

// 新建 / 编辑表单可选来源（前端约定的来源端）。
export const RECORD_SOURCE_OPTIONS: string[] = [
  'frontend',
  'wechat_api',
  'client_gpt',
  'client_claude',
  'codex_cli',
  'claude_code_cli',
  'system',
]

export const getRecordSourceLabel = (source: string) => RECORD_SOURCE_META[source]?.label ?? source
