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
        💭 思考过程
      </button>
      <div className={`reasoning-panel__content ${isOpen ? 'is-open' : ''}`}>
        <div className="reasoning-panel__body">{reasoning}</div>
      </div>
    </div>
  )
}

export default ReasoningPanel
