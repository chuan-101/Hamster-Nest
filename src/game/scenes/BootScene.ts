import Phaser from 'phaser'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene')
  }

  create() {
    const { width, height } = this.scale

    this.add
      .text(width / 2, height / 2, 'Hamster-Nest Game Mode', {
        color: '#e2e8f0',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        fontSize: '24px',
        fontStyle: '600',
      })
      .setOrigin(0.5)
  }
}
