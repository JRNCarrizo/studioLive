import { useState } from 'react'

import {
  PROGRAM_BACKGROUND_COLOR_PRESETS,
  type ProgramBackground,
  type ProgramBackgroundImageFit,
  type ProgramBackgroundMode
} from './programBackground'

type Props = {
  background: ProgramBackground
  cameraIds: string[]
  resolveAlias: (id: string) => string
  onBackgroundChange: (next: ProgramBackground) => void
}

async function pickBackgroundImageFile(): Promise<string | null> {
  const filePath = await window.studio.pickImageFile()
  if (!filePath) return null
  const dataUrl = await window.studio.readImageDataUrl(filePath)
  return dataUrl
}

export function FusionProgramBackgroundTools({
  background,
  cameraIds,
  resolveAlias,
  onBackgroundChange
}: Props) {
  const [pickingImage, setPickingImage] = useState(false)

  const setMode = (mode: ProgramBackgroundMode) => {
    const next: ProgramBackground = { ...background, mode }
    if (mode === 'camera' && !next.cameraId && cameraIds[0]) {
      next.cameraId = cameraIds[0]!
    }
    onBackgroundChange(next)
  }

  const onPickImage = async () => {
    setPickingImage(true)
    try {
      const url = await pickBackgroundImageFile()
      if (url) onBackgroundChange({ ...background, mode: 'image', imageUrl: url })
    } finally {
      setPickingImage(false)
    }
  }

  return (
    <div
      className="fusion-program-tools fusion-program-tools--background"
      onMouseDown={(ev) => ev.stopPropagation()}
      onDoubleClick={(ev) => ev.stopPropagation()}
    >
      <div className="fusion-program-tool-block">
        <span className="fusion-program-tool-label" title="Detrás de los paneles del layout.">
          Fondo
        </span>
        <div className="fusion-program-tool-actions fusion-program-tool-actions--modes">
          <button
            type="button"
            className={background.mode === 'color' ? 'fusion-program-tool-btn--active' : ''}
            onClick={() => setMode('color')}
          >
            Color
          </button>
          <button
            type="button"
            className={background.mode === 'image' ? 'fusion-program-tool-btn--active' : ''}
            onClick={() => setMode('image')}
          >
            Img
          </button>
          <button
            type="button"
            className={background.mode === 'camera' ? 'fusion-program-tool-btn--active' : ''}
            onClick={() => setMode('camera')}
            disabled={cameraIds.length === 0}
            title={cameraIds.length === 0 ? 'Sin cámaras conectadas' : undefined}
          >
            Cam
          </button>
        </div>

        {background.mode === 'color' ? (
          <div className="fusion-program-bg-panel">
            <input
              type="color"
              className="fusion-program-bg-color-input"
              value={background.color}
              onChange={(e) => onBackgroundChange({ ...background, color: e.target.value })}
              aria-label="Color de fondo"
            />
            <div className="fusion-program-bg-presets">
              {PROGRAM_BACKGROUND_COLOR_PRESETS.map((p) => (
                <button
                  key={p.color}
                  type="button"
                  className="fusion-program-bg-preset"
                  title={p.label}
                  style={{ background: p.color }}
                  onClick={() => onBackgroundChange({ ...background, color: p.color })}
                />
              ))}
            </div>
          </div>
        ) : null}

        {background.mode === 'image' ? (
          <div className="fusion-program-bg-panel">
            <div className="fusion-program-tool-actions">
              <button type="button" onClick={() => void onPickImage()} disabled={pickingImage}>
                {pickingImage ? '…' : background.imageUrl ? 'Cambiar' : 'Elegir'}
              </button>
              {background.imageUrl ? (
                <button
                  type="button"
                  onClick={() => onBackgroundChange({ ...background, imageUrl: null })}
                >
                  Quitar
                </button>
              ) : null}
            </div>
            <div className="fusion-program-tool-actions fusion-program-tool-actions--modes">
              {(['cover', 'contain'] as ProgramBackgroundImageFit[]).map((fit) => (
                <button
                  key={fit}
                  type="button"
                  className={
                    background.imageFit === fit ? 'fusion-program-tool-btn--active' : ''
                  }
                  onClick={() => onBackgroundChange({ ...background, imageFit: fit })}
                >
                  {fit === 'cover' ? 'Llenar' : 'Entera'}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {background.mode === 'camera' ? (
          <div className="fusion-program-bg-panel">
            <select
              className="fusion-program-bg-select"
              value={background.cameraId ?? ''}
              onChange={(e) =>
                onBackgroundChange({
                  ...background,
                  cameraId: e.target.value || null
                })
              }
            >
              <option value="">Elegí cámara…</option>
              {cameraIds.map((id) => (
                <option key={id} value={id}>
                  {resolveAlias(id)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
    </div>
  )
}
