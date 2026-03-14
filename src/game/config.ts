import Phaser from 'phaser'
import { BootScene } from './scenes/BootScene'

export const createGameConfig = (parent: HTMLElement): Phaser.Types.Core.GameConfig => ({
  type: Phaser.AUTO,
  parent,
  transparent: false,
  backgroundColor: '#0f172a',
  scene: [BootScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: '100%',
    height: '100%',
  },
})
