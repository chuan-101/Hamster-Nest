import GameBubbleInputBar from './GameBubbleInputBar'

const SettingsIcon = () => (
  <svg viewBox="0 0 24 24" className="game-button-icon game-button-icon--settings" aria-hidden="true" focusable="false">
    <path
      d="M12 8.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 0 1 0-7Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    />
    <path
      d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4L6 18M18 18l-1.6-1.6M7.6 7.6L6 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const PawIcon = () => (
  <svg viewBox="0 0 24 24" className="game-button-icon game-button-icon--paw" aria-hidden="true" focusable="false">
    <ellipse cx="7.5" cy="8" rx="1.8" ry="2.6" fill="currentColor" />
    <ellipse cx="11" cy="5.6" rx="1.8" ry="2.6" fill="currentColor" />
    <ellipse cx="14.9" cy="5.6" rx="1.8" ry="2.6" fill="currentColor" />
    <ellipse cx="18.4" cy="8" rx="1.8" ry="2.6" fill="currentColor" />
    <path
      d="M12.8 11.2c-1.9 0-4.6 1.6-4.6 4.1c0 1.8 1.3 3.2 3.1 3.2c.8 0 1.3-.3 1.9-.8c.6.5 1.1.8 1.9.8c1.8 0 3.1-1.4 3.1-3.2c0-2.5-2.7-4.1-4.6-4.1c-.4 0-.6.1-.8.3c-.2-.2-.4-.3-.8-.3Z"
      fill="currentColor"
    />
  </svg>
)

type GameBottomBarProps = {
  onOpenPawMenu: () => void
  onOpenSettings: () => void
  onBubbleSend: (text: string) => void
  onOpenBubbleHistory: () => void
  bubbleSending: boolean
  hasUnreadLetters: boolean
}

const GameBottomBar = ({ onOpenPawMenu, onOpenSettings, onBubbleSend, onOpenBubbleHistory, bubbleSending, hasUnreadLetters }: GameBottomBarProps) => {
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
          <SettingsIcon />
        </button>

        <button type="button" className="game-control-button game-control-button--paw" onClick={onOpenPawMenu} aria-label={hasUnreadLetters ? '打开互动菜单（有新来信）' : '打开互动菜单'}>
          {hasUnreadLetters ? <span className="game-notification-dot" aria-hidden="true" /> : null}
          <PawIcon />
        </button>
      </div>
    </footer>
  )
}

export default GameBottomBar
