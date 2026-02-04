import { createPortal } from 'react-dom'
import './ConfirmDialog.css'

export type ConfirmDialogProps = {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  neutralLabel?: string
  onConfirm: () => void
  onCancel: () => void
  onNeutral?: () => void
}

const ConfirmDialog = ({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  neutralLabel,
  onConfirm,
  onCancel,
  onNeutral,
}: ConfirmDialogProps) => {
  if (!open) {
    return null
  }

  const dialog = (
    <div className="confirm-backdrop" role="dialog" aria-modal="true">
      <div className="confirm-dialog">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
        <div className="confirm-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          {neutralLabel && onNeutral ? (
            <button type="button" className="tertiary" onClick={onNeutral}>
              {neutralLabel}
            </button>
          ) : null}
          <button type="button" className="primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') {
    return dialog
  }

  return createPortal(dialog, document.body)
}

export default ConfirmDialog
