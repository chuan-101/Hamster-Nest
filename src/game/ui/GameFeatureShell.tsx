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
      <div className="game-feature-shell__utility-row">
        <button type="button" className="game-feature-shell__utility-button" onClick={onBackToGame}>
          返回游戏
        </button>
        <span className="game-feature-shell__utility-tag">PAW MENU FEATURE AREA</span>
      </div>

      <header className="game-feature-shell__header">
        <div className="game-feature-shell__titles">
          <p className="game-feature-shell__eyebrow">系统功能面板</p>
          <div className="game-feature-shell__title-row">
            <h2 className="ui-title">{title}</h2>
            <button type="button" className="game-feature-shell__close-button" onClick={onBackToGame}>
              关闭
            </button>
          </div>
          <p className="game-feature-shell__subtitle">{subtitle}</p>
        </div>
      </header>

      <div className="game-feature-shell__body">
        <div className="game-feature-shell__content">{children}</div>
      </div>
    </div>
  )
}

export default GameFeatureShell
