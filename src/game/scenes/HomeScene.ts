import Phaser from 'phaser'
import { EventBus, GAME_EVENTS } from '../EventBus'

const FLOOR_KEY = 'floor_tile'
const CHUAN_KEY = 'chuan1'
const SYZYGY_KEY = 'syzygy1'

export class HomeScene extends Phaser.Scene {
  private syzygySprite?: Phaser.GameObjects.Image

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

  create() {
    const { width, height } = this.scale

    this.add.tileSprite(0, 0, width, height, FLOOR_KEY).setOrigin(0, 0)

    const baseY = Math.round(height * 0.72)
    const spacing = Math.round(Math.min(220, width * 0.18))
    const centerX = Math.round(width * 0.5)

    this.add
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
      EventBus.emit(GAME_EVENTS.OPEN_CHAT_WITH_SYZYGY)
    })
  }
}
