import type { ReactNode } from 'react'

type GameSystemModalProps = {
  title: string
  subtitle?: string
  ariaLabel: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  contentClassName?: string
}

const GameSystemModal = ({
  title,
  subtitle,
  ariaLabel,
  onClose,
  children,
  footer,
  contentClassName,
}: GameSystemModalProps) => {
  const contentClasses = ['game-system-modal__content', contentClassName].filter(Boolean).join(' ')

  return (
    <div className="game-overlay-backdrop" role="presentation" onClick={onClose}>
      <section
        className="game-overlay-panel game-system-modal"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="game-overlay-header game-system-modal__header">
          <div className="game-system-modal__title-stack">
            <p className="game-system-modal__eyebrow">系统面板</p>
            <h2 className="ui-title">{title}</h2>
          </div>
          <button type="button" className="game-overlay-close" onClick={onClose}>
            关闭
          </button>
        </header>
        {subtitle ? <p className="game-overlay-subtitle game-system-modal__subtitle">{subtitle}</p> : null}
        <div className={contentClasses}>{children}</div>
        {footer ? <footer className="game-system-modal__footer">{footer}</footer> : null}
      </section>
    </div>
  )
}

export default GameSystemModal
