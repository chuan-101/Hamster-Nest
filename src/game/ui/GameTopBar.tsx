import { useEffect, useMemo, useState } from 'react'

type GameTopBarProps = {
  stamina: number
  maxStamina: number
  level: number
}

const formatClock = (value: Date) =>
  new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)

const GameTopBar = ({ stamina, maxStamina, level }: GameTopBarProps) => {
  const [time, setTime] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const filledSegments = useMemo(() => {
    if (maxStamina <= 0) {
      return 0
    }
    return Math.max(0, Math.min(10, Math.round((stamina / maxStamina) * 10)))
  }, [stamina, maxStamina])

  return (
    <header className="game-top-bar" aria-label="游戏 HUD 状态栏">
      <div className="game-avatar-chip" aria-label="玩家头像占位">
        <span className="game-avatar-chip__emoji" aria-hidden="true">
          🐹
        </span>
        <div>
          <p className="game-avatar-chip__name">串串</p>
          <p className="game-avatar-chip__sub">等级 {level}</p>
        </div>
      </div>

      <div className="game-stat-block" aria-label="经验值">
        <div className="game-stat-block__label-row">
          <span>EXP</span>
          <span>80/100</span>
        </div>
        <div className="game-progress-track" role="presentation" aria-hidden="true">
          {Array.from({ length: 10 }).map((_, index) => (
            <span
              key={`exp-segment-${index}`}
              className={`game-progress-track__segment ${index < filledSegments ? 'is-filled' : ''}`}
            />
          ))}
        </div>
      </div>

      <div className="game-meta-stats">
        <p className="game-chip game-chip--coin" aria-label="金币">
          <span className="game-chip__coin" aria-hidden="true">
            ●
          </span>
          12345
        </p>
        <p className="game-chip game-clock" aria-live="polite" aria-label="当前时间">
          {formatClock(time)}
        </p>
      </div>
    </header>
  )
}

export default GameTopBar
