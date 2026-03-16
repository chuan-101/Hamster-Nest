type GameSettingsOverlayProps = {
  onClose: () => void
  onSwitchToPhoneMode: () => void
}

const GameSettingsOverlay = ({ onClose, onSwitchToPhoneMode }: GameSettingsOverlayProps) => {
  return (
    <div className="game-overlay-backdrop" role="presentation" onClick={onClose}>
      <section
        className="game-overlay-panel game-overlay-panel--narrow"
        role="dialog"
        aria-modal="true"
        aria-label="Game settings"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="game-overlay-header">
          <h2 className="ui-title">Game Settings</h2>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="game-settings-stack">
          <button type="button" className="game-control-button" disabled aria-disabled="true">
            Audio (placeholder)
          </button>
          <button type="button" className="game-control-button" disabled aria-disabled="true">
            Controls (placeholder)
          </button>
          <button type="button" className="primary" onClick={onSwitchToPhoneMode}>
            Back to Phone Mode
          </button>
        </div>
      </section>
    </div>
  )
}

export default GameSettingsOverlay
