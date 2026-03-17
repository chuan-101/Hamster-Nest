import { useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { EventBus, GAME_EVENTS, type OpenNpcActionsPayload } from './EventBus'
import GameHud from './ui/GameHud'
import type { GameFeatureId } from './ui/GameMenuOverlay'
import GameSettingsOverlay from './ui/GameSettingsOverlay'
import GameFeatureShell from './ui/GameFeatureShell'
import SnacksPage from '../pages/SnacksPage'
import SyzygyFeedPage from '../pages/SyzygyFeedPage'
import CheckinPage from '../pages/CheckinPage'
import ExportPage from '../pages/ExportPage'
import './gameHud.css'

type SharedSnackAiConfig = {
  model: string
  reasoning: boolean
  temperature: number
  topP: number
  maxTokens: number
  systemPrompt: string
  snackSystemOverlay: string
  syzygyPostSystemPrompt: string
  syzygyReplySystemPrompt: string
}

type GameModeShellProps = {
  onSwitchToPhoneMode: () => void
  onOpenSharedSettings: () => void
  onOpenChat: (npcId: OpenNpcActionsPayload['npcId']) => void
  user: User | null
  snackAiConfig: SharedSnackAiConfig
  syzygyAiConfig: SharedSnackAiConfig
}

const GAME_FEATURE_META: Record<GameFeatureId, { title: string; subtitle: string }> = {
  snacks: { title: '零食罐罐区', subtitle: '游戏模式面板 · 零食管理与投喂' },
  syzygy: { title: '仓鼠观察日志', subtitle: '游戏模式面板 · 观察记录' },
  checkin: { title: '打卡', subtitle: '游戏模式面板 · 每日陪伴打卡' },
  export: { title: '数据导出', subtitle: '游戏模式面板 · 导出数据包' },
}

const GameModeShell = ({
  onSwitchToPhoneMode,
  onOpenSharedSettings,
  onOpenChat,
  user,
  snackAiConfig,
  syzygyAiConfig,
}: GameModeShellProps) => {
  const [activeNpcId, setActiveNpcId] = useState<OpenNpcActionsPayload['npcId'] | null>(null)
  const [isPawMenuOpen, setIsPawMenuOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [activeFeature, setActiveFeature] = useState<GameFeatureId | null>(null)
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
    setIsPawMenuOpen(false)
    setActionHint('Coming soon')
    window.setTimeout(() => {
      setActionHint(null)
    }, 1600)
  }, [])

  const handleOpenFeature = useCallback((featureId: GameFeatureId) => {
    setIsPawMenuOpen(false)
    setActiveFeature(featureId)
  }, [])

  useEffect(() => {
    EventBus.on(GAME_EVENTS.OPEN_NPC_ACTIONS, handleOpenNpcActions)

    return () => {
      EventBus.off(GAME_EVENTS.OPEN_NPC_ACTIONS, handleOpenNpcActions)
    }
  }, [handleOpenNpcActions])

  const featureMeta = activeFeature ? GAME_FEATURE_META[activeFeature] : null

  return (
    <div className="app-shell game-mode-shell">
      <div className="game-mode-container">
        <GameHud onOpenPawMenu={() => setIsPawMenuOpen((open) => !open)} onOpenSettings={() => setIsSettingsOpen(true)} />

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

        {isPawMenuOpen ? (
          <div className="game-paw-menu-backdrop" role="presentation" onClick={() => setIsPawMenuOpen(false)}>
            <section
              className="game-paw-menu-panel"
              role="dialog"
              aria-modal="true"
              aria-label="互动菜单"
              onClick={(event) => event.stopPropagation()}
            >
              <button type="button" className="game-paw-menu-item" onClick={handleActionClick}>
                动作
              </button>
              <button type="button" className="game-paw-menu-item" onClick={() => handleOpenFeature('snacks')}>
                零食罐罐区
              </button>
              <button type="button" className="game-paw-menu-item" onClick={() => handleOpenFeature('syzygy')}>
                仓鼠观察日志
              </button>
              <button type="button" className="game-paw-menu-item" onClick={() => handleOpenFeature('checkin')}>
                打卡
              </button>
              <button type="button" className="game-paw-menu-item" onClick={() => handleOpenFeature('export')}>
                数据导出
              </button>
            </section>
          </div>
        ) : null}

        {isSettingsOpen ? (
          <GameSettingsOverlay
            onClose={() => setIsSettingsOpen(false)}
            onSwitchToPhoneMode={onSwitchToPhoneMode}
            onOpenSharedSettings={onOpenSharedSettings}
          />
        ) : null}

        {activeFeature && featureMeta ? (
          <div className="game-feature-shell-backdrop">
            <GameFeatureShell
              title={featureMeta.title}
              subtitle={featureMeta.subtitle}
              onBackToGame={() => setActiveFeature(null)}
            >
              {activeFeature === 'snacks' ? <SnacksPage user={user} snackAiConfig={snackAiConfig} entryMode="game" /> : null}
              {activeFeature === 'syzygy' ? <SyzygyFeedPage user={user} snackAiConfig={syzygyAiConfig} entryMode="game" /> : null}
              {activeFeature === 'checkin' ? <CheckinPage user={user} entryMode="game" /> : null}
              {activeFeature === 'export' ? <ExportPage user={user} entryMode="game" /> : null}
            </GameFeatureShell>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default GameModeShell
