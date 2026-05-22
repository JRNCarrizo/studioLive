import { useState } from 'react'

import { useFramingMotionPresets } from './useFramingMotionPresets'
import { useFramingMotionSettings } from './useFramingMotionSettings'
import type { CamFraming } from './programFraming'

type Props = {
  disabled?: boolean
  motionLabel: string | null
  framingNeutral: CamFraming
  getCurrentFraming: () => CamFraming
  onPlay: (presetId: string) => void
  onStop: () => void
  onStatus?: (msg: string) => void
  /** Dentro del panel flotante (sin bloque duplicado de título). */
  embedded?: boolean
}

type DialogState =
  | { kind: 'save'; draft: string }
  | { kind: 'rename'; id: string; draft: string }
  | { kind: 'delete'; id: string; name: string }
  | null

export function FusionProgramMotionTools({
  disabled,
  motionLabel,
  framingNeutral,
  getCurrentFraming,
  onPlay,
  onStop,
  onStatus,
  embedded = false
}: Props) {
  const { settings, setSpeed, setIntensity } = useFramingMotionSettings()
  const { builtinPresets, customPresets, saveFromCurrent, rename, remove } = useFramingMotionPresets()
  const [dialog, setDialog] = useState<DialogState>(null)

  const status = (msg: string) => onStatus?.(msg)

  const closeDialog = () => setDialog(null)

  const submitSave = () => {
    if (dialog?.kind !== 'save') return
    const p = saveFromCurrent(dialog.draft, getCurrentFraming(), framingNeutral)
    status(`Movimiento guardado: «${p.label}».`)
    closeDialog()
  }

  const submitRename = () => {
    if (dialog?.kind !== 'rename') return
    if (rename(dialog.id, dialog.draft)) {
      status(`Renombrado a «${dialog.draft.trim() || 'Mi movimiento'}».`)
    }
    closeDialog()
  }

  const submitDelete = () => {
    if (dialog?.kind !== 'delete') return
    remove(dialog.id)
    status(`Movimiento «${dialog.name}» eliminado.`)
    closeDialog()
  }

  const onKeyDownDialog = (e: React.KeyboardEvent, submit: () => void) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      closeDialog()
    }
  }

  return (
    <div
      className={[
        'fusion-program-tools',
        'fusion-program-tools--motion',
        embedded ? 'fusion-program-tools--motion-embedded' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      onMouseDown={(ev) => ev.stopPropagation()}
      onDoubleClick={(ev) => ev.stopPropagation()}
    >
      <div className="fusion-program-tool-block">
        {!embedded ? (
          <>
            <span
              className="fusion-program-tool-label"
              title="Movimiento automático del encuadre (zoom y pan). Solo con una cámara al programa. Neutro = tu encuadre base."
            >
              Movimiento
            </span>
            {motionLabel ? (
              <span className="fusion-program-motion-status" title="Secuencia en curso">
                {motionLabel}…
              </span>
            ) : null}
          </>
        ) : null}

        {dialog ? (
          <div className="fusion-motion-dialog" role="form">
            {dialog.kind === 'save' ? (
              <>
                <span className="fusion-motion-dialog__label">Nombre del movimiento</span>
                <input
                  type="text"
                  className="fusion-motion-dialog__input"
                  value={dialog.draft}
                  disabled={disabled}
                  autoFocus
                  onChange={(e) => setDialog({ kind: 'save', draft: e.target.value })}
                  onKeyDown={(e) => onKeyDownDialog(e, submitSave)}
                />
                <div className="fusion-motion-dialog__actions">
                  <button type="button" disabled={disabled} onClick={submitSave}>
                    Guardar
                  </button>
                  <button type="button" className="fusion-motion-dialog__cancel" onClick={closeDialog}>
                    Cancelar
                  </button>
                </div>
              </>
            ) : null}
            {dialog.kind === 'rename' ? (
              <>
                <span className="fusion-motion-dialog__label">Renombrar</span>
                <input
                  type="text"
                  className="fusion-motion-dialog__input"
                  value={dialog.draft}
                  disabled={disabled}
                  autoFocus
                  onChange={(e) => setDialog({ kind: 'rename', id: dialog.id, draft: e.target.value })}
                  onKeyDown={(e) => onKeyDownDialog(e, submitRename)}
                />
                <div className="fusion-motion-dialog__actions">
                  <button type="button" disabled={disabled} onClick={submitRename}>
                    Aceptar
                  </button>
                  <button type="button" className="fusion-motion-dialog__cancel" onClick={closeDialog}>
                    Cancelar
                  </button>
                </div>
              </>
            ) : null}
            {dialog.kind === 'delete' ? (
              <>
                <p className="fusion-motion-dialog__confirm">
                  ¿Borrar «{dialog.name}»?
                </p>
                <div className="fusion-motion-dialog__actions">
                  <button
                    type="button"
                    className="fusion-motion-dialog__danger"
                    disabled={disabled}
                    onClick={submitDelete}
                  >
                    Borrar
                  </button>
                  <button type="button" className="fusion-motion-dialog__cancel" onClick={closeDialog}>
                    Cancelar
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="fusion-program-motion-sliders">
          <label className="fusion-program-motion-slider">
            <span>Velocidad</span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={settings.speed}
              disabled={disabled}
              onChange={(e) => setSpeed(Number(e.target.value))}
              title="Más alto = movimiento más lento"
            />
            <span className="fusion-program-motion-slider-val">
              {settings.speed < 0.95 ? 'rápido' : settings.speed > 1.05 ? 'lento' : 'normal'}
            </span>
          </label>
          <label className="fusion-program-motion-slider">
            <span>Intensidad</span>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={settings.intensity}
              disabled={disabled}
              onChange={(e) => setIntensity(Number(e.target.value))}
              title="Cuánto zoom y desplazamiento aplica el preset"
            />
            <span className="fusion-program-motion-slider-val">{Math.round(settings.intensity * 100)}%</span>
          </label>
        </div>

        <div className="fusion-program-motion-grid">
          {builtinPresets.map((p) => (
            <button
              key={p.id}
              type="button"
              className="fusion-program-motion-btn"
              disabled={disabled}
              title={p.title}
              onClick={() => onPlay(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {customPresets.length > 0 ? (
          <div className="fusion-program-motion-custom">
            <span className="fusion-program-motion-custom-label">Tuyos</span>
            <div className="fusion-program-motion-custom-list">
              {customPresets.map((p) => (
                <div key={p.id} className="fusion-program-motion-custom-row">
                  <button
                    type="button"
                    className="fusion-program-motion-btn fusion-program-motion-btn--custom"
                    disabled={disabled}
                    title={p.title}
                    onClick={() => onPlay(p.id)}
                  >
                    {p.label}
                  </button>
                  <button
                    type="button"
                    className="fusion-program-motion-icon-btn"
                    disabled={disabled}
                    title="Renombrar"
                    onClick={() => setDialog({ kind: 'rename', id: p.id, draft: p.label })}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="fusion-program-motion-icon-btn fusion-program-motion-icon-btn--danger"
                    disabled={disabled}
                    title="Borrar"
                    onClick={() => setDialog({ kind: 'delete', id: p.id, name: p.label })}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="fusion-program-tool-actions fusion-program-tool-actions--motion">
          <button
            type="button"
            disabled={disabled || dialog?.kind === 'save'}
            onClick={() => setDialog({ kind: 'save', draft: 'Mi movimiento' })}
            title="Guardar encuadre actual como movimiento"
          >
            + Guardar encuadre
          </button>
          <button type="button" disabled={!motionLabel} onClick={onStop} title="Detener la secuencia">
            Detener
          </button>
        </div>
      </div>
    </div>
  )
}
