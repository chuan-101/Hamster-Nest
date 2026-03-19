import Phaser from 'phaser'
import { EventBus, GAME_EVENTS } from '../EventBus'

const FLOOR_KEY = 'floor_tile'
const CHUAN_KEY = 'chuan1'
const SYZYGY_KEY = 'syzygy1'

export class HomeScene extends Phaser.Scene {
  private playerSprite?: Phaser.GameObjects.Image
  private syzygySprite?: Phaser.GameObjects.Image

  private getSpriteScreenAnchor(sprite: Phaser.GameObjects.Image) {
    const bounds = sprite.getBounds()
    const canvas = this.game.canvas
    const canvasRect = canvas.getBoundingClientRect()
    const scaleX = canvasRect.width / this.scale.width
    const scaleY = canvasRect.height / this.scale.height

    return {
      x: canvasRect.left + bounds.right * scaleX,
      y: canvasRect.top + (bounds.top + bounds.height * 0.45) * scaleY,
    }
  }

  constructor() {
    super('HomeScene')
  }

  preload() {
    const baseUrl = import.meta.env.BASE_URL
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    const assetBase = `${normalizedBaseUrl}assets/game/`

    this.load.image(FLOOR_KEY, `${assetBase}floor_tile.png`)
    this.load.image(CHUAN_KEY, `${assetBase}chuan1.png`)
    this.load.image(SYZYGY_KEY, `${assetBase}syzygy1.png`)
  }

  private emitPlayerPosition() {
    if (!this.playerSprite) {
      return
    }
    const bounds = this.playerSprite.getBounds()
    const canvas = this.game.canvas
    const canvasRect = canvas.getBoundingClientRect()
    const scaleX = canvasRect.width / this.scale.width
    const scaleY = canvasRect.height / this.scale.height

    EventBus.emit(GAME_EVENTS.PLAYER_POSITION_UPDATE, {
      x: canvasRect.left + (bounds.x + bounds.width * 0.5) * scaleX,
      y: canvasRect.top + bounds.top * scaleY,
    })
  }

  private emitSyzygyPosition() {
    if (!this.syzygySprite) {
      return
    }
    const bounds = this.syzygySprite.getBounds()
    const canvas = this.game.canvas
    const canvasRect = canvas.getBoundingClientRect()
    const scaleX = canvasRect.width / this.scale.width
    const scaleY = canvasRect.height / this.scale.height

    EventBus.emit(GAME_EVENTS.SYZYGY_POSITION_UPDATE, {
      x: canvasRect.left + (bounds.x + bounds.width * 0.5) * scaleX,
      y: canvasRect.top + bounds.top * scaleY,
    })
  }

  create() {
    const { width, height } = this.scale

    this.add.tileSprite(0, 0, width, height, FLOOR_KEY).setOrigin(0, 0)

    const baseY = Math.round(height * 0.72)
    const spacing = Math.round(Math.min(220, width * 0.18))
    const centerX = Math.round(width * 0.5)

    this.playerSprite = this.add
      .image(centerX - spacing, baseY, CHUAN_KEY)
      .setOrigin(0.5, 1)
      .setScale(2)

    this.syzygySprite = this.add
      .image(centerX + spacing, baseY, SYZYGY_KEY)
      .setOrigin(0.5, 1)
      .setScale(2)

    this.syzygySprite.setInteractive({ useHandCursor: true })
    this.syzygySprite.on('pointerover', () => {
      this.syzygySprite?.setTint(0xdbeafe)
    })
    this.syzygySprite.on('pointerout', () => {
      this.syzygySprite?.clearTint()
    })
    this.syzygySprite.on('pointerdown', () => {
      if (!this.syzygySprite) {
        return
      }

      EventBus.emit(GAME_EVENTS.OPEN_NPC_ACTIONS, {
        npcId: 'syzygy',
        anchor: this.getSpriteScreenAnchor(this.syzygySprite),
      })
    })

    this.emitSyzygyPosition()
    this.emitPlayerPosition()
    this.scale.on('resize', () => {
      this.emitSyzygyPosition()
      this.emitPlayerPosition()
    })
  }
}
