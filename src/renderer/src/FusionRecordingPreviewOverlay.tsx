import { useEffect } from 'react'
import type { RefObject, SyntheticEvent } from 'react'

import { RecordingTrimControls } from './RecordingTrimControls'
import { StudioModalOverlay } from './StudioModalOverlay'
import { GLYPH } from './uiGlyphs'
import { probeVideoDurationSec, readVideoDurationSec } from './videoDurationProbe'

export type FusionRecordingPreviewOverlayProps = {
  mode: 'files' | 'live'
  videoUrl: string
  fileName: string
  onFileNameChange: (v: string) => void
  outputDir: string | null
  exportBusy: boolean
  exportTarget: 'webm' | 'mp4' | null
  exportElapsed: number
  onSaveWebm: () => void
  onSaveMp4: () => void
  onDiscard: () => void
  videoRef?: RefObject<HTMLVideoElement | null>
  wrapRef?: RefObject<HTMLDivElement | null>
  isFullscreen?: boolean
  pseudoFullscreen?: boolean
  onToggleFullscreen?: () => void
  onPreviewPlay?: () => void
  onPreviewPause?: () => void
  durationSec?: number
  trimInSec?: number
  trimOutSec?: number
  exportDurationSec?: number
  onTrimInChange?: (v: number) => void
  onTrimOutChange?: (v: number) => void
  onVideoDuration?: (durationSec: number) => void
  /** Si el WebM no informa duración, usar tiempo de grabación del transporte. */
  fallbackRecordedSec?: number
}

