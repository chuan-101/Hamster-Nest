import GameBottomBar from './GameBottomBar'
import GameTopBar from './GameTopBar'

type GameHudProps = {
  onOpenMenu: () => void
  onOpenSettings: () => void
  onAction: () => void
}

const GameHud = ({ onOpenMenu, onOpenSettings, onAction }: GameHudProps) => {
  return (
    <div className="game-hud-layer">
      <GameTopBar stamina={80} maxStamina={100} level={8} />
      <GameBottomBar onOpenMenu={onOpenMenu} onOpenSettings={onOpenSettings} onAction={onAction} />
    </div>
  )
}

export default GameHud
