import { useCallback, useEffect, useRef, useState } from 'react'

import { StudioConfirmForm } from './StudioInlineDialog'
import { btnNeutral } from './workspaceChrome'

const PC_AUDIO_RECORDER_KEY = 'pc-audio'

type PreviewItem = { recKey: string; parts: BlobPart[]; mime: string }

type PreviewActive = {
  item: PreviewItem
  url: string
  label: string
  isAudio: boolean
} | null

type AliasResolver = (cameraId: string) => string

type Props = {
  outputDir: string | null
  isoFolderNameDraft: string
  onFolderDraftChange: (v: string) => void
  onConfirmSave: () => void
  onDiscard: () => void
  itemsSorted: PreviewItem[]
  selectedKey: string
  onSelectKey: (k: string) => void
  active: PreviewActive
  /** URL blob de la pista `audio-*.webm` de la misma sesión, para escucharla junto al vídeo de cada cámara. */
  pcAudioPreviewUrl: string | null
  resolveAlias: AliasResolver
}

const ISO_PREVIEW_MAX_H = 220

/** Mismo glifo que la barra de controles del video (expandir / salir). */
function IsoPreviewFsIcon({ expanded }: { expanded: boolean }) {
  if (expanded) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M5 16h3v3H5v-3zm11 0h3v3h-3v-3zM5 5h3v3H5V5zm11 0h3v3h-3V5z" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="M7 14H5v5h5v-2H7v-3zm12 0h-2v3h-3v2h5v-5zM14 5h-3V2H5v5h2V5h7zm-4 0H5v3h5V5z"
        fill="currentColor"
      />
    </svg>
  )
}

function clampTime(t: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, t)
  return Math.min(Math.max(0, t), Math.max(0, duration - 0.04))
}

