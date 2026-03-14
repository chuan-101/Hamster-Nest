import { useLayoutEffect, useRef } from 'react'
import Phaser from 'phaser'
import { createGameConfig } from './config'

const GameContainer = () => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const gameRef = useRef<Phaser.Game | null>(null)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || gameRef.current) {
      return
    }

    gameRef.current = new Phaser.Game(createGameConfig(container))

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true)
        gameRef.current = null
      }
      container.innerHTML = ''
      containerRef.current = null
    }
  }, [])

  return <div ref={containerRef} className="game-canvas-container" aria-label="Hamster Nest game canvas" />
}

export default GameContainer
