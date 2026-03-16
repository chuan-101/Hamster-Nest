type GameBottomBarProps = {
  onOpenMenu: () => void
  onOpenSettings: () => void
  onAction: () => void
}

const GameBottomBar = ({ onOpenMenu, onOpenSettings, onAction }: GameBottomBarProps) => {
  return (
    <footer className="game-bottom-bar" aria-label="Game controls">
      <div className="game-direction-pad" aria-label="Directional controls placeholder">
        <button type="button" className="game-dpad-button game-dpad-button--up" aria-label="Move up" disabled>
          ▲
        </button>
        <button type="button" className="game-dpad-button game-dpad-button--left" aria-label="Move left" disabled>
          ◀
        </button>
        <button type="button" className="game-dpad-button game-dpad-button--right" aria-label="Move right" disabled>
          ▶
        </button>
        <button type="button" className="game-dpad-button game-dpad-button--down" aria-label="Move down" disabled>
          ▼
        </button>
      </div>

      <div className="game-control-actions">
        <button type="button" className="game-control-button" onClick={onOpenSettings}>
          Settings
        </button>
        <button type="button" className="game-control-button" onClick={onOpenMenu}>
          Menu
        </button>
        <button type="button" className="game-control-button game-control-button--action" onClick={onAction}>
          Action
        </button>
      </div>
    </footer>
  )
}

export default GameBottomBar
