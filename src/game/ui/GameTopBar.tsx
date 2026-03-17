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
      <div className="game-top-bar__row game-top-bar__row--main">
        <div className="game-avatar-chip" aria-label="玩家头像占位">
          <span className="game-avatar-chip__emoji" aria-hidden="true">
            🐹
          </span>
        </div>

        <div className="game-stat-block" aria-label="玩家信息">
          <div className="game-stat-block__label-row">
            <p className="game-avatar-chip__name">串串</p>
            <p className="game-avatar-chip__level">Lv.{String(level).padStart(2, '0')}</p>
          </div>
          <p className="game-chip game-chip--coin" aria-label="金币">
            金币：123456
          </p>
        </div>

        <p className="game-chip game-clock" aria-live="polite" aria-label="当前时间">
          {formatClock(time)}
        </p>
      </div>

      <div className="game-top-bar__row game-top-bar__row--status">
        <div className="game-progress-track" aria-label="体力值">
          <div className="game-progress-track__fill" style={{ width: `${(filledSegments / 10) * 100}%` }} />
          <span className="game-progress-track__label">
            {stamina}/{String(maxStamina).padStart(2, '0')}
          </span>
        </div>
        <p className="game-chip game-chip--time" aria-label="游戏内时间">
          12:00
        </p>
      </div>
    </header>
  )
}

export default GameTopBar
