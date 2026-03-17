import { useEffect, useMemo, useState } from 'react'

type GameTopBarProps = {
  stamina: number
  maxStamina: number
  level: number
  exp: number
  maxExp: number
}

const formatClock = (value: Date) =>
  new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).format(value)

const GameTopBar = ({ stamina, maxStamina, level, exp, maxExp }: GameTopBarProps) => {
  const [time, setTime] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const staminaRatio = useMemo(() => {
    if (maxStamina <= 0) {
      return 0
    }
    return Math.max(0, Math.min(100, (stamina / maxStamina) * 100))
  }, [stamina, maxStamina])

  const expRatio = useMemo(() => {
    if (maxExp <= 0) {
      return 0
    }
    return Math.max(0, Math.min(100, (exp / maxExp) * 100))
  }, [exp, maxExp])

  return (
    <header className="game-top-bar" aria-label="游戏 HUD 状态栏">
      <div className="game-top-bar__main-grid">
        <div className="game-avatar-chip" aria-label="玩家头像占位">
          <span className="game-avatar-chip__emoji" aria-hidden="true">
            🐹
          </span>
        </div>

        <div className="game-player-panel" aria-label="玩家信息">
          <div className="game-player-panel__label-row">
            <p className="game-avatar-chip__name">串串</p>
            <p className="game-avatar-chip__level">Lv.{String(level).padStart(2, '0')}</p>
          </div>
          <div className="game-mini-status" aria-label="经验值">
            <p className="game-mini-status__label">EXP</p>
            <div className="game-mini-status__track">
              <div className="game-mini-status__fill" style={{ width: `${expRatio}%` }} />
              <span className="game-mini-status__value">
                {exp}/{String(maxExp).padStart(2, '0')}
              </span>
            </div>
          </div>
        </div>

        <div className="game-clock-stack" aria-label="时间与资源信息">
          <p className="game-chip game-chip--coin" aria-label="金币">
            💰 123456
          </p>
          <p className="game-chip game-clock" aria-live="polite" aria-label="当前时间">
            {formatClock(time)}
          </p>
          <p className="game-chip game-chip--date" aria-label="日期">
            {formatDate(time)}
          </p>
        </div>
      </div>

      <div className="game-top-bar__status-row">
        <p className="game-status-label">Stamina</p>
        <div className="game-progress-track" aria-label="体力值">
          <div className="game-progress-track__fill" style={{ width: `${staminaRatio}%` }} />
          <span className="game-progress-track__label">
            {stamina}/{String(maxStamina).padStart(2, '0')}
          </span>
        </div>
      </div>
    </header>
  )
}

export default GameTopBar
