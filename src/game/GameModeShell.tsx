import { useCallback, useEffect, useState } from 'react'
import GameContainer from './GameContainer'
import { EventBus, GAME_EVENTS, type OpenNpcActionsPayload } from './EventBus'

type GameModeShellProps = {
  onSwitchToPhoneMode: () => void
  onOpenChat: (npcId: OpenNpcActionsPayload['npcId']) => void
}

const GameModeShell = ({ onSwitchToPhoneMode, onOpenChat }: GameModeShellProps) => {
  const [activeNpcId, setActiveNpcId] = useState<OpenNpcActionsPayload['npcId'] | null>(null)

  const handleOpenNpcActions = useCallback((payload: OpenNpcActionsPayload) => {
    setActiveNpcId(payload.npcId)
  }, [])

  const handleCloseNpcActions = useCallback(() => {
    setActiveNpcId(null)
  }, [])

  const handleOpenChat = useCallback(() => {
    if (!activeNpcId) {
      return
    }
    onOpenChat(activeNpcId)
    setActiveNpcId(null)
  }, [activeNpcId, onOpenChat])

  useEffect(() => {
    EventBus.on(GAME_EVENTS.OPEN_NPC_ACTIONS, handleOpenNpcActions)

    return () => {
      EventBus.off(GAME_EVENTS.OPEN_NPC_ACTIONS, handleOpenNpcActions)
    }
  }, [handleOpenNpcActions])

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
        {activeNpcId ? (
          <div className="npc-actions-overlay" role="presentation" onClick={handleCloseNpcActions}>
            <div
              className="npc-actions-panel glass-panel"
              role="dialog"
              aria-label="Syzygy interaction menu"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 className="ui-title npc-actions-title">Syzygy</h2>
              <p className="npc-actions-subtitle">Choose an interaction</p>
              <div className="npc-actions-list">
                <button type="button" className="primary" onClick={handleOpenChat}>
                  Chat
                </button>
                <button type="button" className="ghost" disabled aria-disabled="true">
                  Action · Coming soon
                </button>
              </div>
              <button type="button" className="ghost npc-actions-close" onClick={handleCloseNpcActions}>
                Close
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default GameModeShell
