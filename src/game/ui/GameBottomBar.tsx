type GameBottomBarProps = {
  onOpenMenu: () => void
  onOpenSettings: () => void
  onAction: () => void
}

const GameBottomBar = ({ onOpenMenu, onOpenSettings, onAction }: GameBottomBarProps) => {
  return (
    <footer className="game-bottom-bar" aria-label="游戏操作栏">
      <div className="game-control-actions">
        <button type="button" className="game-control-button" onClick={onOpenSettings}>
          游戏设置
        </button>
        <button type="button" className="game-control-button" onClick={onOpenMenu}>
          菜单
        </button>
        <button type="button" className="game-control-button game-control-button--action" onClick={onAction}>
          动作
        </button>
      </div>

      <div className="game-direction-pad" aria-label="方向控制（占位）">
        <button type="button" className="game-dpad-button game-dpad-button--up" aria-label="向上移动" disabled>
          ▲
        </button>
        <button type="button" className="game-dpad-button game-dpad-button--left" aria-label="向左移动" disabled>
          ◀
        </button>
        <button type="button" className="game-dpad-button game-dpad-button--center" aria-label="方向键中心" disabled>
          ◆
        </button>
        <button type="button" className="game-dpad-button game-dpad-button--right" aria-label="向右移动" disabled>
          ▶
        </button>
        <button type="button" className="game-dpad-button game-dpad-button--down" aria-label="向下移动" disabled>
          ▼
        </button>
      </div>
    </footer>
  )
}

export default GameBottomBar
