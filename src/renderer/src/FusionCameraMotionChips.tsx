import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { MAX_MOTIONS_PER_CAMERA } from './cameraMotionProgramStorage'
import { motionPresetChipClassName, resolveMotionPresetDisplay } from './motionPresetMeta'
import {
  BUILTIN_MOTION_SEQUENCE_PRESETS,
  BUILTIN_MOTION_SIMPLE_PRESETS
} from './programFramingPresets'
import { useFramingMotionPresets } from './useFramingMotionPresets'

type Props = {
  cameraId: string
  presetIds: string[]
  disabled?: boolean
  onRemoveAt: (index: number) => void
  onAddPreset: (presetId: string) => boolean
  /** Ensayo: un solo movimiento ahora en la cámara al aire. */
  onPreviewPreset?: (presetId: string) => void
}

export function FusionCameraMotionChips({
  cameraId,
  presetIds,
  disabled,
  onRemoveAt,
  onAddPreset,
  onPreviewPreset
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const addBtnRef = useRef<HTMLButtonElement>(null)
  const [pickerPos, setPickerPos] = useState<{
    top: number
    left: number
    width: number
    placeAbove: boolean
  } | null>(null)
  const { customPresets } = useFramingMotionPresets()

  const updatePickerPos = () => {
    const btn = addBtnRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const width = Math.min(220, window.innerWidth - 16)
    let left = rect.left
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8
    if (left < 8) left = 8
    const spaceAbove = rect.top - 8
    const spaceBelow = window.innerHeight - rect.bottom - 8
    const placeAbove = spaceAbove >= spaceBelow && spaceAbove > 100
    setPickerPos({
      top: placeAbove ? rect.top - 8 : rect.bottom + 8,
      left,
      width,
      placeAbove
    })
  }

  useLayoutEffect(() => {
    if (!pickerOpen) {
      setPickerPos(null)
      return
    }
    updatePickerPos()
    window.addEventListener('resize', updatePickerPos)
    window.addEventListener('scroll', updatePickerPos, true)
    return () => {
      window.removeEventListener('resize', updatePickerPos)
      window.removeEventListener('scroll', updatePickerPos, true)
    }
  }, [pickerOpen, presetIds.length, customPresets.length])

  useEffect(() => {
    if (!pickerOpen) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (pickerRef.current?.contains(t)) return
      setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [pickerOpen])

  const canAdd = presetIds.length < MAX_MOTIONS_PER_CAMERA && !disabled

  const pickerEl =
    pickerOpen && pickerPos ? (
      <div
        ref={pickerRef}
        className="fusion-motion-chips__picker fusion-motion-chips__picker--portal"
        role="listbox"
        aria-label="Elegir movimiento"
        style={{
          top: pickerPos.top,
          left: pickerPos.left,
          width: pickerPos.width,
          transform: pickerPos.placeAbove ? 'translateY(-100%)' : undefined
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="fusion-motion-chips__picker-section">
          <span className="fusion-motion-chips__picker-label">Gestos</span>
          <div className="fusion-motion-chips__picker-grid">
            {BUILTIN_MOTION_SIMPLE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="fusion-program-motion-btn"
                disabled={presetIds.includes(p.id)}
                title={p.title}
                onClick={() => {
                  if (onAddPreset(p.id)) setPickerOpen(false)
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="fusion-motion-chips__picker-section">
          <span className="fusion-motion-chips__picker-label">Secuencias</span>
          <div className="fusion-motion-chips__picker-grid fusion-motion-chips__picker-grid--seq">
            {BUILTIN_MOTION_SEQUENCE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="fusion-program-motion-btn fusion-program-motion-btn--sequence"
                disabled={presetIds.includes(p.id)}
                title={p.title}
                onClick={() => {
                  if (onAddPreset(p.id)) setPickerOpen(false)
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {customPresets.length > 0 ? (
          <div className="fusion-motion-chips__picker-section">
            <span className="fusion-motion-chips__picker-label">Tuyos</span>
            <div className="fusion-motion-chips__picker-grid">
              {customPresets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="fusion-program-motion-btn fusion-program-motion-btn--custom"
                  disabled={presetIds.includes(p.id)}
                  title={p.title}
                  onClick={() => {
                    if (onAddPreset(p.id)) setPickerOpen(false)
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    ) : null

  return (
    <div className="fusion-motion-chips" ref={wrapRef}>
      {presetIds.map((presetId, index) => {
        const meta = resolveMotionPresetDisplay(presetId)
        if (!meta) return null
        return (
          <button
            key={`${cameraId}-${presetId}-${index}`}
            type="button"
            className={[
              'fusion-motion-chip',
              motionPresetChipClassName(meta.chipVariant)
            ].join(' ')}
            title={`${meta.label} — clic: quitar · doble clic: probar`}
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation()
              onRemoveAt(index)
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              onPreviewPreset?.(presetId)
            }}
          >
            {meta.chipLetter}
          </button>
        )
      })}
      {canAdd ? (
        <div className="fusion-motion-chips__add-wrap">
          <button
            ref={addBtnRef}
            type="button"
            className="fusion-motion-chip fusion-motion-chip--add"
            title="Añadir movimiento al entrar esta cámara"
            onClick={(e) => {
              e.stopPropagation()
              setPickerOpen((v) => !v)
            }}
          >
            +
          </button>
        </div>
      ) : null}
      {pickerEl ? createPortal(pickerEl, document.body) : null}
    </div>
  )
}
