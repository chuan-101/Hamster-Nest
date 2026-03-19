import Phaser from 'phaser'

export const GAME_EVENTS = {
  OPEN_NPC_ACTIONS: 'open-npc-actions',
  SYZYGY_POSITION_UPDATE: 'syzygy-position-update',
  PLAYER_POSITION_UPDATE: 'player-position-update',
} as const

export type OpenNpcActionsPayload = {
  npcId: 'syzygy'
  anchor: {
    x: number
    y: number
  }
}

export type SyzygyPositionPayload = {
  x: number
  y: number
}

export type PlayerPositionPayload = {
  x: number
  y: number
}

export const EventBus = new Phaser.Events.EventEmitter()
