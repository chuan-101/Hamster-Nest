import GameContainer from './GameContainer'

type GameModeShellProps = {
  onSwitchToPhoneMode: () => void
}

const GameModeShell = ({ onSwitchToPhoneMode }: GameModeShellProps) => {
  return (
    <div className="app-shell game-mode-shell">
      <div className="game-mode-container">
        <div className="game-mode-toolbar">
          <h1>Game Mode</h1>
          <button type="button" className="primary" onClick={onSwitchToPhoneMode}>
            Back to Phone Mode
          </button>
        </div>
        <GameContainer />
      </div>
    </div>
  )
}

export default GameModeShell
