import type { ReactNode, RefObject } from 'react'
import GameContainer from '../GameContainer'
import GameBottomBar from './GameBottomBar'
import GameTopBar from './GameTopBar'

type GameHudProps = {
  onOpenPawMenu: () => void
  onOpenSettings: () => void
  onBubbleSend: (text: string) => void
  onOpenBubbleHistory: () => void
  bubbleSending: boolean
  hasUnreadLetters: boolean
  viewportRef: RefObject<HTMLElement | null>
  viewportOverlay?: ReactNode
}

const GameHud = ({ onOpenPawMenu, onOpenSettings, onBubbleSend, onOpenBubbleHistory, bubbleSending, hasUnreadLetters, viewportRef, viewportOverlay }: GameHudProps) => {
  return (
    <div className="game-hud-layout" aria-label="游戏模式主布局">
      <GameTopBar stamina={30} maxStamina={100} level={1} exp={45} maxExp={100} />
      <section ref={viewportRef} className="game-viewport-shell" aria-label="游戏主视口">
        <div className="game-viewport-inner-frame">
          <GameContainer />
        </div>
        {viewportOverlay ? <div className="game-viewport-overlay-layer">{viewportOverlay}</div> : null}
      </section>
      <GameBottomBar
        onOpenPawMenu={onOpenPawMenu}
        onOpenSettings={onOpenSettings}
        onBubbleSend={onBubbleSend}
        onOpenBubbleHistory={onOpenBubbleHistory}
        bubbleSending={bubbleSending}
        hasUnreadLetters={hasUnreadLetters}
      />
    </div>
  )
}

export default GameHud
