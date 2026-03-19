import GameContainer from '../GameContainer'
import GameBottomBar from './GameBottomBar'
import GameTopBar from './GameTopBar'

type GameHudProps = {
  onOpenPawMenu: () => void
  onOpenSettings: () => void
  onBubbleSend: (text: string) => void
  onOpenBubbleHistory: () => void
  bubbleSending: boolean
}

const GameHud = ({ onOpenPawMenu, onOpenSettings, onBubbleSend, onOpenBubbleHistory, bubbleSending }: GameHudProps) => {
  return (
    <div className="game-hud-layout" aria-label="游戏模式主布局">
      <GameTopBar stamina={30} maxStamina={100} level={1} exp={45} maxExp={100} />
      <section className="game-viewport-shell" aria-label="游戏主视口">
        <div className="game-viewport-inner-frame">
          <GameContainer />
        </div>
      </section>
      <GameBottomBar
        onOpenPawMenu={onOpenPawMenu}
        onOpenSettings={onOpenSettings}
        onBubbleSend={onBubbleSend}
        onOpenBubbleHistory={onOpenBubbleHistory}
        bubbleSending={bubbleSending}
      />
    </div>
  )
}

export default GameHud
