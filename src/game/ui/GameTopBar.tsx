import { useEffect, useMemo, useState } from 'react'

type GameTopBarProps = {
  stamina: number
  maxStamina: number
  level: number
  coins: number
}

const formatClock = (value: Date) =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)

const GameTopBar = ({ stamina, maxStamina, level, coins }: GameTopBarProps) => {
  const [time, setTime] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const staminaPercent = useMemo(() => {
    if (maxStamina <= 0) {
      return 0
    }
    return Math.max(0, Math.min(100, Math.round((stamina / maxStamina) * 100)))
  }, [stamina, maxStamina])

  return (
    <header className="game-top-bar" aria-label="Game HUD status bar">
      <div className="game-avatar-chip" aria-label="Player avatar placeholder">
        <span className="game-avatar-chip__emoji" aria-hidden="true">
          🐹
        </span>
        <div>
          <p className="game-avatar-chip__name">Chuan</p>
          <p className="game-avatar-chip__sub">Lv.{level}</p>
        </div>
      </div>

      <div className="game-stat-block" aria-label="Stamina">
        <div className="game-stat-block__label-row">
          <span>Stamina</span>
          <span>
            {stamina}/{maxStamina}
          </span>
        </div>
        <div className="game-progress-track" role="presentation">
          <div className="game-progress-track__fill" style={{ width: `${staminaPercent}%` }} />
        </div>
      </div>

      <div className="game-meta-stats">
        <p className="game-chip">🪙 {coins}</p>
        <p className="game-chip game-clock" aria-live="polite">
          🕒 {formatClock(time)}
        </p>
      </div>
    </header>
  )
}

export default GameTopBar