export function FusionRecordingPreviewOverlay({
  mode,
  videoUrl,
  fileName,
  onFileNameChange,
  outputDir,
  exportBusy,
  exportTarget,
  exportElapsed,
  onSaveWebm,
  onSaveMp4,
  onDiscard,
  videoRef,
  wrapRef,
  isFullscreen,
  pseudoFullscreen,
  onToggleFullscreen,
  onPreviewPlay,
  onPreviewPause,
  durationSec = 0,
  trimInSec = 0,
  trimOutSec = 0,
  exportDurationSec = 0,
  onTrimInChange,
  onTrimOutChange,
  onVideoDuration,
  fallbackRecordedSec
}: FusionRecordingPreviewOverlayProps) {
  const showTrim = Boolean(onTrimInChange && onTrimOutChange)

  const reportDuration = (el: HTMLVideoElement) => {
    const d = readVideoDurationSec(el)
    if (d != null) onVideoDuration?.(d)
    else {
      void probeVideoDurationSec(el).then((probed) => {
        if (probed != null) onVideoDuration?.(probed)
      })
    }
  }

  const onVideoMeta = (e: SyntheticEvent<HTMLVideoElement>) => {
    reportDuration(e.currentTarget)
  }

  useEffect(() => {
    if (!showTrim || !videoUrl) return
    let cancelled = false
    const run = () => {
      if (cancelled) return
      const el = videoRef?.current
      if (!el) return
      reportDuration(el)
    }
    run()
    const t1 = window.setTimeout(run, 80)
    const t2 = window.setTimeout(run, 500)
    return () => {
      cancelled = true
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-probar al cambiar la URL del blob
  }, [videoUrl, showTrim, videoRef])

  useEffect(() => {
    if (durationSec > 0) return
    if (fallbackRecordedSec != null && fallbackRecordedSec > 0) {
      onVideoDuration?.(fallbackRecordedSec)
    }
  }, [durationSec, fallbackRecordedSec, onVideoDuration])

  const seekPreview = (timeSec: number) => {
    const el = videoRef?.current
    if (!el) return
    try {
      el.currentTime = timeSec
    } catch {
      /* vacío */
    }
  }
  const subtitle =
    mode === 'files' ? (
      <>
        Revisá la toma, recortá inicio/final si hace falta, elegí el nombre y guardala.{' '}
        <strong>MP4</strong> suele ir mejor en el Reproductor de Windows; WebM guarda más rápido.
      </>
    ) : (
      <>
        Revisá la toma del programa, recortá inicio/final si hace falta y guardala.{' '}
        <strong>MP4</strong> suele ir mejor en Windows; WebM guarda más rápido.
      </>
    )

  return (
    <StudioModalOverlay
      wide
      zIndex={100}
      title="Grabación terminada"
      subtitle={subtitle}
      titleId="fusion-preview-title"
    >
      {mode === 'files' ? (
        <p className="fusion-preview-overlay__hint">
          Play solo reproduce esta toma. La línea de tiempo de abajo mueve las pistas y sincroniza la vista
          previa.
        </p>
      ) : null}

      <label htmlFor="fusion-preview-filename" className="fusion-preview-overlay__label">
        Nombre de archivo
      </label>
      <input
        id="fusion-preview-filename"
        type="text"
        className="fusion-preview-overlay__input"
        value={fileName}
        onChange={(e) => onFileNameChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        disabled={exportBusy}
        placeholder="mi-fusion.webm"
      />

      {mode === 'files' && wrapRef ? (
        <div
          ref={wrapRef}
          className={
            'fusion-export-preview-wrap' +
            (pseudoFullscreen ? ' fusion-export-preview-wrap--pseudo-fs' : '')
          }
        >
          {onToggleFullscreen ? (
            <button
              type="button"
              className="fusion-preview-overlay__fs-btn"
              onClick={() => void onToggleFullscreen()}
            >
              {isFullscreen || pseudoFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            </button>
          ) : null}
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            controlsList="nofullscreen"
            playsInline
            preload="metadata"
            className="fusion-export-preview-video fusion-preview-overlay__video"
            onPlay={onPreviewPlay}
            onPause={onPreviewPause}
            onLoadedMetadata={onVideoMeta}
            onDurationChange={onVideoMeta}
            onLoadedData={onVideoMeta}
          />
        </div>
      ) : (
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          playsInline
          preload="auto"
          className="fusion-preview-overlay__video"
          onLoadedMetadata={onVideoMeta}
          onDurationChange={onVideoMeta}
          onLoadedData={onVideoMeta}
        />
      )}

      {showTrim ? (
        <RecordingTrimControls
          durationSec={durationSec}
          trimInSec={trimInSec}
          trimOutSec={trimOutSec}
          exportDurationSec={exportDurationSec}
          disabled={exportBusy}
          onTrimInChange={onTrimInChange}
          onTrimOutChange={onTrimOutChange}
          onSeekPreview={seekPreview}
        />
      ) : null}

      <div className="fusion-preview-overlay__actions">
        <button
          type="button"
          className="fusion-preview-overlay__btn fusion-preview-overlay__btn--save-webm"
          disabled={!outputDir || exportBusy}
          onClick={() => void onSaveWebm()}
        >
          {exportTarget === 'webm' ? (
            <>
              <span className="studio-spinner" aria-hidden /> Guardando WebM{GLYPH.ellipsis}
            </>
          ) : mode === 'live' ? (
            'Guardar WebM en carpeta'
          ) : (
            'Guardar WebM'
          )}
        </button>
        <button
          type="button"
          className="fusion-preview-overlay__btn fusion-preview-overlay__btn--save-mp4"
          disabled={!outputDir || exportBusy}
          onClick={() => void onSaveMp4()}
        >
          {exportTarget === 'mp4' ? (
            <>
              <span className="studio-spinner" aria-hidden /> Generando MP4{GLYPH.ellipsis}
            </>
          ) : (
            'Guardar MP4'
          )}
        </button>
        <button
          type="button"
          className="fusion-preview-overlay__btn fusion-preview-overlay__btn--discard"
          disabled={exportBusy}
          onClick={onDiscard}
        >
          {mode === 'files' ? 'Descartar vista previa' : 'Descartar'}
        </button>
      </div>

      {exportTarget ? (
        <div
          role="status"
          aria-live="polite"
          className={
            'fusion-preview-overlay__progress' +
            (exportTarget === 'mp4' ? ' fusion-preview-overlay__progress--mp4' : '')
          }
        >
          <div className="fusion-preview-overlay__progress-row">
            <span className="studio-spinner lg" aria-hidden />
            <div className="fusion-preview-overlay__progress-text">
              <strong>
                {exportTarget === 'mp4' ? `Generando MP4${GLYPH.ellipsis}` : `Guardando WebM${GLYPH.ellipsis}`}
              </strong>{' '}
              {exportTarget === 'mp4'
                ? 'Convirtiendo a H.264 (con recorte si aplicaste; puede tardar).'
                : 'Guardando en la carpeta de grabación…'}
            </div>
            <span className="fusion-preview-overlay__progress-time">
              {Math.floor(exportElapsed / 1000)}s
            </span>
          </div>
          <div className="studio-progress-bar" aria-hidden />
        </div>
      ) : null}
    </StudioModalOverlay>
  )
}
