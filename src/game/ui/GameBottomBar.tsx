import GameBubbleInputBar from './GameBubbleInputBar'

type GameBottomBarProps = {
  onOpenPawMenu: () => void
  onOpenSettings: () => void
  onBubbleSend: (text: string) => void
  onOpenBubbleHistory: () => void
  bubbleSending: boolean
}

const GameBottomBar = ({ onOpenPawMenu, onOpenSettings, onBubbleSend, onOpenBubbleHistory, bubbleSending }: GameBottomBarProps) => {
  return (
    <footer className="game-bottom-bar" aria-label="游戏操作栏">
      <div className="game-direction-pad" aria-label="方向控制（占位）">
        <button type="button" className="game-dpad-button game-dpad-button--up" aria-label="向上移动" disabled>
          <span className="game-dpad-button__arrow game-dpad-button__arrow--up" aria-hidden="true" />
        </button>
        <button type="button" className="game-dpad-button game-dpad-button--left" aria-label="向左移动" disabled>
          <span className="game-dpad-button__arrow game-dpad-button__arrow--left" aria-hidden="true" />
        </button>
        <button type="button" className="game-dpad-button game-dpad-button--center" aria-label="方向键中心" disabled />
        <button type="button" className="game-dpad-button game-dpad-button--right" aria-label="向右移动" disabled>
          <span className="game-dpad-button__arrow game-dpad-button__arrow--right" aria-hidden="true" />
        </button>
        <button type="button" className="game-dpad-button game-dpad-button--down" aria-label="向下移动" disabled>
          <span className="game-dpad-button__arrow game-dpad-button__arrow--down" aria-hidden="true" />
        </button>
      </div>

      <GameBubbleInputBar onSend={onBubbleSend} onOpenHistory={onOpenBubbleHistory} disabled={bubbleSending} />

      <div className="game-bottom-controls" aria-label="功能控制区">
        <button type="button" className="game-control-button game-control-button--icon" onClick={onOpenSettings} aria-label="打开游戏设置">
          设
        </button>

        <button type="button" className="game-control-button game-control-button--paw" onClick={onOpenPawMenu} aria-label="打开互动菜单">
          爪
        </button>
      </div>
    </footer>
  )
}

export default GameBottomBar
