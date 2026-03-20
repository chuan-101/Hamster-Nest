import Phaser from 'phaser'

export const GAME_EVENTS = {
  OPEN_NPC_ACTIONS: 'open-npc-actions',
  SYZYGY_POSITION_UPDATE: 'syzygy-position-update',
  PLAYER_POSITION_UPDATE: 'player-position-update',
} as const

type SceneAnchorPayload = {
  x: number
  y: number
  sceneWidth: number
  sceneHeight: number
}

export type OpenNpcActionsPayload = {
  npcId: 'syzygy'
  anchor: SceneAnchorPayload
}

export type SyzygyPositionPayload = SceneAnchorPayload

export type PlayerPositionPayload = SceneAnchorPayload

export const EventBus = new Phaser.Events.EventEmitter()
