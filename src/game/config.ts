import Phaser from 'phaser'
import { HomeScene } from './scenes/HomeScene'

export const createGameConfig = (parent: HTMLElement): Phaser.Types.Core.GameConfig => ({
  type: Phaser.AUTO,
  parent,
  transparent: false,
  backgroundColor: '#0f172a',
  pixelArt: true,
  scene: [HomeScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: '100%',
    height: '100%',
  },
})
