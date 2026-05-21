import { useCallback, useEffect, useRef } from 'react'

import { fmtPlanTime, type FusionTimelineSegment } from './fusionCameraPlan'

type Props = {
  visible: boolean
  segments: FusionTimelineSegment[]
  scaleDuration: number
  currentTime: number
  segmentColor: (cameraId: string) => string
  resolveAlias: (id: string) => string
  legendCameraIds?: string[]
  onSeek?: (t: number) => void
  onSegmentClick?: (seg: FusionTimelineSegment, index: number) => void
}

export function FusionCameraPlanBar({
  visible,
  segments,
  scaleDuration,
  currentTime,
  segmentColor,
  resolveAlias,
  legendCameraIds = [],
  onSeek,
  onSegmentClick
}: Props) {
  const barRef = useRef<HTMLDivElement>(null)
  const scrubbingRef = useRef(false)

  const scaleMax = Math.max(scaleDuration, 0.05)
  const playheadPct = Math.min(100, (currentTime / scaleMax) * 100)
  const interactive = Boolean(onSeek)

  const seekFromClientX = useCallback(
    (clientX: number) => {
      if (!onSeek) return
      const bar = barRef.current
      if (!bar) return
      const rect = bar.getBoundingClientRect()
      const w = rect.width || 1
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / w))
      onSeek(ratio * scaleMax)
    },
    [onSeek, scaleMax]
  )

  useEffect(() => {
    if (!interactive) return
    const onMove = (e: PointerEvent) => {
      if (!scrubbingRef.current) return
      seekFromClientX(e.clientX)
    }
    const onUp = () => {
      scrubbingRef.current = false
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [interactive, seekFromClientX])

  if (!visible) return null

  const legendIds =
    legendCameraIds.length > 0
      ? legendCameraIds
      : [...new Set(segments.map((s) => s.cameraId))]

  return (
    <div className="fusion-camera-plan" data-fusion-plan-root>
      <div className="fusion-camera-plan__header">
        <span className="fusion-camera-plan__title">Plan de cámara</span>
        <span className="fusion-camera-plan__hint">
          {interactive
            ? 'Clic o arrastrá en la barra · cada color es una toma'
            : 'Cada bloque es una toma al aire'}
        </span>
      </div>
      <div
        ref={barRef}
        className={`fusion-camera-plan__track${interactive ? ' fusion-camera-plan__track--interactive' : ''}`}
        role={interactive ? 'slider' : undefined}
        aria-valuemin={interactive ? 0 : undefined}
        aria-valuemax={interactive ? scaleMax : undefined}
        aria-valuenow={interactive ? currentTime : undefined}
        aria-label={interactive ? 'Plan de cámaras en el tiempo' : undefined}
        onPointerDown={
          interactive
            ? (e) => {
                scrubbingRef.current = true
                ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
                seekFromClientX(e.clientX)
              }
            : undefined
        }
        onPointerMove={
          interactive
            ? (e) => {
                if (!scrubbingRef.current) return
                seekFromClientX(e.clientX)
              }
            : undefined
        }
        onPointerUp={interactive ? () => { scrubbingRef.current = false } : undefined}
      >
        {segments.length === 0 ? (
          <div className="fusion-camera-plan__empty">
            {interactive
              ? 'Al grabar, cada cambio de cámara aparece aquí como un bloque de color.'
              : 'Los cortes de cámara aparecerán aquí al grabar el programa.'}
          </div>
        ) : (
          segments.map((seg, i) => {
            const leftPct = (seg.startSec / scaleMax) * 100
            const widthPct = Math.max(0.4, ((seg.endSec - seg.startSec) / scaleMax) * 100)
            return (
              <button
                key={`${seg.cameraId}-${i}-${seg.startSec}`}
                type="button"
                className="fusion-camera-plan__seg"
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  background: segmentColor(seg.cameraId)
                }}
                title={`${resolveAlias(seg.cameraId)} · ${fmtPlanTime(seg.startSec)} → ${fmtPlanTime(seg.endSec)}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onSegmentClick?.(seg, i)
                  if (onSeek) onSeek(seg.startSec)
                }}
              >
                <span className="fusion-camera-plan__seg-label">{resolveAlias(seg.cameraId)}</span>
              </button>
            )
          })
        )}
        {segments.length > 0 ? (
          <div className="fusion-camera-plan__playhead" style={{ left: `${playheadPct}%` }} aria-hidden />
        ) : null}
      </div>
      {legendIds.length > 0 ? (
        <div className="fusion-camera-plan__legend">
          {legendIds.map((id) => (
            <span key={id} className="fusion-camera-plan__legend-item">
              <span
                className="fusion-camera-plan__legend-swatch"
                style={{ background: segmentColor(id) }}
                aria-hidden
              />
              <span title={resolveAlias(id) !== id ? id : undefined}>{resolveAlias(id)}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
