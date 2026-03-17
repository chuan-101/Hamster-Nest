import Phaser from 'phaser'

export const GAME_EVENTS = {
  OPEN_NPC_ACTIONS: 'open-npc-actions',
} as const

export type OpenNpcActionsPayload = {
  npcId: 'syzygy'
  anchor: {
    x: number
    y: number
  }
}

export const EventBus = new Phaser.Events.EventEmitter()
