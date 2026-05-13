import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useCameraAliases } from './cameraAliases'
import {
  btnAudio,
  btnNeutral,
  btnQr,
  pathLineMuted,
  pathTextBright,
  warnLineNoFolder,
  workspaceActionRowLabel,
  workspaceEyebrow,
  workspaceToolbar
} from './workspaceChrome'

export type LiveMixMode = 'manual' | 'auto'

/** Director por reglas (sin IA): orden fijo o azar ponderado por pesos por cámara. */
export type AutoDirectorStrategy = 'roundRobin' | 'weightedRandom'

function pickWeightedCamera(ids: string[], weights: Record<string, number>): string {
  if (ids.length === 0) return ''
  if (ids.length === 1) return ids[0]!
  let total = 0
  const parts = ids.map((id) => {
    const w = Math.max(1, Math.min(100, Math.round(weights[id] ?? 1)))
    total += w
    return { id, w }
  })
  let r = Math.random() * total
  for (const p of parts) {
    r -= p.w
    if (r <= 0) return p.id
  }
  return parts[parts.length - 1]!.id
}

type LiveFusionPanelProps = {
  cameraIds: string[]
  streams: Record<string, MediaStream | undefined>
  rtcStates: Record<string, string | undefined>
  manualRotateDeg: Record<string, number>
  onRotate90: (cameraId: string) => void
  outputDir: string | null
  audioStream: MediaStream | null
  onStatus: (msg: string) => void
  /** ISO grabando o pendiente de guardar: no grabar programa encima. */
  isoBusy: boolean
  /** Igual que en Sesión en vivo: diálogo para elegir carpeta de grabación. */
  onPickOutputDir: () => void | Promise<void>
  /** Abre el popover con el QR + calidad + troubleshooting. */
  onOpenQr: () => void
  /** Abre el panel flotante de audio de PC (selector, nivel post-ganancia, fader). */
  onOpenAudio: () => void
  /** Indica si ya hay un audio de PC activo (para etiquetar el botón). */
  hasPcAudio: boolean
}

function pickLiveProgramRecorderMime(): string | undefined {
  const candidates = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8',
    'video/webm;codecs=vp9',
    'video/webm'
  ]
  if (typeof MediaRecorder === 'undefined') return undefined
  return candidates.find((c) => MediaRecorder.isTypeSupported(c))
}

const LIVE_CAPTURE_FPS = 30

/** Duración por defecto del fundido entre tomas en el canvas del programa (ms). */
const PROGRAM_CROSSFADE_MS_DEFAULT = 420

type ProgramFade = { from: string; to: string; start: number }

function letterboxDraw(
  ctx: CanvasRenderingContext2D,
  v: HTMLVideoElement,
  cw: number,
  ch: number
): boolean {
  if (v.readyState < 1) return false
  const vw = v.videoWidth
  const vh = v.videoHeight
  if (!vw || !vh) return false
  const scale = Math.min(cw / vw, ch / vh)
  const dw = vw * scale
  const dh = vh * scale
  const ox = (cw - dw) / 2
  const oy = (ch - dh) / 2
  ctx.drawImage(v, ox, oy, dw, dh)
  return true
}

function createLiveProgramRecorder(stream: MediaStream, mimeType: string | undefined): MediaRecorder {
  const hasAudio = stream.getAudioTracks().length > 0
  const opts: MediaRecorderOptions = {
    videoBitsPerSecond: 5_000_000,
    ...(hasAudio ? { audioBitsPerSecond: 160_000 } : {})
  }
  if (mimeType) opts.mimeType = mimeType
  try {
    return new MediaRecorder(stream, opts)
  } catch {
    try {
      return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    } catch {
      return new MediaRecorder(stream)
    }
  }
}

function joinOutputPath(dir: string, fileName: string): string {
  const d = dir.replace(/[/\\]+$/, '')
  return d.includes('\\') ? `${d}\\${fileName}` : `${d}/${fileName}`
}

function sanitizeLiveFileName(raw: string, fallback: string): string {
  let s = raw.trim()
  const norm = s.replace(/\\/g, '/')
  const slash = norm.lastIndexOf('/')
  if (slash >= 0) s = norm.slice(slash + 1)
  if (!s) return fallback
  s = s.replace(/[\x00-\x1f<>:"|?*]/g, '_')
  const lower = s.toLowerCase()
  if (!lower.endsWith('.webm')) {
    s = s.replace(/\.+$/, '')
    if (!s) return fallback
    s = `${s}.webm`
  }
  return s.length > 200 ? `${s.slice(0, 195)}.webm` : s
}

function sanitizeLiveMp4FileName(raw: string, fallbackMp4: string): string {
  const fallbackWebm = fallbackMp4.replace(/\.mp4$/i, '.webm')
  return sanitizeLiveFileName(raw, fallbackWebm).replace(/\.webm$/i, '.mp4')
}

/**
 * React no siempre asigna bien `srcObject` en <video>: obligatorio enganchar el MediaStream por efecto.
 */
function DecoderVideo({
  cameraId,
  stream,
  rotateDeg,
  onVideoEl
}: {
  cameraId: string
  stream: MediaStream | undefined
  rotateDeg: number
  onVideoEl: (id: string, el: HTMLVideoElement | null) => void
}) {
  const r = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const el = r.current
    if (!el) return
    if (el.srcObject !== stream) {
      el.srcObject = stream ?? null
    }
    if (stream) {
      void el.play().catch(() => {})
    }
  }, [stream])

  return (
    <video
      ref={(el) => {
        r.current = el
        onVideoEl(cameraId, el)
      }}
      autoPlay
      playsInline
      muted
      preload="auto"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 1280,
        height: 720,
        objectFit: 'contain',
        transform: rotateDeg ? `rotate(${rotateDeg}deg)` : undefined,
        transformOrigin: 'center center'
      }}
    />
  )
}

