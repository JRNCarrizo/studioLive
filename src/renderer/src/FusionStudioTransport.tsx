import { useState } from 'react'

import { fmtPlanTime } from './fusionCameraPlan'
import { GLYPH } from './uiGlyphs'
import { useFloatingPanelPosition } from './useFloatingPanelPosition'

export type { FusionTimelineSegment } from './fusionCameraPlan'

const STORAGE = {
  files: {
    pos: 'studioLive.fusionTransport.pos.v1',
    min: 'studioLive.fusionTransport.minimized.v1',
    float: 'studioLive.fusionTransport.floating.v1'
  },
  live: {
    pos: 'studioLive.liveFusionTransport.pos.v1',
    min: 'studioLive.liveFusionTransport.minimized.v1',
    float: 'studioLive.liveFusionTransport.floating.v1'
  },
  iso: {
    pos: 'studioLive.isoTransport.pos.v1',
    min: 'studioLive.isoTransport.minimized.v1',
    float: 'studioLive.isoTransport.floating.v1'
  }
} as const

export type IsoTransportPhase = 'idle' | 'recording' | 'paused' | 'pending'

type FilesProps = {
  mode?: 'files'
  visible: boolean
  playing: boolean
  fusionRecording: boolean
  fusionRecorderPaused: boolean
  fusionPreviewUrl: string | null
  recordPauseSupported: boolean
  canRecord: boolean
  canPlay: boolean
  canCloseSession: boolean
  currentTime: number
  duration: number
  onTogglePlay: () => void
  onRecordStart: () => void
  onRecordPause: () => void
  onRecordResume: () => void
  onRecordStop: () => void
  onCloseSession: () => void
}

type LiveProps = {
  mode: 'live'
  visible: boolean
  fusionRecording: boolean
  elapsedLabel: string
  canRecord: boolean
  canCancel: boolean
  onRecordStart: () => void
  onRecordStop: () => void
  onCancel: () => void
}

type IsoProps = {
  mode: 'iso'
  visible: boolean
  phase: IsoTransportPhase
  elapsedLabel: string
  sourcesLabel: string
  pauseSupported: boolean
  canStart: boolean
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  statusLine?: string
}

export type FusionStudioTransportProps = FilesProps | LiveProps | IsoProps

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    if (v === '1') return true
    if (v === '0') return false
  } catch {
    /* vacío */
  }
  return fallback
}

function defaultFloatPos(): { x: number; y: number } {
  return { x: 12, y: Math.max(8, window.innerHeight - 120) }
}

