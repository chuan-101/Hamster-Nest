type MenuEntry = {
  id: string
  title: string
  description: string
}

type GameMenuOverlayProps = {
  onClose: () => void
}

const GAME_MENU_ENTRIES: MenuEntry[] = [
  { id: 'snacks', title: '零食罐罐区', description: '以游戏模式外壳进入零食管理与投喂功能。' },
  { id: 'syzygy', title: '仓鼠观察日志', description: '以游戏模式外壳查看你的仓鼠观察记录。' },
  { id: 'checkin', title: '打卡', description: '以游戏模式外壳查看与管理每日打卡。' },
  { id: 'export', title: '数据导出', description: '以游戏模式外壳进入数据导出功能。' },
]

const GameMenuOverlay = ({ onClose }: GameMenuOverlayProps) => {
  return (
    <div className="game-overlay-backdrop" role="presentation" onClick={onClose}>
      <section
        className="game-overlay-panel"
        role="dialog"
        aria-modal="true"
        aria-label="游戏菜单"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="game-overlay-header">
          <h2 className="ui-title">游戏菜单</h2>
          <button type="button" className="ghost" onClick={onClose}>
            关闭
          </button>
        </header>
        <p className="game-overlay-subtitle">以下入口延续“共享能力 + 游戏模式外壳”的体验。</p>
        <div className="game-overlay-list">
          {GAME_MENU_ENTRIES.map((entry) => (
            <article key={entry.id} className="game-overlay-card">
              <h3>{entry.title}</h3>
              <p>{entry.description}</p>
              <button type="button" className="game-overlay-card__button" disabled aria-disabled="true">
                打开（占位）
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

export default GameMenuOverlay
