import { useCallback, useEffect, useRef, type RefObject } from 'react'

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
  stageRef: RefObject<HTMLDivElement | null>
  stageFullscreen: boolean
  onToggleStageFullscreen: () => void
  resolveAlias: AliasResolver
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
  stageRef,
  stageFullscreen,
  onToggleStageFullscreen,
  resolveAlias
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const pcAudioSyncRef = useRef<HTMLAudioElement | null>(null)
  const lastNudgeMsRef = useRef(0)

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
        flexDirection: 'column',
        background: '#020617',
        overflow: 'hidden'
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
        <div id="iso-save-title" style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>
          Grabación terminada
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
        <button
          type="button"
          onClick={() => onToggleStageFullscreen()}
          style={{ ...btnNeutral, fontWeight: 600, fontSize: 12 }}
        >
          {stageFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
        </button>
        <span style={{ flex: '1 1 40px' }} />
        <button type="button" onClick={() => onDiscard()} style={{ ...btnNeutral, fontWeight: 600, fontSize: 12 }}>
          Descartar
        </button>
      </div>

      <div
        ref={stageRef}
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#000',
          padding: 12,
          gap: 8,
          position: 'relative'
        }}
      >
        {!active?.url ? (
          <span style={{ color: '#64748b', fontSize: 13 }}>Preparando vista previa…</span>
        ) : active.isAudio ? (
          <audio
            key={active.item.recKey}
            controls
            preload="metadata"
            src={active.url}
            style={{ width: 'min(720px, 100%)', minHeight: 48 }}
          />
        ) : (
          <>
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
              controls
              playsInline
              muted={false}
              preload="metadata"
              src={active.url}
              onPlay={showLinkedPcAudio ? onVideoPlay : undefined}
              onPause={showLinkedPcAudio ? onVideoPause : undefined}
              onSeeking={showLinkedPcAudio ? onVideoSeeking : undefined}
              onSeeked={showLinkedPcAudio ? onVideoSeeked : undefined}
              onRateChange={showLinkedPcAudio ? onVideoRateChange : undefined}
              onTimeUpdate={showLinkedPcAudio ? onVideoTimeUpdate : undefined}
              style={{
                width: '100%',
                height: '100%',
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                outline: 'none'
              }}
            />
            {active && !active.isAudio && !pcAudioPreviewUrl ? (
              <div style={{ fontSize: 11, color: '#64748b', textAlign: 'center', maxWidth: 520 }}>
                Esta sesión no tiene pista «Audio de PC» (no estaba activo al grabar). Solo se escucha el vídeo.
              </div>
            ) : null}
            {showLinkedPcAudio ? (
              <div style={{ fontSize: 11, color: '#86efac', textAlign: 'center', maxWidth: 560 }}>
                Al usar ▶ del vídeo, el <strong style={{ color: '#bbf7d0' }}>audio de PC</strong> de la misma grabación se
                reproduce en paralelo (mismo tiempo aprox.; puede desfasarse un poco al final).
              </div>
            ) : null}
          </>
        )}
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: '10px 14px 14px',
          borderTop: '1px solid #1e293b',
          background: '#0f172a'
        }}
      >
        <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5, marginBottom: 10 }}>
          <strong style={{ color: '#cbd5e1' }}>{active?.label ?? '—'}</strong>
          {' · '}
          Los archivos <strong style={{ color: '#cbd5e1' }}>no están en disco</strong> hasta «Guardar en disco». Las tomas
          de cámara son <strong style={{ color: '#cbd5e1' }}>solo vídeo</strong>; el audio de la PC va en el archivo{' '}
          <strong style={{ color: '#cbd5e1' }}>Audio de PC</strong>. En la vista previa de una cámara, si hubo audio de PC,
          se mezcla al reproducir el vídeo (arriba).
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8, lineHeight: 1.45 }}>
          Subcarpeta dentro de <span style={{ color: '#cbd5e1', wordBreak: 'break-all' }}>{outputDir ?? '—'}</span>. No
          podés repetir un nombre si ya existe una carpeta igual con <code style={{ color: '#cbd5e1' }}>.webm</code>.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'stretch' }}>
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
              flex: '1 1 220px',
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
              border: '1px solid #15803d',
              background: '#166534',
              color: '#ecfccb',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: 13
            }}
          >
            Guardar en disco
          </button>
        </div>
      </div>
    </div>
  )
}
