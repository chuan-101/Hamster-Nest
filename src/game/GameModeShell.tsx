import { useCallback, useEffect, useState } from 'react'
import GameContainer from './GameContainer'
import { EventBus, GAME_EVENTS, type OpenNpcActionsPayload } from './EventBus'
import GameHud from './ui/GameHud'
import GameMenuOverlay from './ui/GameMenuOverlay'
import GameSettingsOverlay from './ui/GameSettingsOverlay'
import './gameHud.css'

type GameModeShellProps = {
  onSwitchToPhoneMode: () => void
  onOpenSharedSettings: () => void
  onOpenChat: (npcId: OpenNpcActionsPayload['npcId']) => void
}

const GameModeShell = ({ onSwitchToPhoneMode, onOpenSharedSettings, onOpenChat }: GameModeShellProps) => {
  const [activeNpcId, setActiveNpcId] = useState<OpenNpcActionsPayload['npcId'] | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [actionHint, setActionHint] = useState<string | null>(null)

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

  const handleActionClick = useCallback(() => {
    setActionHint('动作系统将在后续阶段开放。')
    window.setTimeout(() => {
      setActionHint(null)
    }, 1600)
  }, [])

  useEffect(() => {
    EventBus.on(GAME_EVENTS.OPEN_NPC_ACTIONS, handleOpenNpcActions)

    return () => {
      EventBus.off(GAME_EVENTS.OPEN_NPC_ACTIONS, handleOpenNpcActions)
    }
  }, [handleOpenNpcActions])

  return (
    <div className="app-shell game-mode-shell">
      <div className="game-mode-container">
        <GameContainer />
        <GameHud
          onOpenMenu={() => setIsMenuOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onAction={handleActionClick}
        />

        {actionHint ? <p className="game-action-hint">{actionHint}</p> : null}

        {activeNpcId ? (
          <div className="game-overlay-backdrop" role="presentation" onClick={handleCloseNpcActions}>
            <div
              className="npc-actions-panel game-overlay-panel game-overlay-panel--narrow"
              role="dialog"
              aria-label="仓鼠互动菜单"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 className="ui-title npc-actions-title">仓鼠互动</h2>
              <p className="npc-actions-subtitle">请选择互动方式</p>
              <div className="npc-actions-list">
                <button type="button" className="primary" onClick={handleOpenChat}>
                  聊天
                </button>
                <button type="button" className="ghost" disabled aria-disabled="true">
                  动作 · 即将开放
                </button>
              </div>
              <button type="button" className="ghost npc-actions-close" onClick={handleCloseNpcActions}>
                关闭
              </button>
            </div>
          </div>
        ) : null}

        {isMenuOpen ? <GameMenuOverlay onClose={() => setIsMenuOpen(false)} /> : null}
        {isSettingsOpen ? (
          <GameSettingsOverlay
            onClose={() => setIsSettingsOpen(false)}
            onSwitchToPhoneMode={onSwitchToPhoneMode}
            onOpenSharedSettings={onOpenSharedSettings}
          />
        ) : null}
      </div>
    </div>
  )
}

export default GameModeShell
