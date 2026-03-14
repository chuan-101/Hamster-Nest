import Phaser from 'phaser'

export const GAME_EVENTS = {
  OPEN_CHAT_WITH_SYZYGY: 'open-chat-with-syzygy',
} as const

export const EventBus = new Phaser.Events.EventEmitter()

