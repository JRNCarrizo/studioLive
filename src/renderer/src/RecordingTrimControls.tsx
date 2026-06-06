import { formatMediaTime } from './videoTrim'

type Props = {
  durationSec: number
  trimInSec: number
  trimOutSec: number
  exportDurationSec: number
  disabled?: boolean
  onTrimInChange: (v: number) => void
  onTrimOutChange: (v: number) => void
  onSeekPreview?: (timeSec: number) => void
}

export function RecordingTrimControls({
  durationSec,
  trimInSec,
  trimOutSec,
  exportDurationSec,
  disabled,
  onTrimInChange,
  onTrimOutChange,
  onSeekPreview
}: Props) {
  const maxIn = Math.max(0, (durationSec > 0 ? trimOutSec : 1) - 0.5)
  const minOut = Math.min(durationSec, trimInSec + 0.5)

  const slidersReady = durationSec > 0

  return (
    <div className="recording-trim" aria-label="Recorte de inicio y final">
      <div className="recording-trim__head">
        <span className="recording-trim__title">Recorte</span>
        <span className="recording-trim__meta">
          {slidersReady ? (
            <>
              Exportar <strong>{formatMediaTime(exportDurationSec)}</strong>
              <span className="recording-trim__meta-muted"> / {formatMediaTime(durationSec)}</span>
            </>
          ) : (
            <span className="recording-trim__meta-muted">Leyendo duración del video…</span>
          )}
        </span>
      </div>
      <label className="recording-trim__row">
        <span className="recording-trim__label">Inicio</span>
        <input
          type="range"
          className="recording-trim__range"
          min={0}
          max={maxIn}
          step={0.05}
          value={trimInSec}
          disabled={disabled || !slidersReady}
          onChange={(e) => {
            const v = Number(e.target.value)
            onTrimInChange(v)
            onSeekPreview?.(v)
          }}
        />
        <span className="recording-trim__time">{formatMediaTime(trimInSec)}</span>
      </label>
      <label className="recording-trim__row">
        <span className="recording-trim__label">Final</span>
        <input
          type="range"
          className="recording-trim__range"
          min={minOut}
          max={durationSec}
          step={0.05}
          value={trimOutSec}
          disabled={disabled || !slidersReady}
          onChange={(e) => {
            const v = Number(e.target.value)
            onTrimOutChange(v)
            onSeekPreview?.(v)
          }}
        />
        <span className="recording-trim__time">{formatMediaTime(trimOutSec)}</span>
      </label>
      <p className="recording-trim__hint">
        Ajustá inicio y final antes de guardar. El archivo completo en memoria no cambia hasta exportar.
      </p>
    </div>
  )
}
