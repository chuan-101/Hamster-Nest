import { useState } from 'react'
import './ReasoningPanel.css'

type ReasoningPanelProps = {
  reasoning: string
}

const ReasoningPanel = ({ reasoning }: ReasoningPanelProps) => {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="reasoning-panel">
      <button
        type="button"
        className="reasoning-panel__toggle"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        查看思考
      </button>
      <div className={`reasoning-panel__content ${isOpen ? 'is-open' : ''}`}>
        <div className="reasoning-panel__body reasoning-content">{reasoning}</div>
      </div>
    </div>
  )
}

export default ReasoningPanel
