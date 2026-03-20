import Phaser from 'phaser'
import { EventBus, GAME_EVENTS } from '../EventBus'

const FLOOR_KEY = 'floor_tile'
const CHUAN_KEY = 'chuan1'
const SYZYGY_KEY = 'syzygy1'

export class HomeScene extends Phaser.Scene {
  private playerSprite?: Phaser.GameObjects.Image
  private syzygySprite?: Phaser.GameObjects.Image

  private getSpriteCanvasAnchor(sprite: Phaser.GameObjects.Image) {
    const bounds = sprite.getBounds()

    return {
      x: bounds.right,
      y: bounds.top + bounds.height * 0.45,
      sceneWidth: this.scale.width,
      sceneHeight: this.scale.height,
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

    EventBus.emit(GAME_EVENTS.PLAYER_POSITION_UPDATE, {
      x: bounds.x + bounds.width * 0.5,
      y: bounds.top,
      sceneWidth: this.scale.width,
      sceneHeight: this.scale.height,
    })
  }

  private emitSyzygyPosition() {
    if (!this.syzygySprite) {
      return
    }
    const bounds = this.syzygySprite.getBounds()

    EventBus.emit(GAME_EVENTS.SYZYGY_POSITION_UPDATE, {
      x: bounds.x + bounds.width * 0.5,
      y: bounds.top,
      sceneWidth: this.scale.width,
      sceneHeight: this.scale.height,
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
        anchor: this.getSpriteCanvasAnchor(this.syzygySprite),
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