export function FusionStudioTransport(props: FusionStudioTransportProps) {
  const mode = props.mode ?? 'files'
  const isFiles = mode === 'files'
  const isProgramLive = mode === 'live'
  const isIso = mode === 'iso'
  const keys = STORAGE[mode === 'files' ? 'files' : mode === 'live' ? 'live' : 'iso']

  const [floating, setFloating] = useState(() => readBool(keys.float, false))
  const { pos, rootRef, startDrag } = useFloatingPanelPosition(keys.pos, defaultFloatPos)

  const isoPhase = isIso ? props.phase : null
  const recording =
    isIso
      ? isoPhase === 'recording' || isoPhase === 'paused'
      : isProgramLive
        ? props.fusionRecording
        : props.fusionRecording
  const paused = isIso ? isoPhase === 'paused' : isFiles ? props.fusionRecorderPaused : false
  const playing = isFiles ? props.playing : false

  const timeLabel = isIso
    ? isoPhase === 'idle'
      ? '00:00'
      : props.elapsedLabel
    : isProgramLive
      ? props.elapsedLabel
      : `${fmtPlanTime(props.currentTime)} / ${fmtPlanTime(props.duration > 0 ? props.duration : 0)}`

  const tallyLabel = isIso
    ? isoPhase === 'recording'
      ? 'REC'
      : isoPhase === 'paused'
        ? 'PAUSA'
        : isoPhase === 'pending'
          ? 'LISTO'
          : 'STBY'
    : recording
      ? paused
        ? 'PAUSA'
        : 'REC'
      : playing
        ? 'PLAY'
        : 'STBY'

  const toggleFloating = () => {
    setFloating((v) => {
      const next = !v
      try {
        localStorage.setItem(keys.float, next ? '1' : '0')
      } catch {
        /* vacío */
      }
      return next
    })
  }

  if (!props.visible) return null

  const ariaLabel = isIso
    ? 'Transporte grabación ISO'
    : isProgramLive
      ? 'Transporte programa en vivo'
      : 'Transporte de fusión'

  const rootClass = [
    'fusion-dock-transport',
    recording ? 'fusion-dock-transport--live' : '',
    paused ? 'fusion-dock-transport--paused' : '',
    floating ? 'fusion-dock-transport--floating' : 'fusion-dock-transport--docked',
    isProgramLive ? 'fusion-dock-transport--program-live' : '',
    isIso ? 'fusion-dock-transport--iso' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={rootRef}
      className={rootClass}
      style={floating ? { left: pos.x, top: pos.y } : undefined}
      role="region"
      aria-label={ariaLabel}
    >
      <div
        className="fusion-dock-transport__toolbar"
        onMouseDown={floating ? GLYPH.floatOn : GLYPH.floatOff}
        title={floating ? 'Arrastrá para mover' : undefined}
      >
        <div className="fusion-dock-transport__toolbar-left">
          <button
            type="button"
            className={`fusion-dock-transport__chrome-btn${floating ? ' fusion-dock-transport__chrome-btn--on' : ''}`}
            onClick={toggleFloating}
            title={floating ? 'Anclar abajo' : 'Desanclar (ventana flotante)'}
          >
            {floating ? GLYPH.floatOn : GLYPH.floatOff}
          </button>
          <span
            className={`fusion-dock-transport__lamp${recording && !paused ? ' fusion-dock-transport__lamp--rec' : paused ? ' fusion-dock-transport__lamp--pause' : playing ? ' fusion-dock-transport__lamp--play' : ''}`}
            aria-hidden
          />
          <span className="fusion-dock-transport__tally">{tallyLabel}</span>
          <span
            className="fusion-dock-transport__time"
            title={isFiles ? 'Posición en la línea de tiempo' : 'Tiempo de esta toma'}
          >
            {timeLabel}
          </span>
          {isIso ? (
            <span className="fusion-dock-transport__sources" title={props.sourcesLabel}>
              {props.sourcesLabel}
            </span>
          ) : null}
        </div>

        <div className="fusion-dock-transport__buttons" role="group" aria-label="Controles">
          {isFiles ? (
            <button
              type="button"
              className={`fusion-dock-btn fusion-dock-btn--play${playing ? ' fusion-dock-btn--active' : ''}`}
              disabled={!props.canPlay}
              onClick={props.onTogglePlay}
              title={
                props.fusionPreviewUrl
                  ? playing
                    ? 'Pausar vista previa'
                    : 'Reproducir vista previa'
                  : playing
                    ? 'Pausar (mantiene la posición)'
                    : 'Reproducir'
              }
            >
              {playing ? GLYPH.pause : GLYPH.play}
              <span className="fusion-dock-btn__label">{playing ? 'Pausar' : 'Play'}</span>
            </button>
          ) : null}

          {isIso && isoPhase === 'pending' ? (
            <button type="button" className="fusion-dock-btn fusion-dock-btn--ghost" disabled>
              <span className="fusion-dock-btn__label">Revisar{GLYPH.ellipsis}</span>
            </button>
          ) : null}

          {!recording && !(isIso && isoPhase === 'pending') ? (
            <button
              type="button"
              className="fusion-dock-btn fusion-dock-btn--record"
              disabled={isIso ? !props.canStart : isProgramLive ? !props.canRecord : !props.canRecord}
              onClick={isIso ? props.onStart : props.onRecordStart}
              title={
                isIso
                  ? 'Inicia un archivo por cada cámara (+ audio de PC si está activo)'
                  : isProgramLive
                    ? 'Grabar salida del programa'
                    : 'Grabar mezcla'
              }
            >
              {GLYPH.record}
              {GLYPH.record}
              <span className="fusion-dock-btn__label">Grabar</span>
            </button>
          ) : null}

          {recording ? (
            <>
              {isIso && props.pauseSupported ? (
                paused ? (
                  <button
                    type="button"
                    className="fusion-dock-btn fusion-dock-btn--resume"
                    onClick={props.onResume}
                    title="Sigue grabando en la misma toma"
                  >
                    {GLYPH.play}
                    {GLYPH.play}
                    <span className="fusion-dock-btn__label">Seguir</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="fusion-dock-btn fusion-dock-btn--pause"
                    onClick={props.onPause}
                    title="Pausa todas las pistas (misma sesión)"
                  >
                    {GLYPH.pause}
                    {GLYPH.pause}
                    <span className="fusion-dock-btn__label">Pausa</span>
                  </button>
                )
              ) : null}

              {isFiles && props.recordPauseSupported ? (
                paused ? (
                  <button
                    type="button"
                    className="fusion-dock-btn fusion-dock-btn--resume"
                    onClick={props.onRecordResume}
                    title="Seguir grabando"
                  >
                    {GLYPH.play}
                    {GLYPH.play}
                    <span className="fusion-dock-btn__label">Seguir</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="fusion-dock-btn fusion-dock-btn--pause"
                    onClick={props.onRecordPause}
                    title="Pausar grabación"
                  >
                    {GLYPH.pause}
                    {GLYPH.pause}
                    <span className="fusion-dock-btn__label">Pausa</span>
                  </button>
                )
              ) : null}

              <button
                type="button"
                className="fusion-dock-btn fusion-dock-btn--stop"
                onClick={isIso ? props.onStop : props.onRecordStop}
                title="Finalizar grabación"
              >
                {GLYPH.stop}
                {GLYPH.stop}
                <span className="fusion-dock-btn__label">Fin</span>
              </button>
            </>
          ) : null}

          {isProgramLive && props.canCancel ? (
            <button
              type="button"
              className="fusion-dock-btn fusion-dock-btn--ghost"
              onClick={props.onCancel}
              title={
                recording ? 'Descartar la toma actual sin guardar' : 'Descartar vista previa sin guardar'
              }
            >
              <span className="fusion-dock-btn__label">Cancelar</span>
            </button>
          ) : null}

          {isFiles && props.canCloseSession && !recording ? (
            <button
              type="button"
              className="fusion-dock-btn fusion-dock-btn--ghost"
              onClick={props.onCloseSession}
              title="Cerrar sesión cargada"
            >
              <span className="fusion-dock-btn__label">Cerrar</span>
            </button>
          ) : null}
        </div>
      </div>

      {isIso && props.statusLine ? (
        <p className="fusion-dock-transport__status">{props.statusLine}</p>
      ) : null}
    </div>
  )
}