export function IsoRecordingReviewOverlay({
  outputDir,
  isoFolderNameDraft,
  onFolderDraftChange,
  onConfirmSave,
  onDiscard,
  itemsSorted,
  selectedKey,
  onSelectKey,
  active,
  pcAudioPreviewUrl,
  resolveAlias
}: Props) {
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const previewWrapRef = useRef<HTMLDivElement | null>(null)
  const pcAudioSyncRef = useRef<HTMLAudioElement | null>(null)
  const lastNudgeMsRef = useRef(0)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const clearNativeVideoPresentation = useCallback(async () => {
    const vid = videoRef.current as
      | (HTMLVideoElement & {
          webkitDisplayingFullscreen?: boolean
          webkitExitFullscreen?: () => void
        })
      | null
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
    } catch {
      /* vacío */
    }
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
    } catch {
      /* vacío */
    }
    if (vid?.webkitDisplayingFullscreen && vid.webkitExitFullscreen) {
      try {
        vid.webkitExitFullscreen()
      } catch {
        /* vacío */
      }
    }
  }, [])

  const exitPreviewFullscreen = useCallback(async () => {
    setPreviewExpanded(false)
    await clearNativeVideoPresentation()
  }, [clearNativeVideoPresentation])

  /** Pantalla completa a viewport (CSS). La API nativa del video en Electron suele quedar mini en una esquina. */
  const enterPreviewFullscreen = useCallback(async () => {
    await clearNativeVideoPresentation()
    setPreviewExpanded(true)
  }, [clearNativeVideoPresentation])

  const togglePreviewFullscreen = useCallback(async () => {
    if (previewExpanded) {
      await exitPreviewFullscreen()
      return
    }
    await enterPreviewFullscreen()
  }, [previewExpanded, enterPreviewFullscreen, exitPreviewFullscreen])

  useEffect(() => {
    setConfirmDiscard(false)
    setPreviewError(null)
    void exitPreviewFullscreen()
  }, [selectedKey, active?.item.recKey, active?.url, exitPreviewFullscreen])

  useEffect(() => {
    const vid = videoRef.current
    if (!vid) return

    const sync = () => {
      const el = document.fullscreenElement
      if (el === vid || document.pictureInPictureElement === vid) {
        void enterPreviewFullscreen()
      }
    }

    const onWebkitBegin = () => void enterPreviewFullscreen()
    const onEnterPip = () => void enterPreviewFullscreen()

    document.addEventListener('fullscreenchange', sync)
    vid.addEventListener('fullscreenchange', sync)
    vid.addEventListener('webkitbeginfullscreen', onWebkitBegin)
    vid.addEventListener('enterpictureinpicture', onEnterPip)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      vid.removeEventListener('fullscreenchange', sync)
      vid.removeEventListener('webkitbeginfullscreen', onWebkitBegin)
      vid.removeEventListener('enterpictureinpicture', onEnterPip)
    }
  }, [active?.item.recKey, active?.url, enterPreviewFullscreen])

  useEffect(() => {
    if (!previewExpanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void exitPreviewFullscreen()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [previewExpanded, exitPreviewFullscreen])

  const syncPcAudioTime = useCallback(() => {
    const v = videoRef.current
    const a = pcAudioSyncRef.current
    if (!v || !a || !pcAudioPreviewUrl) return
    const ad = a.duration
    const target = Number.isFinite(ad) && ad > 0 ? clampTime(v.currentTime, ad) : v.currentTime
    if (Math.abs(a.currentTime - target) > 0.15) {
      try {
        a.currentTime = target
      } catch {
        /* vacío */
      }
    }
  }, [pcAudioPreviewUrl])

  const nudgePcAudioIfDrifted = useCallback(() => {
    const v = videoRef.current
    const a = pcAudioSyncRef.current
    if (!v || !a || v.paused || !pcAudioPreviewUrl) return
    const ad = a.duration
    if (!Number.isFinite(ad) || ad <= 0) return
    const target = clampTime(v.currentTime, ad)
    if (Math.abs(a.currentTime - target) > 0.35) {
      try {
        a.currentTime = target
      } catch {
        /* vacío */
      }
    }
  }, [pcAudioPreviewUrl])

  useEffect(() => {
    const a = pcAudioSyncRef.current
    if (!a) return
    a.pause()
    try {
      a.currentTime = 0
    } catch {
      /* vacío */
    }
  }, [selectedKey, active?.item.recKey, pcAudioPreviewUrl])

  const onVideoPlay = useCallback(() => {
    syncPcAudioTime()
    const a = pcAudioSyncRef.current
    const v = videoRef.current
    if (a && v) a.playbackRate = v.playbackRate
    void a?.play().catch(() => {})
  }, [syncPcAudioTime])

  const onVideoPause = useCallback(() => {
    pcAudioSyncRef.current?.pause()
  }, [])

  const onVideoSeeking = useCallback(() => {
    syncPcAudioTime()
  }, [syncPcAudioTime])

  const onVideoSeeked = useCallback(() => {
    syncPcAudioTime()
  }, [syncPcAudioTime])

  const onVideoRateChange = useCallback(() => {
    const a = pcAudioSyncRef.current
    const v = videoRef.current
    if (a && v) a.playbackRate = v.playbackRate
  }, [])

  const onVideoTimeUpdate = useCallback(() => {
    const now = performance.now()
    if (now - lastNudgeMsRef.current < 400) return
    lastNudgeMsRef.current = now
    nudgePcAudioIfDrifted()
  }, [nudgePcAudioIfDrifted])

  const showLinkedPcAudio =
    Boolean(active?.url && !active.isAudio && pcAudioPreviewUrl && active.item.recKey !== PC_AUDIO_RECORDER_KEY)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="iso-save-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(2, 6, 23, 0.88)',
        backdropFilter: 'blur(4px)',
        overflow: 'auto'
      }}
    >
      <div
        style={{
          width: 'min(720px, 100%)',
          maxHeight: 'calc(100vh - 32px)',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 12,
          border: '1px solid #334155',
          background: '#0f172a',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.55)',
          overflowY: 'auto',
          overflowX: 'hidden',
          margin: 'auto 0'
        }}
      >
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          borderBottom: '1px solid #1e293b',
          background: '#0f172a'
        }}
      >
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div id="iso-save-title" style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>
            Grabación terminada
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>
            Revisá cada toma, elegí el nombre de carpeta y guardá en disco, o descartá si no la querés.
          </p>
        </div>
        <label htmlFor="iso-preview-take" style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>
          Toma
        </label>
        <select
          id="iso-preview-take"
          value={selectedKey}
          onChange={(e) => onSelectKey(e.target.value)}
          style={{
            minWidth: 200,
            maxWidth: '100%',
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid #475569',
            background: '#020617',
            color: '#f1f5f9',
            fontSize: 13
          }}
        >
          {itemsSorted.map((item) => (
            <option key={item.recKey} value={item.recKey}>
              {item.recKey === PC_AUDIO_RECORDER_KEY ? 'Audio de PC' : resolveAlias(item.recKey)}
            </option>
          ))}
        </select>
        <span style={{ flex: '1 1 40px' }} />
        <button
          type="button"
          onClick={() => setConfirmDiscard(true)}
          disabled={confirmDiscard}
          style={{ ...btnNeutral, fontWeight: 600, fontSize: 12 }}
        >
          Descartar
        </button>
      </div>

      {confirmDiscard ? (
        <div style={{ flexShrink: 0, padding: '0 14px 10px' }}>
          <StudioConfirmForm
            message="¿Descartar esta grabación? No se guardará ningún archivo."
            submitLabel="Descartar"
            danger
            onConfirm={() => {
              setConfirmDiscard(false)
              onDiscard()
            }}
            onCancel={() => setConfirmDiscard(false)}
          />
        </div>
      ) : null}

      <div
        style={{
          flex: '0 0 auto',
          height: ISO_PREVIEW_MAX_H,
          maxHeight: ISO_PREVIEW_MAX_H,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b1220',
          padding: '8px 12px',
          gap: 6,
          position: 'relative',
          borderTop: '1px solid #1e293b',
          borderBottom: '1px solid #1e293b',
          overflow: 'visible',
          boxSizing: 'border-box'
        }}
      >
        {!active?.url ? (
          <span style={{ color: '#94a3b8', fontSize: 13 }}>Preparando vista previa…</span>
        ) : previewError ? (
          <span style={{ color: '#fca5a5', fontSize: 13, textAlign: 'center', maxWidth: 420, padding: '0 12px' }}>
            {previewError}
          </span>
        ) : active.isAudio ? (
          <audio
            key={active.item.recKey}
            controls
            preload="metadata"
            src={active.url}
            style={{ width: 'min(720px, 100%)', minHeight: 48 }}
          />
        ) : (
          <div
            ref={previewWrapRef}
            className={
              'iso-preview-wrap' + (previewExpanded ? ' iso-preview-wrap--expanded' : '')
            }
          >
            {previewExpanded ? (
              <button
                type="button"
                className="iso-preview-fs-exit-hint"
                onClick={() => void exitPreviewFullscreen()}
              >
                Esc o clic aquí para volver
              </button>
            ) : null}
            {showLinkedPcAudio ? (
              <audio
                ref={pcAudioSyncRef}
                preload="auto"
                src={pcAudioPreviewUrl ?? undefined}
                aria-hidden
                style={{
                  position: 'absolute',
                  width: 1,
                  height: 1,
                  padding: 0,
                  margin: -1,
                  overflow: 'hidden',
                  clip: 'rect(0,0,0,0)',
                  whiteSpace: 'nowrap',
                  border: 0
                }}
              />
            ) : null}
            <video
              ref={videoRef}
              key={active.item.recKey}
              className="iso-preview-video"
              controls
              controlsList="nodownload noremoteplayback nofullscreen"
              disablePictureInPicture
              playsInline
              muted={false}
              preload="metadata"
              src={active.url}
              onError={() =>
                setPreviewError(
                  'No se pudo reproducir esta toma (archivo vacío o formato no soportado). Podés guardar en disco e intentar abrir el .webm desde la carpeta.'
                )
              }
              onPlay={showLinkedPcAudio ? onVideoPlay : undefined}
              onPause={showLinkedPcAudio ? onVideoPause : undefined}
              onSeeking={showLinkedPcAudio ? onVideoSeeking : undefined}
              onSeeked={showLinkedPcAudio ? onVideoSeeked : undefined}
              onRateChange={showLinkedPcAudio ? onVideoRateChange : undefined}
              onTimeUpdate={showLinkedPcAudio ? onVideoTimeUpdate : undefined}
            />
            <button
              type="button"
              className="iso-preview-fs-btn"
              onClick={() => void togglePreviewFullscreen()}
              aria-label={previewExpanded ? 'Salir de pantalla completa' : 'Pantalla completa'}
              title={previewExpanded ? 'Salir de pantalla completa (Esc)' : 'Pantalla completa'}
            >
              <IsoPreviewFsIcon expanded={previewExpanded} />
            </button>
          </div>
        )}
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: '12px 14px 14px',
          borderTop: '1px solid #334155',
          background: '#0f172a'
        }}
      >
        <label
          htmlFor="iso-folder-name"
          style={{ display: 'block', fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 6 }}
        >
          Nombre de la carpeta (subcarpeta en tu carpeta de grabación)
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'stretch', marginBottom: 10 }}>
          <input
            id="iso-folder-name"
            type="text"
            aria-label="Nombre de la carpeta"
            value={isoFolderNameDraft}
            onChange={(e) => onFolderDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void onConfirmSave()
              }
            }}
            placeholder="nombre de carpeta"
            style={{
              flex: '1 1 200px',
              minWidth: 0,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid #475569',
              background: '#020617',
              color: '#f1f5f9',
              fontSize: 14,
              boxSizing: 'border-box'
            }}
          />
          <button
            type="button"
            onClick={() => void onConfirmSave()}
            style={{
              flex: '0 0 auto',
              padding: '10px 20px',
              borderRadius: 8,
              border: '1px solid #22c55e',
              background: '#16a34a',
              color: '#fff',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: 14
            }}
          >
            Guardar en disco
          </button>
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5, marginBottom: 6 }}>
          <strong style={{ color: '#cbd5e1' }}>{active?.label ?? '—'}</strong>
          {' · '}
          Los archivos <strong style={{ color: '#cbd5e1' }}>no están en disco</strong> hasta guardar. Las cámaras son solo
          vídeo; el audio de PC va aparte.
        </div>
        <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.45, wordBreak: 'break-all' }}>
          Carpeta base: {outputDir ?? '—'}
        </div>
      </div>
      </div>
    </div>
  )
}
