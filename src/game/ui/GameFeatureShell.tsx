import type { ReactNode } from 'react'

type GameFeatureShellProps = {
  title: string
  subtitle: string
  onBackToGame: () => void
  children: ReactNode
}

const GameFeatureShell = ({ title, subtitle, onBackToGame, children }: GameFeatureShellProps) => {
  return (
    <div className="game-feature-shell" role="dialog" aria-modal="true" aria-label={`${title} 游戏面板`}>
      <header className="game-feature-shell__header">
        <button type="button" className="ghost" onClick={onBackToGame}>
          返回游戏
        </button>
        <div className="game-feature-shell__titles">
          <h2 className="ui-title">{title}</h2>
          <p>{subtitle}</p>
        </div>
        <button type="button" className="primary" onClick={onBackToGame}>
          关闭
        </button>
      </header>

      <div className="game-feature-shell__content">{children}</div>
    </div>
  )
}

export default GameFeatureShell
