import type { ReactNode } from 'react'

import {
  btnNeutral,
  pcAudioToolbarButton,
  pcAudioToolbarLabel,
  pcAudioToolbarTitle
} from './workspaceChrome'

type Props = {
  onExpand: () => void
  onOpenQr: () => void
  onOpenAudio: () => void
  pcAudioActive: boolean
  hint?: string
  children: ReactNode
}

export function LiveCompactShell({
  onExpand,
  onOpenQr,
  onOpenAudio,
  pcAudioActive,
  hint,
  children
}: Props) {
  return (
    <div className="live-compact-shell">
      <div className="live-compact-shell__chrome">
        <button
          type="button"
          className="live-compact-shell__expand"
          onClick={onExpand}
          title="Restaurar ventana y panel completo"
        >
          Expandir panel
        </button>
        <div className="live-compact-shell__actions">
          <button
            type="button"
            onClick={onOpenQr}
            title="QR para conectar cámaras"
            style={{
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid #0284c7',
              background: '#0c4a6e',
              color: '#7dd3fc',
              fontWeight: 700,
              fontSize: 11,
              cursor: 'pointer'
            }}
          >
            QR
          </button>
          <button
            type="button"
            onClick={onOpenAudio}
            style={{
              ...pcAudioToolbarButton(pcAudioActive),
              padding: '6px 10px',
              fontSize: 11
            }}
            title={pcAudioToolbarTitle(pcAudioActive)}
          >
            {pcAudioToolbarLabel(pcAudioActive)}
          </button>
        </div>
      </div>
      {hint ? <p className="live-compact-shell__hint">{hint}</p> : null}
      <div className="live-compact-shell__transport">{children}</div>
    </div>
  )
}

export function LiveCompactToggleButton({
  active,
  disabled,
  onClick
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={
        active
          ? 'Restaurar ventana y ver miniaturas'
          : 'Achica la ventana a solo botones (QR, audio, grabar) para no tapar YouTube u otra ventana'
      }
      style={{
        ...btnNeutral,
        fontWeight: 700,
        border: active ? '1px solid #0d9488' : '1px dashed #64748b',
        background: active ? 'rgba(19, 78, 74, 0.55)' : '#0f172a',
        color: active ? '#99f6e4' : '#cbd5e1',
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer'
      }}
    >
      {active ? 'Expandir panel' : 'Solo controles'}
    </button>
  )
}
