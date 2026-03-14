import { useEffect } from 'react'
import GameContainer from './GameContainer'
import { EventBus, GAME_EVENTS } from './EventBus'

type GameModeShellProps = {
  onSwitchToPhoneMode: () => void
  onOpenChat: () => void
}

const GameModeShell = ({ onSwitchToPhoneMode, onOpenChat }: GameModeShellProps) => {
  useEffect(() => {
    const handleOpenChat = () => {
      onOpenChat()
    }

    EventBus.on(GAME_EVENTS.OPEN_CHAT_WITH_SYZYGY, handleOpenChat)

    return () => {
      EventBus.off(GAME_EVENTS.OPEN_CHAT_WITH_SYZYGY, handleOpenChat)
    }
  }, [onOpenChat])

  return (
    <div className="app-shell game-mode-shell">
      <div className="game-mode-container">
        <div className="game-mode-toolbar">
          <h1>Game Mode</h1>
          <button type="button" className="primary" onClick={onSwitchToPhoneMode}>
            Back to Phone Mode
          </button>
        </div>
        <GameContainer />
      </div>
    </div>
  )
}

export default GameModeShell
