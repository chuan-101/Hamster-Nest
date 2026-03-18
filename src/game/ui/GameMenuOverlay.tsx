import GameSystemModal from './GameSystemModal'

export type GameFeatureId = 'snacks' | 'syzygy' | 'checkin' | 'export'

type MenuEntry = {
  id: GameFeatureId
  title: string
  description: string
}

type GameMenuOverlayProps = {
  onClose: () => void
  onOpenFeature: (featureId: GameFeatureId) => void
}

const GAME_MENU_ENTRIES: MenuEntry[] = [
  { id: 'snacks', title: '零食罐罐区', description: '以游戏模式外壳进入零食管理与投喂功能。' },
  { id: 'syzygy', title: '仓鼠观察日志', description: '以游戏模式外壳查看你的仓鼠观察记录。' },
  { id: 'checkin', title: '打卡', description: '以游戏模式外壳查看与管理每日打卡。' },
  { id: 'export', title: '数据导出', description: '以游戏模式外壳进入数据导出功能。' },
]

const GameMenuOverlay = ({ onClose, onOpenFeature }: GameMenuOverlayProps) => {
  return (
    <GameSystemModal
      title="游戏菜单"
      ariaLabel="游戏菜单"
      subtitle="以下入口延续“共享能力 + 游戏模式外壳”的体验。"
      onClose={onClose}
      contentClassName="game-system-modal__content--menu"
    >
      <div className="game-system-modal__content-shell">
        <section className="game-settings-section" aria-label="游戏菜单入口">
          <p className="game-menu-section__title">系统功能入口</p>
          <p className="game-menu-section__hint">与游戏设置共享同一系统弹窗外壳，保留稳定尺寸，并在内容较多时于内部滚动。</p>
        </section>

        <div className="game-overlay-list game-overlay-list--scrollable">
          {GAME_MENU_ENTRIES.map((entry) => (
            <article key={entry.id} className="game-overlay-card game-overlay-card--menu">
              <div className="game-overlay-card__body">
                <h3>{entry.title}</h3>
                <p>{entry.description}</p>
              </div>
              <button type="button" className="game-overlay-card__button" onClick={() => onOpenFeature(entry.id)}>
                打开
              </button>
            </article>
          ))}
        </div>
      </div>
    </GameSystemModal>
  )
}

export default GameMenuOverlay
