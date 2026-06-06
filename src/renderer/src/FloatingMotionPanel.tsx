import { useState } from 'react'

import { FusionProgramMotionTools } from './FusionProgramMotionTools'
import type { CamFraming } from './programFraming'
import { GLYPH } from './uiGlyphs'
import { useFloatingPanelPosition } from './useFloatingPanelPosition'

const POS_STORAGE = 'studioLive.motionPanel.pos.v1'
const COLLAPSED_STORAGE = 'studioLive.motionPanel.collapsed.v1'

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

function defaultMotionPos(): { x: number; y: number } {
  return { x: Math.max(12, window.innerWidth - 220), y: 96 }
}

export type FloatingMotionPanelProps = {
  open: boolean
  onClose: () => void
  disabled?: boolean
  motionLabel: string | null
  framingNeutral: CamFraming
  getCurrentFraming: () => CamFraming
  onPlay: (presetId: string) => void
  onAssign: (presetId: string) => void
  onStop: () => void
  onStatus?: (msg: string) => void
  programMode: boolean
  onProgramModeChange: (v: boolean) => void
  assignTargetLabel: string
}

export function FusionMotionTrigger({
  active,
  disabled,
  playing,
  onClick
}: {
  active?: boolean
  disabled?: boolean
  playing?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={[
        'fusion-rail-trigger',
        'fusion-motion-trigger',
        active ? 'fusion-rail-trigger--on' : '',
        playing ? 'fusion-motion-trigger--playing' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled}
      onClick={onClick}
      title="Consola de movimiento (zoom y pan automático)"
      aria-label="Abrir consola de movimiento"
      aria-pressed={active}
    >
      <span className="fusion-rail-trigger__icon" aria-hidden>
        {GLYPH.motion}
      </span>
      <span className="fusion-rail-trigger__label">Mov.</span>
    </button>
  )
}

export function FloatingMotionPanel({
  open,
  onClose,
  disabled,
  motionLabel,
  framingNeutral,
  getCurrentFraming,
  onPlay,
  onAssign,
  onStop,
  onStatus,
  programMode,
  onProgramModeChange,
  assignTargetLabel
}: FloatingMotionPanelProps) {
  const { pos, rootRef, startDrag } = useFloatingPanelPosition(POS_STORAGE, defaultMotionPos)
  const [collapsed, setCollapsed] = useState(readCollapsed)

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
        className="fusion-float-motion fusion-float-motion--collapsed"
        style={{ left: pos.x, top: pos.y }}
        role="dialog"
        aria-label="Movimiento de cámara (minimizado)"
      >
        <div className="fusion-float-motion__chrome" onMouseDown={startDrag}>
          <button type="button" className="fusion-float-motion__chrome-btn" onClick={toggleCollapsed} title="Expandir">
            ▾
          </button>
          <span className="fusion-float-motion__title" title={motionLabel ?? undefined}>
            <span className="fusion-float-motion__title-base">{GLYPH.motion} Mov.</span>
            {motionLabel ? (
              <span className="fusion-float-motion__title-active">· {motionLabel}</span>
            ) : null}
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
      className="fusion-float-motion"
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label="Consola de movimiento de cámara"
    >
      <div className="fusion-float-motion__chrome" onMouseDown={startDrag}>
        <span className="fusion-float-motion__title" title={motionLabel ?? undefined}>
          <span className="fusion-float-motion__title-base">{GLYPH.motion} Mov.</span>
          {motionLabel ? (
            <span className="fusion-float-motion__title-active">· {motionLabel}</span>
          ) : null}
        </span>
        <div className="fusion-float-motion__chrome-actions">
          <button type="button" style={chromeBtn} onClick={toggleCollapsed} title="Minimizar">
            −
          </button>
          <button type="button" style={chromeBtn} onClick={onClose} title="Cerrar">
            {GLYPH.close}
          </button>
        </div>
      </div>
      <div className="fusion-float-motion__body">
        <FusionProgramMotionTools
          disabled={disabled}
          motionLabel={motionLabel}
          framingNeutral={framingNeutral}
          getCurrentFraming={getCurrentFraming}
          onPlay={onPlay}
          onAssign={onAssign}
          onStop={onStop}
          onStatus={onStatus}
          programMode={programMode}
          onProgramModeChange={onProgramModeChange}
          assignTargetLabel={assignTargetLabel}
          embedded
        />
      </div>
    </div>
  )
}
