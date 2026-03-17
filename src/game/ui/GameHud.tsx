import GameBottomBar from './GameBottomBar'
import GameTopBar from './GameTopBar'

type GameHudProps = {
  onOpenPawMenu: () => void
  onOpenSettings: () => void
}

const GameHud = ({ onOpenPawMenu, onOpenSettings }: GameHudProps) => {
  return (
    <div className="game-hud-layer">
      <GameTopBar stamina={30} maxStamina={100} level={1} />
      <GameBottomBar onOpenPawMenu={onOpenPawMenu} onOpenSettings={onOpenSettings} />
    </div>
  )
}

export default GameHud
