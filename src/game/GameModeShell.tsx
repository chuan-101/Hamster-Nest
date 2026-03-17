import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

type ActiveNpcMenu = {
  npcId: OpenNpcActionsPayload['npcId']
  anchor: OpenNpcActionsPayload['anchor']
}

const GAME_FEATURE_META: Record<GameFeatureId, { title: string; subtitle: string }> = {
  snacks: { title: '零食罐罐区', subtitle: '游戏模式面板 · 零食管理与投喂' },
  syzygy: { title: '仓鼠观察日志', subtitle: '游戏模式面板 · 观察记录' },
  checkin: { title: '打卡', subtitle: '游戏模式面板 · 每日陪伴打卡' },
  export: { title: '数据导出', subtitle: '游戏模式面板 · 导出数据包' },
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const GameModeShell = ({
  onSwitchToPhoneMode,
  onOpenSharedSettings,
  onOpenChat,
  user,
  snackAiConfig,
  syzygyAiConfig,
}: GameModeShellProps) => {
  const [activeNpcMenu, setActiveNpcMenu] = useState<ActiveNpcMenu | null>(null)
  const [isPawMenuOpen, setIsPawMenuOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [activeFeature, setActiveFeature] = useState<GameFeatureId | null>(null)
  const npcMenuRef = useRef<HTMLDivElement | null>(null)

  const handleOpenNpcActions = useCallback((payload: OpenNpcActionsPayload) => {
    setActiveNpcMenu({ npcId: payload.npcId, anchor: payload.anchor })
  }, [])

  const handleCloseNpcActions = useCallback(() => {
    setActiveNpcMenu(null)
  }, [])

  const handleOpenChat = useCallback(() => {
    if (!activeNpcMenu) {
      return
    }
    onOpenChat(activeNpcMenu.npcId)
    setActiveNpcMenu(null)
  }, [activeNpcMenu, onOpenChat])

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

  useEffect(() => {
    if (!activeNpcMenu) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const menuElement = npcMenuRef.current
      if (!menuElement) {
        return
      }
      if (event.target instanceof Node && menuElement.contains(event.target)) {
        return
      }
      setActiveNpcMenu(null)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [activeNpcMenu])

  const npcMenuPosition = useMemo(() => {
    if (!activeNpcMenu) {
      return null
    }

    const radius = 96
    const edgePadding = 14
    const menuDiameter = 132
    const centerX = clamp(activeNpcMenu.anchor.x, edgePadding + menuDiameter / 2, window.innerWidth - edgePadding - menuDiameter / 2)
    const centerY = clamp(
      activeNpcMenu.anchor.y - radius,
      edgePadding + menuDiameter / 2,
      window.innerHeight - edgePadding - menuDiameter / 2,
    )

    return {
      left: `${centerX}px`,
      top: `${centerY}px`,
    }
  }, [activeNpcMenu])

  const featureMeta = activeFeature ? GAME_FEATURE_META[activeFeature] : null

  return (
    <div className="app-shell game-mode-shell">
      <div className="game-mode-container">
        <GameHud onOpenPawMenu={() => setIsPawMenuOpen((open) => !open)} onOpenSettings={() => setIsSettingsOpen(true)} />

        {activeNpcMenu && npcMenuPosition ? (
          <div className="npc-actions-layer" role="presentation" aria-hidden="true">
            <div
              ref={npcMenuRef}
              className="npc-actions-radial"
              role="dialog"
              aria-label="仓鼠互动菜单"
              style={npcMenuPosition}
            >
              <button type="button" className="npc-actions-radial__button npc-actions-radial__button--chat" onClick={handleOpenChat}>
                聊天
              </button>
              <button type="button" className="npc-actions-radial__button npc-actions-radial__button--close" onClick={handleCloseNpcActions}>
                关闭
              </button>
              <span className="npc-actions-radial__core" aria-hidden="true">
                互动
              </span>
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
