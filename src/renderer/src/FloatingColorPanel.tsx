import { useState } from 'react'

import { FusionProgramColorTools } from './FusionProgramColorTools'
import { colorAdjustIsNeutral, type CamColorAdjust } from './programColorAdjust'
import { GLYPH } from './uiGlyphs'
import { useFloatingPanelPosition } from './useFloatingPanelPosition'

const POS_STORAGE = 'studioLive.colorPanel.pos.v1'
const COLLAPSED_STORAGE = 'studioLive.colorPanel.collapsed.v1'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(v: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_STORAGE, v ? '1' : '0')
  } catch {
    /* vacío */
  }
}

function defaultColorPos(): { x: number; y: number } {
  return { x: Math.max(12, window.innerWidth - 220), y: 140 }
}

export type FloatingColorPanelProps = {
  open: boolean
  onClose: () => void
  disabled?: boolean
  cameraLabel: string
  adjust: CamColorAdjust
  onChange: (next: CamColorAdjust) => void
  onReset: () => void
}

export function FusionColorTrigger({
  active,
  disabled,
  processing,
  onClick
}: {
  active?: boolean
  disabled?: boolean
  processing?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={[
        'fusion-rail-trigger',
        'fusion-color-trigger',
        active ? 'fusion-rail-trigger--on' : '',
        processing ? 'fusion-color-trigger--processing' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled}
      onClick={onClick}
      title="Brillo, contraste, saturación y temperatura de la cámara al aire."
      aria-label="Abrir ajustes de imagen"
      aria-pressed={active}
    >
      <span className="fusion-rail-trigger__icon" aria-hidden>
        {GLYPH.color}
      </span>
      <span className="fusion-rail-trigger__label">Color</span>
    </button>
  )
}

export function FloatingColorPanel({
  open,
  onClose,
  disabled,
  cameraLabel,
  adjust,
  onChange,
  onReset
}: FloatingColorPanelProps) {
  const { pos, rootRef, startDrag } = useFloatingPanelPosition(POS_STORAGE, defaultColorPos)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const processing = !colorAdjustIsNeutral(adjust)

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c
      writeCollapsed(next)
      return next
    })
  }

  if (!open) return null

  const chromeBtn = {
    border: '1px solid #334155',
    background: '#1e293b',
    color: '#cbd5e1',
    borderRadius: 6,
    padding: '2px 7px',
    cursor: 'pointer',
    fontSize: 11,
    lineHeight: 1
  } as const

  if (collapsed) {
    return (
      <div
        ref={rootRef}
        className="fusion-float-color fusion-float-color--collapsed"
        style={{ left: pos.x, top: pos.y }}
        role="dialog"
        aria-label="Ajustes de imagen (minimizado)"
      >
        <div className="fusion-float-color__chrome" onMouseDown={startDrag}>
          <button type="button" className="fusion-float-color__chrome-btn" onClick={toggleCollapsed} title="Expandir">
            ▾
          </button>
          <span className="fusion-float-color__title">
            <span className="fusion-float-color__title-base">{GLYPH.color} Color</span>
            {processing ? <span className="fusion-float-color__title-active">· activo</span> : null}
          </span>
          <button type="button" style={chromeBtn} onClick={onClose} title="Cerrar">
            {GLYPH.close}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className="fusion-float-color"
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label="Ajustes de imagen por cámara"
    >
      <div className="fusion-float-color__chrome" onMouseDown={startDrag}>
        <span className="fusion-float-color__title">
          <span className="fusion-float-color__title-base">{GLYPH.color} Color</span>
          {processing ? <span className="fusion-float-color__title-active">· activo</span> : null}
        </span>
        <div className="fusion-float-color__chrome-actions">
          <button type="button" style={chromeBtn} onClick={toggleCollapsed} title="Minimizar">
            −
          </button>
          <button type="button" style={chromeBtn} onClick={onClose} title="Cerrar">
            {GLYPH.close}
          </button>
        </div>
      </div>
      <div className="fusion-float-color__body">
        <FusionProgramColorTools
          cameraLabel={cameraLabel}
          adjust={adjust}
          disabled={disabled}
          onChange={onChange}
          onReset={onReset}
        />
      </div>
    </div>
  )
}
