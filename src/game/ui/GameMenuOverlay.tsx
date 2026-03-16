type MenuEntry = {
  id: string
  title: string
  description: string
}

type GameMenuOverlayProps = {
  onClose: () => void
}

const GAME_MENU_ENTRIES: MenuEntry[] = [
  { id: 'snacks', title: 'Snacks', description: 'Manage food and feeding actions in game shell mode.' },
  { id: 'syzygy', title: 'Syzygy Feed / Observation Log', description: 'Open your hamster observations from game mode.' },
  { id: 'checkin', title: 'Check-in', description: 'Review daily check-ins with game-mode UI wrappers.' },
  { id: 'export', title: 'Export', description: 'Export data from a game-mode entry point.' },
]

const GameMenuOverlay = ({ onClose }: GameMenuOverlayProps) => {
  return (
    <div className="game-overlay-backdrop" role="presentation" onClick={onClose}>
      <section
        className="game-overlay-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Game menu"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="game-overlay-header">
          <h2 className="ui-title">Game Menu</h2>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="game-overlay-subtitle">Feature entry points that stay in game-mode styling.</p>
        <div className="game-overlay-list">
          {GAME_MENU_ENTRIES.map((entry) => (
            <article key={entry.id} className="game-overlay-card">
              <h3>{entry.title}</h3>
              <p>{entry.description}</p>
              <button type="button" className="game-overlay-card__button" disabled aria-disabled="true">
                Open (placeholder)
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

export default GameMenuOverlay
