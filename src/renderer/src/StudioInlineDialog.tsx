import type { ReactNode } from 'react'

type DialogActionsProps = {
  submitLabel: string
  cancelLabel?: string
  danger?: boolean
  disabled?: boolean
  onSubmit: () => void
  onCancel: () => void
}

function DialogActions({
  submitLabel,
  cancelLabel = 'Cancelar',
  danger,
  disabled,
  onSubmit,
  onCancel
}: DialogActionsProps) {
  return (
    <div className="studio-inline-dialog__actions">
      <button
        type="button"
        className={danger ? 'studio-inline-dialog__danger' : undefined}
        disabled={disabled}
        onClick={onSubmit}
      >
        {submitLabel}
      </button>
      <button type="button" className="studio-inline-dialog__cancel" onClick={onCancel}>
        {cancelLabel}
      </button>
    </div>
  )
}

export function StudioPromptForm({
  label,
  value,
  disabled,
  submitLabel = 'Guardar',
  onChange,
  onSubmit,
  onCancel
}: {
  label: string
  value: string
  disabled?: boolean
  submitLabel?: string
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onSubmit()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <div className="studio-inline-dialog" role="form">
      <span className="studio-inline-dialog__label">{label}</span>
      <input
        type="text"
        className="studio-inline-dialog__input"
        value={value}
        disabled={disabled}
        autoFocus
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <DialogActions submitLabel={submitLabel} disabled={disabled} onSubmit={onSubmit} onCancel={onCancel} />
    </div>
  )
}

export function StudioConfirmForm({
  message,
  disabled,
  submitLabel = 'Confirmar',
  danger,
  onConfirm,
  onCancel
}: {
  message: ReactNode
  disabled?: boolean
  submitLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="studio-inline-dialog" role="alertdialog" aria-labelledby="studio-confirm-msg">
      <p id="studio-confirm-msg" className="studio-inline-dialog__confirm">
        {message}
      </p>
      <DialogActions
        submitLabel={submitLabel}
        danger={danger}
        disabled={disabled}
        onSubmit={onConfirm}
        onCancel={onCancel}
      />
    </div>
  )
}