function ThumbVideo({
  stream,
  rotateDeg
}: {
  stream: MediaStream | undefined
  rotateDeg: number
}) {
  const r = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const el = r.current
    if (!el) return
    if (el.srcObject !== stream) {
      el.srcObject = stream ?? null
    }
    if (stream) {
      void el.play().catch(() => {})
    }
  }, [stream])

  return (
    <video
      ref={r}
      autoPlay
      playsInline
      muted
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        display: 'block',
        transform: rotateDeg ? `rotate(${rotateDeg}deg)` : undefined,
        transformOrigin: 'center center',
        pointerEvents: 'none'
      }}
    />
  )
}

/**
 * Fusión en vivo: vistas por cámara (miniaturas), programa en canvas, grabación del programa.
 */
export function LiveFusionPanel({
  cameraIds,
  streams,
  rtcStates,
  manualRotateDeg,
  onRotate90,
  outputDir,
  audioStream,
  onStatus,
  isoBusy,
  onPickOutputDir,
  onOpenQr,
  onOpenAudio,
  hasPcAudio
}: LiveFusionPanelProps) {
  const cameraAliases = useCameraAliases()
  const [mixMode, setMixMode] = useState<LiveMixMode>('manual')
  const [programCameraId, setProgramCameraId] = useState<string | null>(null)
  const [programRecording, setProgramRecording] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [programBlob, setProgramBlob] = useState<Blob | null>(null)
  const [exportFileName, setExportFileName] = useState('')
  const [programPreviewUrl, setProgramPreviewUrl] = useState<string | null>(null)
  const [programElapsedLabel, setProgramElapsedLabel] = useState('00:00')

  const [autoOptionsExpanded, setAutoOptionsExpanded] = useState(true)
  const [autoStrategy, setAutoStrategy] = useState<AutoDirectorStrategy>('roundRobin')
  const [autoShotDurationSec, setAutoShotDurationSec] = useState(6)
  const [autoAvoidConsecutive, setAutoAvoidConsecutive] = useState(true)
  const [autoWeights, setAutoWeights] = useState<Record<string, number>>({})
  /** 0 = corte seco; manual y automático. */
  const [programCrossfadeMs, setProgramCrossfadeMs] = useState(PROGRAM_CROSSFADE_MS_DEFAULT)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())
  const playingRef = useRef(true)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const programRecordingStartedAtRef = useRef<number | null>(null)
  const cameraIdsRef = useRef<string[]>([])
  const autoWeightsRef = useRef<Record<string, number>>({})
  const programCameraIdRef = useRef<string | null>(null)
  const crossfadeMsRef = useRef(programCrossfadeMs)
  const settledProgramIdRef = useRef<string | null>(null)
  const programFadeRef = useRef<ProgramFade | null>(null)

  programCameraIdRef.current = programCameraId
  crossfadeMsRef.current = programCrossfadeMs

  const setVideoRef = useCallback((id: string, el: HTMLVideoElement | null) => {
    if (el) videoRefs.current.set(id, el)
    else videoRefs.current.delete(id)
  }, [])

  useEffect(() => {
    if (!cameraIds.length) {
      setProgramCameraId(null)
      return
    }
    setProgramCameraId((prev) => {
      if (prev && cameraIds.includes(prev)) return prev
      return cameraIds[0] ?? null
    })
  }, [cameraIds])

  useEffect(() => {
    cameraIdsRef.current = cameraIds
  }, [cameraIds])

  useEffect(() => {
    autoWeightsRef.current = autoWeights
  }, [autoWeights])

  /** Pesos por defecto 1 cuando entra una cámara nueva. */
  useEffect(() => {
    setAutoWeights((prev) => {
      const next = { ...prev }
      for (const id of cameraIds) {
        if (next[id] == null || next[id] < 1) next[id] = 1
      }
      for (const k of Object.keys(next)) {
        if (!cameraIds.includes(k)) delete next[k]
      }
      return next
    })
  }, [cameraIds])

  /** Encadena fundidos al cambiar `programCameraId`; si hay un fundido activo, sale desde su toma destino. */
  useLayoutEffect(() => {
    if (!programCameraId) {
      settledProgramIdRef.current = null
      programFadeRef.current = null
      return
    }

    if (crossfadeMsRef.current <= 0) {
      settledProgramIdRef.current = programCameraId
      programFadeRef.current = null
      return
    }

    const mid = programFadeRef.current
    const sourceFrom =
      mid && mid.to !== programCameraId ? mid.to : settledProgramIdRef.current

    if (sourceFrom === programCameraId) {
      if (!mid) settledProgramIdRef.current = programCameraId
      return
    }

    if (sourceFrom == null) {
      settledProgramIdRef.current = programCameraId
      programFadeRef.current = null
      return
    }

    const vFrom = videoRefs.current.get(sourceFrom)
    const vTo = videoRefs.current.get(programCameraId)
    if (!vFrom || !vTo) {
      settledProgramIdRef.current = programCameraId
      programFadeRef.current = null
      return
    }

    programFadeRef.current = { from: sourceFrom, to: programCameraId, start: performance.now() }
  }, [programCameraId, programCrossfadeMs])

  useEffect(() => {
    if (!programBlob) {
      setProgramPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(programBlob)
    setProgramPreviewUrl(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [programBlob])

  useEffect(() => {
    if (!programRecording) {
      setProgramElapsedLabel('00:00')
      return
    }
    const started = programRecordingStartedAtRef.current ?? Date.now()
    programRecordingStartedAtRef.current = started

    const fmt = (elapsedMs: number) => {
      const s = Math.floor(elapsedMs / 1000)
      const h = Math.floor(s / 3600)
      const m = Math.floor((s % 3600) / 60)
      const sec = s % 60
      if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
      }
      return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    }

    const tick = () => setProgramElapsedLabel(fmt(Date.now() - started))
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [programRecording])

  /** Cambia la toma del programa en modo automático según reglas configuradas. */
  useEffect(() => {
    if (mixMode !== 'auto') return
    const curIds = cameraIdsRef.current
    if (curIds.length === 0) return

    const durationMs = Math.max(2000, Math.min(120000, autoShotDurationSec * 1000))

    const step = () => {
      setProgramCameraId((prev) => {
        const ids = cameraIdsRef.current
        if (ids.length === 0) return prev
        if (ids.length === 1) return ids[0]!

        if (autoStrategy === 'roundRobin') {
          const idx = Math.max(0, ids.indexOf(prev ?? ids[0]!))
          const nextIdx = (idx + 1) % ids.length
          return ids[nextIdx]!
        }

        const wmap = autoWeightsRef.current
        let next = pickWeightedCamera(ids, wmap)
        if (autoAvoidConsecutive && ids.length > 1 && prev) {
          let tries = 0
          while (next === prev && tries < 20) {
            next = pickWeightedCamera(ids, wmap)
            tries++
          }
        }
        return next
      })
    }

    const id = window.setInterval(step, durationMs)
    return () => window.clearInterval(id)
  }, [mixMode, autoShotDurationSec, autoStrategy, autoAvoidConsecutive])

  useEffect(() => {
    if ((mixMode !== 'manual' && mixMode !== 'auto') || !programCameraId) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let cancelled = false
    let rafId = 0
    let vfcHandle = 0
    let vfcVideo: HTMLVideoElement | null = null

    const cancelVfc = () => {
      if (vfcVideo != null && vfcHandle && typeof vfcVideo.cancelVideoFrameCallback === 'function') {
        try {
          vfcVideo.cancelVideoFrameCallback(vfcHandle)
        } catch {
          /* vacío */
        }
      }
      vfcHandle = 0
      vfcVideo = null
    }

    const drawOnce = () => {
      const cw = canvas.width
      const ch = canvas.height
      ctx.fillStyle = '#020617'
      ctx.fillRect(0, 0, cw, ch)

      const pid = programCameraIdRef.current
      if (!pid) return

      const streamFor = (id: string) => streams[id]
      const fade = programFadeRef.current
      const ms = crossfadeMsRef.current

      const drawSingle = (cameraId: string) => {
        const stream = streamFor(cameraId)
        const v = videoRefs.current.get(cameraId)
        if (!v || !stream) return
        try {
          letterboxDraw(ctx, v, cw, ch)
        } catch {
          /* frame no listo */
        }
      }

      if (!fade || ms <= 0) {
        drawSingle(pid)
        return
      }

      const elapsed = performance.now() - fade.start
      if (elapsed >= ms) {
        programFadeRef.current = null
        settledProgramIdRef.current = fade.to
        drawSingle(fade.to)
        return
      }

      const vFrom = videoRefs.current.get(fade.from)
      const vTo = videoRefs.current.get(fade.to)
      const sFrom = streamFor(fade.from)
      const sTo = streamFor(fade.to)
      if (!vFrom || !vTo || !sFrom || !sTo) {
        programFadeRef.current = null
        settledProgramIdRef.current = fade.to
        drawSingle(fade.to)
        return
      }

      const tLin = Math.min(1, elapsed / ms)
      const t = tLin * tLin * (3 - 2 * tLin)

      try {
        ctx.globalAlpha = 1 - t
        letterboxDraw(ctx, vFrom, cw, ch)
        ctx.globalAlpha = t
        letterboxDraw(ctx, vTo, cw, ch)
        ctx.globalAlpha = 1
      } catch {
        programFadeRef.current = null
        settledProgramIdRef.current = fade.to
        drawSingle(fade.to)
      }
    }

    const scheduleNext = () => {
      if (cancelled) return

      const fade = programFadeRef.current
      const ms = crossfadeMsRef.current
      const now = performance.now()
      const fading =
        fade != null &&
        ms > 0 &&
        now - fade.start < ms + 32

      cancelVfc()

      if (fading) {
        rafId = requestAnimationFrame(() => {
          if (cancelled) return
          drawOnce()
          scheduleNext()
        })
        return
      }

      const activeId = programCameraIdRef.current
      const v = activeId ? videoRefs.current.get(activeId) : undefined
      const useVfc =
        playingRef.current && v != null && typeof v.requestVideoFrameCallback === 'function'

      if (useVfc && v) {
        vfcVideo = v
        vfcHandle = v.requestVideoFrameCallback(() => {
          vfcHandle = 0
          vfcVideo = null
          if (cancelled) return
          drawOnce()
          scheduleNext()
        })
      } else {
        rafId = requestAnimationFrame(() => {
          if (cancelled) return
          drawOnce()
          scheduleNext()
        })
      }
    }

    scheduleNext()

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      cancelVfc()
    }
  }, [mixMode, programCameraId, streams])

  const pickProgram = useCallback((id: string) => {
    setProgramCameraId(id)
  }, [])

  const startProgramRecording = useCallback(() => {
    if (isoBusy) {
      onStatus('No podés grabar el programa mientras hay una grabación por pistas pendiente o en curso.')
      return
    }
    if (!outputDir) {
      onStatus('Tocá «Carpeta de grabación» arriba en esta sección antes de grabar el programa.')
      return
    }
    if (!canvasRef.current || (mixMode !== 'manual' && mixMode !== 'auto')) return
    setProgramBlob(null)
    const mime = pickLiveProgramRecorderMime()
    const vStream = canvasRef.current.captureStream(LIVE_CAPTURE_FPS)
    const vidTrack = vStream.getVideoTracks()[0]
    const tracks: MediaStreamTrack[] = [vidTrack]
    const aTrack = audioStream?.getAudioTracks()[0]
    if (aTrack) tracks.push(aTrack)
    const outStream = new MediaStream(tracks)
    const parts: BlobPart[] = []
    chunksRef.current = parts
    const rec = createLiveProgramRecorder(outStream, mime)
    rec.ondataavailable = (e) => {
      if (e.data.size) parts.push(e.data)
    }
    recRef.current = rec
    programRecordingStartedAtRef.current = Date.now()
    rec.start()
    setProgramRecording(true)
    setExportFileName(`live-program-${Date.now()}.webm`)
    onStatus(
      mixMode === 'auto'
        ? 'Grabando programa en modo automático (director por reglas).'
        : 'Grabando salida del programa (canvas). Cambiá de toma con las miniaturas.'
    )
  }, [audioStream, isoBusy, mixMode, onStatus, outputDir])

  const stopProgramRecording = useCallback(async () => {
    const rec = recRef.current
    if (!rec) return
    const mimeType = rec.mimeType
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve()
      try {
        rec.stop()
      } catch {
        resolve()
      }
    })
    recRef.current = null
    programRecordingStartedAtRef.current = null
    setProgramRecording(false)
    const parts = chunksRef.current
    chunksRef.current = []
    const blob = new Blob(parts, { type: mimeType || 'video/webm' })
    parts.length = 0
    setProgramBlob(blob)
    onStatus('Grabación del programa lista. Guardá el WebM en la carpeta o reproducí la vista previa.')
  }, [onStatus])

  const saveProgramBlob = useCallback(async () => {
    if (!programBlob || !outputDir) {
      onStatus('No hay archivo para guardar o falta carpeta de grabación.')
      return
    }
    const fallback = `live-program-${Date.now()}.webm`
    const name = sanitizeLiveFileName(exportFileName, fallback)
    const filePath = joinOutputPath(outputDir, name)
    setExportBusy(true)
    try {
      const buf = await programBlob.arrayBuffer()
      await window.studio.saveVideo(filePath, buf)
      setProgramBlob(null)
      onStatus(`Programa guardado: ${name}`)
    } catch (e) {
      onStatus(`Error al guardar: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setExportBusy(false)
    }
  }, [exportFileName, onStatus, outputDir, programBlob])

  const saveProgramBlobAsMp4 = useCallback(async () => {
    if (!programBlob || !outputDir) {
      onStatus('No hay archivo para guardar o falta carpeta de grabación.')
      return
    }
    const fallbackMp4 = `live-program-${Date.now()}.mp4`
    const name = sanitizeLiveMp4FileName(exportFileName, fallbackMp4)
    const filePath = joinOutputPath(outputDir, name)
    setExportBusy(true)
    onStatus('Generando MP4 con FFmpeg (puede tardar según la duración)...')
    try {
      const buf = await programBlob.arrayBuffer()
      const r = await window.studio.saveFusionMp4(filePath, buf)
      if (!r.ok) {
        onStatus(`No se pudo exportar MP4: ${r.message}`)
        return
      }
      setProgramBlob(null)
      onStatus(`Programa guardado (MP4): ${name}`)
    } catch (e) {
      onStatus(`Error al exportar MP4: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setExportBusy(false)
    }
  }, [exportFileName, onStatus, outputDir, programBlob])

  const discardProgramBlob = useCallback(() => {
    setProgramBlob(null)
    onStatus('Vista previa del programa descartada.')
  }, [onStatus])

  /**
   * Cancela el flujo del programa: si hay grabación en curso, descarta lo grabado sin generar vista previa;
   * si hay una vista previa pendiente, la descarta. Pide confirmación.
   * No borra archivos del disco ya guardados.
   */
  const cancelProgramFlow = useCallback(() => {
    if (exportBusy) {
      onStatus('Esperá a que termine la exportación antes de cancelar.')
      return
    }
    if (!programRecording && !programBlob) return

    const msg = programRecording
      ? '¿Cancelar la grabación del programa?\n\nSe va a descartar lo grabado en esta toma (no se genera vista previa ni se guarda nada en disco).'
      : '¿Descartar la vista previa del programa?\n\nNo se va a guardar el WebM ni el MP4.'
    const ok = window.confirm(msg)
    if (!ok) return

    const rec = recRef.current
    if (rec && rec.state !== 'inactive') {
      try {
        rec.ondataavailable = null
        rec.onstop = null
      } catch {
        /* vacío */
      }
      try {
        rec.stop()
      } catch {
        /* vacío */
      }
    }
    recRef.current = null
    chunksRef.current = []
    programRecordingStartedAtRef.current = null
    setProgramRecording(false)
    setProgramBlob(null)
    setExportFileName('')
    onStatus('Grabación del programa cancelada (no se guardó nada).')
  }, [exportBusy, onStatus, programBlob, programRecording])

  const disabledProgramRec = isoBusy || !cameraIds.length

  return (
    <div style={workspaceToolbar('teal')}>
      <div style={workspaceEyebrow}>Alternativa · Fusión en vivo (graba ya mezclado, sin pistas separadas)</div>
      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.55, maxWidth: 880 }}>
        <strong style={{ color: '#e2e8f0' }}>Importante:</strong> cada pestaña genera <strong style={{ color: '#e2e8f0' }}>su propio QR</strong>.
        Para que las cámaras aparezcan acá, escaneá el QR de <em>esta</em> pestaña (Fusión en vivo) en cada celular. El QR de
        «Sesión en vivo» no sirve para mezclar — los celulares quedan en la otra pestaña. Las miniaturas de la derecha son
        cada transmisión; tocá una para mandarla al <strong style={{ color: '#e2e8f0' }}>Programa</strong> (centro).
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <span style={workspaceActionRowLabel}>Carpeta y conexión</span>
        <button
          type="button"
          disabled={programRecording}
          onClick={() => void onPickOutputDir()}
          style={{
            ...btnNeutral,
            fontWeight: 600,
            cursor: programRecording ? 'not-allowed' : 'pointer',
            opacity: programRecording ? 0.55 : 1
          }}
        >
          Carpeta de grabación
        </button>
        <button type="button" onClick={onOpenQr} style={btnQr} title="Abre un popover con el QR (mismo Wi-Fi).">
          <span aria-hidden style={{ fontSize: 14 }}>▦</span> QR de cámaras (Fusión en vivo)
        </button>
        <button
          type="button"
          onClick={onOpenAudio}
          style={btnAudio}
          title="Abre el panel flotante de audio: mic, nivel, ganancia y CLIP."
        >
          <span aria-hidden style={{ fontSize: 14 }}>♪</span>
          {hasPcAudio ? ' Audio de PC · activo' : ' Audio de PC'}
        </button>
      </div>
      {outputDir ? (
        <div style={pathLineMuted}>
          Carpeta: <span style={pathTextBright}>{outputDir}</span>
        </div>
      ) : (
        <div style={warnLineNoFolder}>
          <strong style={{ color: '#fef3c7' }}>Sin carpeta elegida.</strong> Elegí dónde guardar el WebM del programa al
          grabar la mezcla (misma carpeta base que en Sesión en vivo).
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <span style={workspaceActionRowLabel}>Mezcla</span>
        <button
          type="button"
          onClick={() => setMixMode('manual')}
          disabled={programRecording}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: mixMode === 'manual' ? '2px solid #2dd4bf' : '1px solid #334155',
            background: mixMode === 'manual' ? '#134e4a' : '#0f172a',
            color: '#e2e8f0',
            fontWeight: 600,
            cursor: programRecording ? 'not-allowed' : 'pointer',
            opacity: programRecording ? 0.6 : 1
          }}
        >
          Manual
        </button>
        <button
          type="button"
          onClick={() => setMixMode('auto')}
          disabled={programRecording}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: mixMode === 'auto' ? '2px solid #a78bfa' : '1px solid #334155',
            background: mixMode === 'auto' ? '#4c1d95' : '#0f172a',
            color: '#e2e8f0',
            fontWeight: 600,
            cursor: programRecording ? 'not-allowed' : 'pointer',
            opacity: programRecording ? 0.6 : 1
          }}
        >
          Automático
        </button>
      </div>

      <div className="fusion-workspace">
          <div className="fusion-main-flow">
            {mixMode === 'auto' ? (
              <div
                style={{
                  marginBottom: 12,
                  borderRadius: 10,
                  border: '1px solid #4c1d95',
                  overflow: 'hidden'
                }}
              >
                <button
                  type="button"
                  onClick={() => setAutoOptionsExpanded((v) => !v)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 14px',
                    border: 'none',
                    background: '#1e1b4b',
                    color: '#e9d5ff',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8
                  }}
                >
                  <span>Opciones del director automático</span>
                  <span aria-hidden style={{ fontSize: 12, opacity: 0.85 }}>
                    {autoOptionsExpanded ? 'Ocultar ▲' : 'Mostrar ▼'}
                  </span>
                </button>
                {autoOptionsExpanded ? (
                  <div
                    style={{
                      padding: '14px 16px',
                      background: '#0f172a',
                      borderTop: '1px solid #334155',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 14
                    }}
                  >
                    <label style={{ fontSize: 11, color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      Estrategia
                      <select
                        value={autoStrategy}
                        onChange={(e) => setAutoStrategy(e.target.value as AutoDirectorStrategy)}
                        disabled={programRecording}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: '1px solid #475569',
                          background: '#020617',
                          color: '#e2e8f0',
                          fontSize: 13,
                          maxWidth: 420
                        }}
                      >
                        <option value="roundRobin">Rotación fija (cam1 → cam2 → … y se repite)</option>
                        <option value="weightedRandom">Azar ponderado (pesos por cámara)</option>
                      </select>
                    </label>
                    <label style={{ fontSize: 11, color: '#94a3b8', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                      Tiempo por toma (segundos)
                      <input
                        type="number"
                        min={2}
                        max={120}
                        value={autoShotDurationSec}
                        onChange={(e) =>
                          setAutoShotDurationSec(Math.max(2, Math.min(120, Number(e.target.value) || 6)))
                        }
                        disabled={programRecording}
                        style={{
                          width: 80,
                          padding: '6px 8px',
                          borderRadius: 8,
                          border: '1px solid #475569',
                          background: '#020617',
                          color: '#e2e8f0',
                          fontSize: 13
                        }}
                      />
                      <span style={{ color: '#64748b', fontSize: 11 }}>
                        Entre 2 y 120 s. Cambiar tiempo reinicia el ritmo del intervalo.
                      </span>
                    </label>
                    {autoStrategy === 'weightedRandom' ? (
                      <label style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={autoAvoidConsecutive}
                          onChange={(e) => setAutoAvoidConsecutive(e.target.checked)}
                          disabled={programRecording}
                          style={{ marginTop: 2 }}
                        />
                        <span>Evitar dos tomas seguidas de la misma cámara (si hay más de una fuente)</span>
                      </label>
                    ) : null}
                    {autoStrategy === 'weightedRandom' && cameraIds.length > 0 ? (
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>
                        <div style={{ marginBottom: 8, fontWeight: 600, color: '#cbd5e1' }}>
                          Peso por cámara (1–100; más alto = más probabilidad al cortar)
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {cameraIds.map((cid) => (
                            <label key={cid} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                              <span style={{ minWidth: 72, color: '#64748b', wordBreak: 'break-word' }}>{cameraAliases.resolve(cid)}</span>
                              <input
                                type="number"
                                min={1}
                                max={100}
                                value={autoWeights[cid] ?? 1}
                                onChange={(e) =>
                                  setAutoWeights((w) => ({
                                    ...w,
                                    [cid]: Math.max(1, Math.min(100, Math.round(Number(e.target.value) || 1)))
                                  }))
                                }
                                disabled={programRecording}
                                style={{
                                  width: 72,
                                  padding: '4px 8px',
                                  borderRadius: 6,
                                  border: '1px solid #475569',
                                  background: '#020617',
                                  color: '#e2e8f0',
                                  fontSize: 12
                                }}
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                alignItems: 'center',
                paddingBottom: 10,
                borderBottom: '1px solid #1e293b'
              }}
            >
              <button
                type="button"
                disabled={disabledProgramRec || programRecording}
                onClick={() => void startProgramRecording()}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: '1px solid transparent',
                  background: disabledProgramRec || programRecording ? '#334155' : '#7c3aed',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: disabledProgramRec || programRecording ? 'not-allowed' : 'pointer'
                }}
              >
                Grabar programa
              </button>
              <button
                type="button"
                disabled={!programRecording}
                onClick={() => void stopProgramRecording()}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: '1px solid #991b1b',
                  background: programRecording ? '#b91c1c' : '#334155',
                  color: '#fef2f2',
                  fontWeight: 600,
                  cursor: programRecording ? 'pointer' : 'not-allowed'
                }}
              >
                Finalizar grabación
              </button>
              <button
                type="button"
                disabled={(!programRecording && !programBlob) || exportBusy}
                onClick={() => cancelProgramFlow()}
                title={
                  programRecording
                    ? 'Descarta la toma actual sin guardar (no genera vista previa).'
                    : programBlob
                      ? 'Descarta la vista previa pendiente sin guardarla.'
                      : 'No hay grabación ni vista previa para cancelar.'
                }
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: '1px solid #475569',
                  background: '#1f2937',
                  color: '#e2e8f0',
                  fontWeight: 600,
                  cursor:
                    (!programRecording && !programBlob) || exportBusy ? 'not-allowed' : 'pointer',
                  opacity: (!programRecording && !programBlob) || exportBusy ? 0.45 : 1
                }}
              >
                Cancelar
              </button>
              {programRecording ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'baseline',
                    gap: 10,
                    flexShrink: 0
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#e9d5ff' }}>● PROGRAMA</span>
                  <span
                    title="Tiempo de esta grabación del programa"
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                      fontFamily: 'ui-monospace, monospace',
                      color: '#99f6e4',
                      letterSpacing: 0.04
                    }}
                  >
                    {programElapsedLabel}
                  </span>
                </span>
              ) : null}
            </div>

            <div style={{ textAlign: 'center', margin: '6px auto 4px', maxWidth: 560 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>Programa (salida)</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, lineHeight: 1.45 }}>
                {mixMode === 'manual' ? (
                  <>Vista que iría “al aire”. Elegí la escena con las fuentes a la derecha.</>
                ) : (
                  <>
                    Director automático:{' '}
                    <strong style={{ color: '#e9d5ff' }}>
                      {autoStrategy === 'roundRobin' ? 'rotación fija' : 'azar ponderado'}
                    </strong>{' '}
                    · una toma cada{' '}
                    <strong style={{ color: '#e9d5ff' }}>{autoShotDurationSec}s</strong>.
                  </>
                )}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                marginTop: 8,
                marginBottom: 4,
                flexWrap: 'wrap'
              }}
            >
              <label
                style={{
                  fontSize: 11,
                  color: '#94a3b8',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer'
                }}
              >
                Fundido entre tomas
                <input
                  type="range"
                  min={0}
                  max={1500}
                  step={30}
                  value={programCrossfadeMs}
                  onChange={(e) => setProgramCrossfadeMs(Number(e.target.value))}
                  aria-valuetext={
                    programCrossfadeMs === 0 ? 'corte seco' : `${programCrossfadeMs} milisegundos`
                  }
                  style={{ width: 140, verticalAlign: 'middle' }}
                />
                <span
                  style={{
                    minWidth: 72,
                    color: '#cbd5e1',
                    fontVariantNumeric: 'tabular-nums'
                  }}
                >
                  {programCrossfadeMs === 0 ? 'corte' : `${programCrossfadeMs} ms`}
                </span>
              </label>
            </div>

            <div className="fusion-preview-box">
              <div className="fusion-preview-inner">
                <canvas ref={canvasRef} width={1280} height={720} />
              </div>
            </div>

            <div className="fusion-video-decoders" aria-hidden>
              {cameraIds.map((id) => (
                <DecoderVideo
                  key={id}
                  cameraId={id}
                  stream={streams[id]}
                  rotateDeg={manualRotateDeg[id] ?? 0}
                  onVideoEl={setVideoRef}
                />
              ))}
            </div>

            {programBlob ? (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid #334155',
                  background: '#0c121c'
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginBottom: 8 }}>
                  Última grabación del programa
                </div>
                <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
                  Nombre del archivo (misma base para WebM y MP4)
                </label>
                <input
                  type="text"
                  value={exportFileName}
                  onChange={(e) => setExportFileName(e.target.value)}
                  spellCheck={false}
                  disabled={exportBusy}
                  style={{
                    width: '100%',
                    maxWidth: 400,
                    marginBottom: 10,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid #475569',
                    background: '#020617',
                    color: '#e2e8f0',
                    fontSize: 13
                  }}
                />
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10, lineHeight: 1.4 }}>
                  MP4 H.264/AAC con FFmpeg: mejor compatibilidad en el Reproductor de Windows; puede tardar según la duración.
                </div>
                {programPreviewUrl ? (
                  <video
                    src={programPreviewUrl}
                    controls
                    style={{
                      width: '100%',
                      maxHeight: 240,
                      borderRadius: 8,
                      background: '#000'
                    }}
                  />
                ) : null}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    disabled={!outputDir || exportBusy}
                    onClick={() => void saveProgramBlob()}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: '1px solid #047857',
                      background: !outputDir || exportBusy ? '#334155' : '#065f46',
                      color: '#ecfdf5',
                      fontWeight: 600,
                      opacity: exportBusy ? 0.85 : 1
                    }}
                  >
                    Guardar WebM en carpeta
                  </button>
                  <button
                    type="button"
                    disabled={!outputDir || exportBusy}
                    onClick={() => void saveProgramBlobAsMp4()}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: '1px solid #1d4ed8',
                      background: !outputDir || exportBusy ? '#334155' : '#1e40af',
                      color: '#eff6ff',
                      fontWeight: 600,
                      opacity: exportBusy ? 0.85 : 1
                    }}
                  >
                    Guardar MP4 (recomendado Windows)
                  </button>
                  <button
                    type="button"
                    disabled={exportBusy}
                    onClick={discardProgramBlob}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: '1px solid #475569',
                      background: '#1e293b',
                      color: '#e2e8f0',
                      fontWeight: 600
                    }}
                  >
                    Descartar
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <aside className="fusion-sidebar">
            <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', letterSpacing: 0.04, marginBottom: 8 }}>
              {mixMode === 'manual' ? 'Fuentes (tocá = al programa)' : 'Fuentes (vista previa · elige el director)'}
            </div>
            <div className="fusion-thumb-strip">
              {cameraIds.map((id) => (
                <div
                  key={id}
                  style={{
                    width: '100%',
                    maxWidth: 200,
                    flexShrink: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6
                  }}
                >
                  <button
                    type="button"
                    disabled={mixMode === 'auto'}
                    onClick={() => pickProgram(id)}
                    title={
                      mixMode === 'manual'
                        ? `Programa: ${cameraAliases.resolve(id)}`
                        : 'En automático la toma la elige el director; pasá a Manual para elegir vos.'
                    }
                    style={{
                      padding: 6,
                      borderRadius: 10,
                      border:
                        programCameraId === id
                          ? mixMode === 'manual'
                            ? '3px solid #2dd4bf'
                            : '3px solid #a78bfa'
                          : '1px solid #334155',
                      background:
                        programCameraId === id
                          ? mixMode === 'manual'
                            ? '#0f2438'
                            : '#3b0764'
                          : '#0c121c',
                      cursor: mixMode === 'manual' ? 'pointer' : 'not-allowed',
                      width: '100%',
                      boxSizing: 'border-box',
                      opacity: mixMode === 'auto' ? 0.93 : 1
                    }}
                  >
                    <div
                      style={{
                        width: '100%',
                        aspectRatio: '16 / 9',
                        borderRadius: 6,
                        overflow: 'hidden',
                        background: '#020617'
                      }}
                    >
                      <ThumbVideo stream={streams[id]} rotateDeg={manualRotateDeg[id] ?? 0} />
                    </div>
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 10,
                        fontWeight: programCameraId === id ? 700 : 500,
                        color: programCameraId === id ? '#99f6e4' : '#94a3b8',
                        textAlign: 'center',
                        wordBreak: 'break-word'
                      }}
                      title={cameraAliases.aliases[id] ? `ID interno: ${id}` : undefined}
                    >
                      {cameraAliases.resolve(id)}
                    </div>
                    <div style={{ fontSize: 9, color: '#64748b', textAlign: 'center' }}>
                      {rtcStates[id] ?? '—'}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRotate90(id)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 6,
                      border: '1px solid #334155',
                      background: '#1e293b',
                      color: '#e2e8f0',
                      fontSize: 10,
                      cursor: 'pointer'
                    }}
                  >
                    ↻ Rotar
                  </button>
                </div>
              ))}
            </div>
          </aside>
        </div>

      {!cameraIds.length ? (
        <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
          <strong style={{ color: '#fca5a5' }}>No hay video:</strong> escaneá el <strong style={{ color: '#e2e8f0' }}>QR
          de Fusión en vivo</strong> (botón arriba) con cada celular y tocá <strong style={{ color: '#e2e8f0' }}>Transmitir</strong>.
          Recordá que el QR de «Sesión en vivo» no sirve acá — cada pestaña usa el suyo.
        </div>
      ) : null}
    </div>
  )
}
