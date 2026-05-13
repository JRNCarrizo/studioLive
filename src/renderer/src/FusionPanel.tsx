import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  btnNeutral,
  pathLineMuted,
  pathTextBright,
  warnLineNoFolder,
  workspaceEyebrow,
  workspaceInnerCard
} from './workspaceChrome'

import {
  isFusionExportFileName,
  parseRecordingFileName,
  type ParsedRecordingName
} from './recordingFileNames'

type VideoClip = {
  cameraId: string
  absPath: string
  fileUrl: string
}

function basenameFromPath(p: string): string {
  const norm = p.replace(/\\/g, '/')
  const i = norm.lastIndexOf('/')
  return i >= 0 ? norm.slice(i + 1) : norm
}

function joinOutputPath(dir: string, fileName: string): string {
  const d = dir.replace(/[/\\]+$/, '')
  return d.includes('\\') ? `${d}\\${fileName}` : `${d}/${fileName}`
}

/** Nombre de archivo para guardar la fusión; evita rutas y caracteres peligrosos en Windows. */
function sanitizeFusionSaveFileName(raw: string, fallback: string): string {
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
  if (s.toLowerCase() === '.webm') return fallback
  return s.length > 200 ? `${s.slice(0, 195)}.webm` : s
}

function sanitizeFusionMp4FileName(raw: string, fallbackMp4: string): string {
  const fallbackWebm = fallbackMp4.replace(/\.mp4$/i, '.webm')
  return sanitizeFusionSaveFileName(raw, fallbackWebm).replace(/\.webm$/i, '.mp4')
}

/** Colores bien separados en el espectro; el índice corresponde al orden estable de cámaras en la sesión. */
const FUSION_CAMERA_PALETTE = [
  'hsl(204 72% 46%)',
  'hsl(36 88% 48%)',
  'hsl(142 58% 40%)',
  'hsl(278 58% 54%)',
  'hsl(168 55% 42%)',
  'hsl(12 78% 52%)',
  'hsl(48 85% 46%)',
  'hsl(310 62% 52%)'
] as const

function fusionCameraColorMap(cameraIds: Iterable<string>): Map<string, string> {
  const sorted = [...new Set(cameraIds)].sort((a, b) => a.localeCompare(b))
  const map = new Map<string, string>()
  sorted.forEach((id, i) => {
    map.set(id, FUSION_CAMERA_PALETTE[i % FUSION_CAMERA_PALETTE.length]!)
  })
  return map
}

function fusionSegmentColor(map: Map<string, string>, cameraId: string): string {
  const fromPalette = map.get(cameraId)
  if (fromPalette) return fromPalette
  let h = 0
  for (let i = 0; i < cameraId.length; i++) {
    h = (Math.imul(h, 31) + cameraId.charCodeAt(i)) >>> 0
  }
  return `hsl(${h % 360} 58% 42%)`
}

/** Alias por si queda alguna referencia antigua o caché de HMR a `cameraStripColor` (mismo fallback hash). */
function cameraStripColor(cameraId: string): string {
  return fusionSegmentColor(new Map(), cameraId)
}

/** Qué cámara iba al programa en el tiempo `t` según el EDL ya cerrado. */
function cameraAtFusionTime(
  t: number,
  segments: readonly { startSec: number; endSec: number; cameraId: string }[]
): string | null {
  if (!segments.length) return null
  const sorted = [...segments].sort((a, b) => a.startSec - b.startSec)
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!
    const last = i === sorted.length - 1
    if (last) {
      if (t >= s.startSec && t <= s.endSec + 1e-3) return s.cameraId
    } else if (t >= s.startSec && t < s.endSec) {
      return s.cameraId
    }
  }
  return null
}

/**
 * VP8 delante: el Reproductor de Windows y «Películas y TV» suelen manejar mejor WebM+VP8 que VP9
 * (seek, decodificador, tirones con poca GPU).
 */
function pickFusionRecorderMime(): string | undefined {
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

/** Muestreo del canvas hacia MediaRecorder (fps constantes desde el motor del navegador). */
const FUSION_CAPTURE_OUT_FPS = 30

/** Bitrate moderado para 720p: menos carga en el codificador = menos tirones en tiempo real. */
function createFusionMediaRecorder(stream: MediaStream, mimeType: string | undefined): MediaRecorder {
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

type FusionPanelProps = {
  outputDir: string | null
  liveRecording: boolean
  onStatus: (msg: string) => void
  /** Abre el diálogo de carpeta (misma carpeta que el paso 1). Opcional por compatibilidad. */
  onPickOutputDir?: () => void | Promise<void>
}

export function FusionPanel({ outputDir, liveRecording, onStatus, onPickOutputDir }: FusionPanelProps) {
  const [clips, setClips] = useState<VideoClip[]>([])
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [programCameraId, setProgramCameraId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [fusionRecording, setFusionRecording] = useState(false)
  /** Miniaturas en vivo vs solo botones con nombre (menos decoders). */
  const [selectorMode, setSelectorMode] = useState<'thumbnails' | 'compact'>('thumbnails')
  /** Tramos ya cerrados (EDL) durante / después de grabar fusión. */
  const [fusionSegmentsDone, setFusionSegmentsDone] = useState<
    { startSec: number; endSec: number; cameraId: string }[]
  >([])
  /** Tramo abierto mientras grabás fusión (cámara actual desde startSec). */
  const [openFusionSeg, setOpenFusionSeg] = useState<{ cameraId: string; startSec: number } | null>(null)
  const [fusionRecorderPaused, setFusionRecorderPaused] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  /** Vídeos de la vista grande (programa / canvas). */
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())
  /** Miniaturas inferiores (misma pista, mismo tiempo; duplicado ligero para ver todas). */
  const thumbVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const rafRef = useRef<number>(0)
  /** Para handlers de `<video>` miniatura (onLoadedData): el estado `playing` del closure a veces va atrasado. */
  const playingRef = useRef(false)
  const fusionRecordingRef = useRef(false)
  /** Tiempo de línea maestra al iniciar «Grabar fusión» (para alinear vista previa WebM con las pistas). */
  const fusionRecordStartSecRef = useRef(0)
  const fusionPreviewVideoRef = useRef<HTMLVideoElement | null>(null)
  /** Contenedor de la vista previa exportada (se pone en pantalla completa). */
  const fusionPreviewWrapRef = useRef<HTMLDivElement | null>(null)
  const fusionPreviewBlobRef = useRef<Blob | null>(null)
  const fusionPreviewMimeRef = useRef<string | undefined>(undefined)
  const fusionPreviewUrlUnmountRef = useRef<string | null>(null)
  const timelineBarRef = useRef<HTMLDivElement>(null)
  const [fusionPreviewUrl, setFusionPreviewUrl] = useState<string | null>(null)
  const [fusionPreviewIsFullscreen, setFusionPreviewIsFullscreen] = useState(false)
  /** Si la Fullscreen API falla (p. ej. Electron), cubrir el viewport con CSS. */
  const [fusionPreviewPseudoFullscreen, setFusionPreviewPseudoFullscreen] = useState(false)
  /** Solo el reproductor del WebM exportado (independiente de la mezcla ISO). */
  const [fusionPreviewPlaying, setFusionPreviewPlaying] = useState(false)
  /** Nombre sugerido editable antes de «Guardar en carpeta de grabación» (incluye `.webm`). */
  const [fusionExportFileName, setFusionExportFileName] = useState('')
  const [fusionExportBusy, setFusionExportBusy] = useState(false)

  const transportPlaying = fusionPreviewUrl ? fusionPreviewPlaying : playing

  const setVideoRef = useCallback((id: string, el: HTMLVideoElement | null) => {
    if (el) videoRefs.current.set(id, el)
    else videoRefs.current.delete(id)
  }, [])

  const setThumbVideoRef = useCallback((id: string, el: HTMLVideoElement | null) => {
    if (el) thumbVideoRefs.current.set(id, el)
    else thumbVideoRefs.current.delete(id)
  }, [])

  useEffect(() => {
    playingRef.current = playing
    fusionRecordingRef.current = fusionRecording
  }, [playing, fusionRecording])

  useEffect(() => {
    fusionPreviewUrlUnmountRef.current = fusionPreviewUrl
  }, [fusionPreviewUrl])

  useEffect(() => {
    if (!fusionPreviewUrl) setFusionPreviewPlaying(false)
  }, [fusionPreviewUrl])

  useEffect(() => {
    const sync = () => {
      const wrap = fusionPreviewWrapRef.current
      const vid = fusionPreviewVideoRef.current
      const el = document.fullscreenElement
      const api =
        wrap != null &&
        el != null &&
        (el === wrap || el === vid || (typeof wrap.contains === 'function' && wrap.contains(el)))
      setFusionPreviewIsFullscreen(api)
    }
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  useEffect(() => {
    if (fusionPreviewUrl) return
    setFusionPreviewPseudoFullscreen(false)
    const wrap = fusionPreviewWrapRef.current
    const fs = document.fullscreenElement
    if (wrap && fs && (fs === wrap || (typeof wrap.contains === 'function' && wrap.contains(fs)))) {
      void document.exitFullscreen().catch(() => {})
    }
  }, [fusionPreviewUrl])

  useEffect(() => {
    if (!fusionPreviewPseudoFullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFusionPreviewPseudoFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [fusionPreviewPseudoFullscreen])

  useEffect(() => {
    return () => {
      const u = fusionPreviewUrlUnmountRef.current
      if (u) URL.revokeObjectURL(u)
    }
  }, [])

  const refreshDuration = useCallback(() => {
    const ds: number[] = []
    for (const v of videoRefs.current.values()) {
      const d = v.duration
      // WebM a veces devuelve Infinity o 0 hasta que termina de cargar metadata
      if (Number.isFinite(d) && d > 0 && d < 1e9) ds.push(d)
    }
    const a = audioRef.current
    if (a) {
      const d = a.duration
      if (Number.isFinite(d) && d > 0 && d < 1e9) ds.push(d)
    }
    if (ds.length) setDuration(Math.min(...ds))
  }, [])

  const getMasterTime = useCallback(() => {
    const master =
      audioUrl && audioRef.current
        ? audioRef.current
        : clips[0]
          ? videoRefs.current.get(clips[0].cameraId)
          : undefined
    return master?.currentTime ?? 0
  }, [audioUrl, clips])

  const pickProgramCamera = useCallback(
    (id: string) => {
      if (fusionRecording && openFusionSeg && id !== programCameraId) {
        const t = getMasterTime()
        setFusionSegmentsDone((prev) => [
          ...prev,
          { startSec: openFusionSeg.startSec, endSec: t, cameraId: openFusionSeg.cameraId }
        ])
        setOpenFusionSeg({ cameraId: id, startSec: t })
      }
      setProgramCameraId(id)
    },
    [fusionRecording, openFusionSeg, programCameraId, getMasterTime]
  )

  const timelineSegments = useMemo(() => {
    const out = [...fusionSegmentsDone]
    if (fusionRecording && openFusionSeg) {
      out.push({
        startSec: openFusionSeg.startSec,
        endSec: currentTime,
        cameraId: openFusionSeg.cameraId
      })
    }
    return out
  }, [fusionSegmentsDone, fusionRecording, openFusionSeg, currentTime])

  /** Escala horizontal del timeline: no ocultar la barra si metadata aún no dio duración. */
  const timelineScaleDuration = useMemo(() => {
    let max = Number.isFinite(duration) && duration > 0 ? duration : 0
    for (const s of timelineSegments) {
      if (Number.isFinite(s.endSec)) max = Math.max(max, s.endSec)
      if (Number.isFinite(s.startSec)) max = Math.max(max, s.startSec)
    }
    if (Number.isFinite(currentTime)) max = Math.max(max, currentTime)
    return max > 0 ? max : 1
  }, [currentTime, duration, timelineSegments])

  const fusionCameraColors = useMemo(() => {
    const ids = new Set<string>()
    for (const c of clips) ids.add(c.cameraId)
    for (const s of fusionSegmentsDone) ids.add(s.cameraId)
    if (openFusionSeg) ids.add(openFusionSeg.cameraId)
    return fusionCameraColorMap(ids)
  }, [clips, fusionSegmentsDone, openFusionSeg])

  /** Al cargar WebM, la duración a veces llega tarde; reintentos cortos + eventos extra en <video>. */
  useEffect(() => {
    if (!clips.length) return
    const delays = [80, 250, 700, 2000]
    const timers = delays.map((ms) => window.setTimeout(() => refreshDuration(), ms))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [clips, refreshDuration])

  const loadIsoFiles = async () => {
    setLoadErr(null)
    const paths = await window.studio.pickFusionFiles()
    if (!paths?.length) return

    const parsed: { path: string; info: ParsedRecordingName }[] = []
    for (const p of paths) {
      const name = basenameFromPath(p)
      const info = parseRecordingFileName(name)
      if (!info) {
        if (isFusionExportFileName(name)) {
          setLoadErr(
            'Ese archivo es una fusión ya exportada (fusion-*.webm). Acá cargá las pistas del paso 1: los cam-*.webm de cada cámara y, si tenés, el audio-*.webm — no el archivo fusion.'
          )
        } else {
          setLoadErr(`Archivo no reconocido (usá cam-* o audio-* de esta app): ${name}`)
        }
        return
      }
      parsed.push({ path: p, info })
    }

    const sessions = new Set(parsed.map((x) => x.info.session))
    if (sessions.size !== 1) {
      setLoadErr('Todos los archivos tienen que ser de la misma sesión (mismo número en el nombre).')
      return
    }
    const sid = [...sessions][0]!
    const cams: VideoClip[] = []
    let audioU: string | null = null
    let audioCount = 0

    for (const { path: abs, info } of parsed) {
      if (info.kind === 'audio') {
        audioCount++
        const u = await window.studio.pathToFileUrl(abs)
        if (!u) {
          setLoadErr('No se pudo abrir el archivo de audio.')
          return
        }
        audioU = u
      } else {
        const u = await window.studio.pathToFileUrl(abs)
        if (!u) {
          setLoadErr(`No se pudo abrir: ${basenameFromPath(abs)}`)
          return
        }
        cams.push({ cameraId: info.cameraId, absPath: abs, fileUrl: u })
      }
    }

    if (audioCount > 1) {
      setLoadErr('Seleccioná un solo archivo audio-*.webm.')
      return
    }

    cams.sort((a, b) => a.cameraId.localeCompare(b.cameraId))
    if (!cams.length) {
      setLoadErr('Necesitás al menos un vídeo cam-*.webm.')
      return
    }

    setSessionId(sid)
    setClips(cams)
    setAudioUrl(audioU)
    setProgramCameraId(cams[0]!.cameraId)
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setFusionSegmentsDone([])
    setOpenFusionSeg(null)
    setFusionRecorderPaused(false)
    setFusionPreviewUrl((u) => {
      if (u) URL.revokeObjectURL(u)
      return null
    })
    fusionPreviewBlobRef.current = null
    fusionPreviewMimeRef.current = undefined
    onStatus(`Fusión: cargadas ${cams.length} cámara(s)${audioU ? ' + audio PC' : ''} · sesión ${sid}`)
  }

  /** Sincronizar reloj entre pistas (principal + miniaturas). */
  useEffect(() => {
    if (fusionPreviewUrl) return
    if (!playing || !clips.length) return
    const tick = () => {
      const master =
        audioUrl && audioRef.current ? audioRef.current : videoRefs.current.get(clips[0]!.cameraId)
      if (!master) return
      const t = master.currentTime
      setCurrentTime(t)

      for (const c of clips) {
        const v = videoRefs.current.get(c.cameraId)
        if (v && !v.ended && Math.abs(v.currentTime - t) > 0.25) v.currentTime = t
        const th = thumbVideoRefs.current.get(c.cameraId)
        if (th) {
          /** Miniatura: umbral más holgado que la ISO grande (menos “temblor” por jitter del decodificador). */
          if (!th.ended && Math.abs(th.currentTime - t) > 0.38) th.currentTime = t
          /** `play()` con `ended` rebobina al inicio → loop con el seek al final del maestro. */
          if (th.paused && !th.ended) void th.play().catch(() => {})
        }
      }
      if (audioRef.current && audioUrl && master !== audioRef.current) {
        if (Math.abs(audioRef.current.currentTime - t) > 0.25) audioRef.current.currentTime = t
      }
    }
    const id = window.setInterval(tick, 100)
    return () => window.clearInterval(id)
  }, [fusionPreviewUrl, playing, clips, audioUrl])

  /** Miniaturas recién montadas (p. ej. al cambiar de «solo nombres» a miniaturas) deben engancharse al play global. */
  useEffect(() => {
    if (fusionPreviewUrl) return
    if (selectorMode !== 'thumbnails' || !playing || !clips.length) return
    const master =
      audioUrl && audioRef.current ? audioRef.current : videoRefs.current.get(clips[0]!.cameraId)
    if (!master) return
    const kick = () => {
      const t = master.currentTime
      for (const c of clips) {
        const th = thumbVideoRefs.current.get(c.cameraId)
        if (!th || th.ended) continue
        if (Math.abs(th.currentTime - t) > 0.05) th.currentTime = t
        void th.play().catch(() => {})
      }
    }
    kick()
    const a = window.setTimeout(kick, 60)
    const b = window.setTimeout(kick, 280)
    return () => {
      window.clearTimeout(a)
      window.clearTimeout(b)
    }
  }, [fusionPreviewUrl, selectorMode, playing, clips, audioUrl])

  /** Dibujo programa → canvas */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !programCameraId) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const v = videoRefs.current.get(programCameraId)
      if (v && v.readyState >= 1) {
        const vw = v.videoWidth
        const vh = v.videoHeight
        if (vw && vh) {
          try {
            const cw = canvas.width
            const ch = canvas.height
            const scale = Math.min(cw / vw, ch / vh)
            const dw = vw * scale
            const dh = vh * scale
            const ox = (cw - dw) / 2
            const oy = (ch - dh) / 2
            ctx.fillStyle = '#020617'
            ctx.fillRect(0, 0, cw, ch)
            ctx.drawImage(v, ox, oy, dw, dh)
          } catch {
            /* fotograma aún no decodificado */
          }
        }
      }
      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [programCameraId, clips])

  const pauseAll = useCallback(() => {
    const master = audioUrl && audioRef.current ? audioRef.current : videoRefs.current.get(clips[0]!.cameraId)
    master?.pause()
    for (const c of clips) {
      videoRefs.current.get(c.cameraId)?.pause()
      thumbVideoRefs.current.get(c.cameraId)?.pause()
    }
    audioRef.current?.pause()
    setPlaying(false)
  }, [audioUrl, clips])

  const playAll = useCallback(async () => {
    if (!clips.length) return
    const master = audioUrl && audioRef.current ? audioRef.current : videoRefs.current.get(clips[0]!.cameraId)
    if (!master) return
    try {
      const t = master.currentTime
      const plays: Promise<void>[] = []
      for (const c of clips) {
        const v = videoRefs.current.get(c.cameraId)
        if (v) {
          v.currentTime = t
          plays.push(v.play())
        }
        const th = thumbVideoRefs.current.get(c.cameraId)
        if (th) {
          th.currentTime = t
          plays.push(th.play())
        }
      }
      if (audioRef.current && audioUrl) {
        audioRef.current.currentTime = t
        plays.push(audioRef.current.play())
      }
      await Promise.all(plays)
      setPlaying(true)
    } catch (e) {
      onStatus(`No se pudo reproducir: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [audioUrl, clips, onStatus])

  const togglePlay = useCallback(async () => {
    if (fusionPreviewUrl && fusionPreviewVideoRef.current) {
      const pv = fusionPreviewVideoRef.current
      try {
        if (pv.paused) {
          await pv.play()
          setFusionPreviewPlaying(true)
        } else {
          pv.pause()
          setFusionPreviewPlaying(false)
        }
      } catch (e) {
        onStatus(`Vista previa: ${e instanceof Error ? e.message : String(e)}`)
      }
      return
    }
    if (!clips.length) return
    if (playing) {
      pauseAll()
    } else {
      await playAll()
    }
  }, [clips.length, fusionPreviewUrl, onStatus, pauseAll, playAll, playing])

  const seek = useCallback(
    (t: number) => {
      let max = duration > 0 ? duration : 0
      if (max <= 0) {
        const ds: number[] = []
        for (const v of videoRefs.current.values()) {
          const d = v.duration
          if (Number.isFinite(d) && d > 0 && d < 1e9) ds.push(d)
        }
        const a = audioRef.current
        if (a) {
          const d = a.duration
          if (Number.isFinite(d) && d > 0 && d < 1e9) ds.push(d)
        }
        if (ds.length) max = Math.min(...ds)
      }
      if (max <= 0) max = timelineScaleDuration
      const x = Math.max(0, Math.min(t, max))
      for (const c of clips) {
        const v = videoRefs.current.get(c.cameraId)
        if (v) v.currentTime = x
        const th = thumbVideoRefs.current.get(c.cameraId)
        if (th) th.currentTime = x
      }
      if (audioRef.current) audioRef.current.currentTime = x
      setCurrentTime(x)
      if (!fusionRecording && fusionSegmentsDone.length > 0) {
        const cam = cameraAtFusionTime(x, fusionSegmentsDone)
        if (cam) setProgramCameraId(cam)
      }
      const pv = fusionPreviewVideoRef.current
      if (pv && fusionPreviewUrl) {
        const rel = Math.max(0, x - fusionRecordStartSecRef.current)
        const d = pv.duration
        pv.currentTime = Number.isFinite(d) && d > 0 ? Math.min(rel, d) : rel
      }
    },
    [clips, duration, fusionPreviewUrl, fusionRecording, fusionSegmentsDone, timelineScaleDuration]
  )

  /** Al generar la vista previa WebM, ir al inicio del tramo grabado en la línea de tiempo. */
  useEffect(() => {
    if (!fusionPreviewUrl || !clips.length) return
    seek(fusionRecordStartSecRef.current)
  }, [fusionPreviewUrl, clips.length, seek])

  /**
   * Alinear miniaturas al tiempo de la barra cuando NO estás en play.
   * En play, `currentTime` se actualiza ~cada 100 ms y este efecto con umbral 0.05 peleaba con el tick
   * (0.25 en ISO / lógica distinta en thumbs) → seeks en bucle en una miniatura; tras varias vistas previa canceladas se notaba más.
   */
  useEffect(() => {
    if (selectorMode !== 'thumbnails' || !clips.length) return
    if (playing) return
    const id = window.requestAnimationFrame(() => {
      const t = currentTime
      for (const c of clips) {
        const th = thumbVideoRefs.current.get(c.cameraId)
        if (th && !th.ended && Number.isFinite(t) && Math.abs(th.currentTime - t) > 0.05) {
          th.currentTime = t
        }
      }
    })
    return () => cancelAnimationFrame(id)
  }, [selectorMode, clips, currentTime, playing])

  /** Cierra MediaRecorder y deja la barra de plan + vista previa WebM en memoria (aún no guarda en disco). */
  const stopFusionRecord = useCallback(async () => {
    const rec = recRef.current
    if (!rec) return
    const tEnd = getMasterTime()
    if (openFusionSeg) {
      setFusionSegmentsDone((prev) => [
        ...prev,
        { startSec: openFusionSeg.startSec, endSec: tEnd, cameraId: openFusionSeg.cameraId }
      ])
    }
    setOpenFusionSeg(null)
    setFusionRecorderPaused(false)
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
    setFusionRecording(false)
    pauseAll()
    const parts = chunksRef.current
    chunksRef.current = []
    const blob = new Blob(parts, { type: mimeType || 'video/webm' })
    parts.length = 0
    fusionPreviewMimeRef.current = mimeType || 'video/webm'
    fusionPreviewBlobRef.current = blob
    if (fusionPreviewUrl) URL.revokeObjectURL(fusionPreviewUrl)
    const url = URL.createObjectURL(blob)
    setFusionPreviewUrl(url)
    const sid = sessionId ?? Date.now()
    setFusionExportFileName(`fusion-${sid}-${Date.now()}.webm`)
    onStatus(
      'Grabación lista: revisá la vista previa, mové el tiempo en la barra o el control y guardá cuando quieras.'
    )
  }, [fusionPreviewUrl, getMasterTime, onStatus, openFusionSeg, pauseAll, sessionId])

  /** Fin de la pista maestra: si `playing` queda true, el tick sigue haciendo play/seek en miniaturas `ended` → salto en bucle. */
  useEffect(() => {
    if (fusionPreviewUrl || !clips.length) return
    const master =
      audioUrl && audioRef.current ? audioRef.current : videoRefs.current.get(clips[0]!.cameraId)
    if (!master || typeof master.addEventListener !== 'function') return

    const onEnded = () => {
      const rec = recRef.current
      if (fusionRecordingRef.current && rec && rec.state === 'recording') {
        void stopFusionRecord()
        return
      }
      pauseAll()
    }

    master.addEventListener('ended', onEnded)
    return () => master.removeEventListener('ended', onEnded)
  }, [fusionPreviewUrl, clips.length, audioUrl, pauseAll, stopFusionRecord])

  const saveFusionPreviewToDisk = useCallback(async () => {
    const blob = fusionPreviewBlobRef.current
    const dir = outputDir
    const sid = sessionId ?? Date.now()
    if (!blob || !dir) {
      onStatus('No hay vista previa para guardar o falta la carpeta de grabación.')
      return
    }
    const fallback = `fusion-${sid}-${Date.now()}.webm`
    const name = sanitizeFusionSaveFileName(fusionExportFileName, fallback)
    const filePath = joinOutputPath(dir, name)
    setFusionExportBusy(true)
    try {
      const buf = await blob.arrayBuffer()
      await window.studio.saveVideo(filePath, buf)
      fusionPreviewBlobRef.current = null
      fusionPreviewMimeRef.current = undefined
      if (fusionPreviewUrl) URL.revokeObjectURL(fusionPreviewUrl)
      setFusionPreviewUrl(null)
      onStatus(`Fusión guardada (WebM): ${name}`)
    } catch (e) {
      onStatus(`Error al guardar WebM: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setFusionExportBusy(false)
    }
  }, [fusionExportFileName, fusionPreviewUrl, outputDir, sessionId, onStatus])

  const saveFusionPreviewAsMp4 = useCallback(async () => {
    const blob = fusionPreviewBlobRef.current
    const dir = outputDir
    const sid = sessionId ?? Date.now()
    if (!blob || !dir) {
      onStatus('No hay vista previa para guardar o falta la carpeta de grabación.')
      return
    }
    const fallbackMp4 = `fusion-${sid}-${Date.now()}.mp4`
    const name = sanitizeFusionMp4FileName(fusionExportFileName, fallbackMp4)
    const filePath = joinOutputPath(dir, name)
    setFusionExportBusy(true)
    onStatus('Generando MP4 con FFmpeg (puede tardar según la duración)...')
    try {
      const buf = await blob.arrayBuffer()
      const r = await window.studio.saveFusionMp4(filePath, buf)
      if (!r.ok) {
        onStatus(`No se pudo exportar MP4: ${r.message}`)
        return
      }
      fusionPreviewBlobRef.current = null
      fusionPreviewMimeRef.current = undefined
      if (fusionPreviewUrl) URL.revokeObjectURL(fusionPreviewUrl)
      setFusionPreviewUrl(null)
      onStatus(`Fusión guardada (MP4): ${name}`)
    } catch (e) {
      onStatus(`Error al exportar MP4: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setFusionExportBusy(false)
    }
  }, [fusionExportFileName, fusionPreviewUrl, outputDir, sessionId, onStatus])

  const discardFusionPreview = useCallback(() => {
    fusionPreviewBlobRef.current = null
    fusionPreviewMimeRef.current = undefined
    if (fusionPreviewUrl) URL.revokeObjectURL(fusionPreviewUrl)
    setFusionPreviewUrl(null)
    setFusionExportFileName('')
    setFusionSegmentsDone([])
    onStatus('Vista previa descartada (no se guardó el archivo).')
    queueMicrotask(() => {
      if (!playingRef.current || selectorMode !== 'thumbnails' || !clips.length) return
      const master =
        audioUrl && audioRef.current ? audioRef.current : videoRefs.current.get(clips[0]!.cameraId)
      if (!master || !Number.isFinite(master.currentTime)) return
      const t = master.currentTime
      for (const c of clips) {
        const th = thumbVideoRefs.current.get(c.cameraId)
        if (!th || th.ended) continue
        if (Math.abs(th.currentTime - t) > 0.06) th.currentTime = t
        if (th.paused && !th.ended) void th.play().catch(() => {})
      }
    })
  }, [fusionPreviewUrl, onStatus, clips, audioUrl, selectorMode])

  const toggleFusionPreviewFullscreen = useCallback(() => {
    const wrap = fusionPreviewWrapRef.current
    const vid = fusionPreviewVideoRef.current
    if (!wrap) return

    const fsEl = document.fullscreenElement
    if (fsEl && (fsEl === wrap || fsEl === vid || wrap.contains(fsEl))) {
      void document.exitFullscreen?.().catch(() => {})
      return
    }

    if (fusionPreviewPseudoFullscreen) {
      setFusionPreviewPseudoFullscreen(false)
      return
    }

    const fail = () => setFusionPreviewPseudoFullscreen(true)

    const enter = (el: Element | null): Promise<void> => {
      if (!el) return Promise.reject(new Error('sin elemento'))
      if (typeof el.requestFullscreen === 'function') {
        return el.requestFullscreen({ navigationUI: 'hide' }).then(() => undefined)
      }
      try {
        const wk = (el as unknown as { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen
        if (wk) {
          wk.call(el)
          return Promise.resolve()
        }
      } catch {
        return Promise.reject(new Error('webkit'))
      }
      try {
        const ms = (el as unknown as { msRequestFullscreen?: () => void }).msRequestFullscreen
        if (ms) {
          ms.call(el)
          return Promise.resolve()
        }
      } catch {
        return Promise.reject(new Error('ms'))
      }
      return Promise.reject(new Error('sin API'))
    }

    /** Primero el `<video>` (Chromium/Electron); si falla, el contenedor. Siempre hay modo CSS de respaldo. */
    void enter(vid)
      .catch(() => enter(wrap))
      .catch(fail)
  }, [fusionPreviewPseudoFullscreen])

  const startFusionRecord = useCallback(async () => {
    if (!outputDir) {
      onStatus('Elegí carpeta de grabación antes de exportar la fusión.')
      return
    }
    if (!clips.length || !canvasRef.current) return
    setFusionPreviewUrl((u) => {
      if (u) URL.revokeObjectURL(u)
      return null
    })
    fusionPreviewBlobRef.current = null
    fusionPreviewMimeRef.current = undefined
    const mime = pickFusionRecorderMime()
    const canvas = canvasRef.current
    /** Reloj de captura del navegador (~30 Hz); el canvas sigue actualizándose cada RAF. */
    const vStream = canvas.captureStream(FUSION_CAPTURE_OUT_FPS)
    const vidTrack = vStream.getVideoTracks()[0]
    const parts: BlobPart[] = []
    chunksRef.current = parts

    let outStream: MediaStream
    const aEl = audioRef.current
    if (aEl && audioUrl) {
      try {
        /** `captureStream` en audio existe en Chromium; los typings de `HTMLAudioElement` a veces no lo declaran. */
        const cap = (aEl as HTMLMediaElement & { captureStream?: () => MediaStream }).captureStream?.()
        if (!cap) {
          outStream = new MediaStream([vidTrack])
        } else {
          const aTrack = cap.getAudioTracks()[0]
          if (aTrack) {
            outStream = new MediaStream([vidTrack, aTrack])
          } else {
            outStream = new MediaStream([vidTrack])
          }
        }
      } catch {
        outStream = new MediaStream([vidTrack])
      }
    } else {
      outStream = new MediaStream([vidTrack])
    }

    const rec = createFusionMediaRecorder(outStream, mime)
    rec.ondataavailable = (e) => {
      if (e.data.size) parts.push(e.data)
    }
    recRef.current = rec
    /** Sin timeslice: un solo `dataavailable` al parar — evita trabajo cada ~100 ms que tironeaba el hilo principal. */
    rec.start()
    setFusionRecording(true)
    setFusionRecorderPaused(false)
    const t0 = getMasterTime()
    fusionRecordStartSecRef.current = t0
    setFusionSegmentsDone([])
    if (programCameraId) {
      setOpenFusionSeg({ cameraId: programCameraId, startSec: t0 })
    } else {
      setOpenFusionSeg(null)
    }
    onStatus('Grabando fusión: tocá las cámaras para cambiar el plan en vivo.')

    if (!playing) {
      try {
        await playAll()
      } catch (e) {
        onStatus(`Grabación iniciada pero falló play: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }, [clips, getMasterTime, onStatus, outputDir, playAll, playing, programCameraId])

  const fusionRecorderSupportsPause =
    typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.prototype.pause === 'function'

  const pauseFusionRecording = useCallback(() => {
    const rec = recRef.current
    if (!rec || rec.state !== 'recording') return
    if (!fusionRecorderSupportsPause) {
      onStatus('Este entorno no permite pausar la grabación (sin MediaRecorder.pause).')
      return
    }
    try {
      rec.pause()
      setFusionRecorderPaused(true)
      pauseAll()
      setCurrentTime(getMasterTime())
    } catch (e) {
      onStatus(`No se pudo pausar la grabación: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [fusionRecorderSupportsPause, getMasterTime, onStatus, pauseAll])

  const resumeFusionRecording = useCallback(async () => {
    const rec = recRef.current
    if (!rec || rec.state !== 'paused') return
    if (!fusionRecorderSupportsPause) return
    try {
      rec.resume()
      setFusionRecorderPaused(false)
      await playAll()
    } catch (e) {
      onStatus(`No se pudo reanudar la grabación: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [fusionRecorderSupportsPause, onStatus, playAll])

  useEffect(() => {
    return () => {
      const rec = recRef.current
      if (rec && rec.state === 'recording') {
        try {
          rec.stop()
        } catch {
          /* vacío */
        }
      }
      recRef.current = null
    }
  }, [])

  const fmt = (s: number) => {
    if (!Number.isFinite(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const disabledFusion =
    liveRecording ||
    !clips.length ||
    fusionRecording ||
    !programCameraId ||
    !outputDir ||
    fusionPreviewUrl !== null

  return (
    <div style={workspaceInnerCard}>
      <div style={workspaceEyebrow}>Paso 2 · Fusión con archivos (mezcla las pistas grabadas en el paso 1)</div>
      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.45 }}>
        Cuando ya tengas guardados los archivos del paso 1, cargá los <code style={{ color: '#cbd5e1' }}>cam-*.webm</code>{' '}
        de una misma sesión y, si grabaste, <code style={{ color: '#cbd5e1' }}>audio-*.webm</code>. Reproducí, elegí qué
        cámara va al programa y grabá la mezcla. No cargues aquí el archivo <code style={{ color: '#cbd5e1' }}>fusion-*.webm</code>{' '}
        (eso es solo el resultado exportado). En Windows, si la carpeta parece vacía, abrí «Tipo de archivo» en el
        explorador y elegí «Todos los archivos».
      </div>

      {outputDir ? (
        <div style={pathLineMuted}>
          Carpeta: <span style={pathTextBright}>{outputDir}</span>
        </div>
      ) : (
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid #854d0e',
            background: '#1c1410',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ ...warnLineNoFolder, flex: '1 1 240px', minWidth: 0 }}>
            <strong style={{ color: '#fef3c7' }}>Falta elegir carpeta.</strong> Sin carpeta no podés guardar la fusión
            (WebM o MP4) ni usar «Guardar en carpeta de grabación». Elegila con «Carpeta de grabación» en la barra superior
            de esta pestaña
            {onPickOutputDir ? ', o con el botón de acá' : ''}.
          </div>
          {onPickOutputDir ? (
            <button
              type="button"
              disabled={liveRecording}
              onClick={() => void onPickOutputDir()}
              style={{
                ...btnNeutral,
                border: '1px solid #b45309',
                background: liveRecording ? '#334155' : '#78350f',
                color: '#fffbeb',
                fontWeight: 600,
                cursor: liveRecording ? 'not-allowed' : 'pointer',
                flexShrink: 0
              }}
            >
              Elegir carpeta de grabación…
            </button>
          ) : null}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          disabled={liveRecording}
          onClick={() => void loadIsoFiles()}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #334155',
            background: '#0f172a',
            color: '#e2e8f0'
          }}
        >
          Cargar pistas WebM…
        </button>
        {sessionId !== null ? (
          <span style={{ fontSize: 12, color: '#86efac' }}>Sesión {sessionId}</span>
        ) : null}
      </div>

      {loadErr ? <div style={{ fontSize: 12, color: '#fca5a5' }}>{loadErr}</div> : null}

      {audioUrl ? (
        <div
          aria-hidden
          style={{ position: 'absolute', left: -9999, top: 0, width: 4, height: 4, overflow: 'hidden', opacity: 0 }}
        >
          <audio
            key={audioUrl}
            ref={audioRef}
            src={audioUrl}
            preload="auto"
            onLoadedMetadata={refreshDuration}
            onLoadedData={refreshDuration}
            onDurationChange={refreshDuration}
          />
        </div>
      ) : null}

      {clips.length > 0 ? (
        <div className="fusion-workspace">
          <div className="fusion-main-flow">
            <div
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 20,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
                paddingBottom: 10,
                marginBottom: 2,
                marginLeft: -4,
                marginRight: -4,
                paddingLeft: 4,
                paddingRight: 4,
                paddingTop: 4,
                background: '#080f18',
                borderBottom: '1px solid #1e293b'
              }}
            >
              <button
                type="button"
                onClick={() => void togglePlay()}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: '1px solid #475569',
                  background: transportPlaying ? '#422006' : '#14532d',
                  color: transportPlaying ? '#fde68a' : '#dcfce7',
                  fontWeight: 600,
                  flexShrink: 0
                }}
              >
                {fusionPreviewUrl
                  ? transportPlaying
                    ? 'Pausar vista previa'
                    : 'Reproducir vista previa'
                  : transportPlaying
                    ? 'Pausar'
                    : 'Reproducir'}
              </button>
              <input
                type="range"
                min={0}
                max={Math.max(duration || 0, timelineScaleDuration)}
                step={0.05}
                value={Math.min(currentTime, Math.max(duration || 0, timelineScaleDuration))}
                onChange={(e) => seek(Number(e.target.value))}
                style={{ flex: '1 1 140px', minWidth: 100 }}
              />
              <span
                style={{
                  fontSize: 12,
                  color: '#94a3b8',
                  fontVariantNumeric: 'tabular-nums',
                  flexShrink: 0
                }}
              >
                {fmt(currentTime)} / {fmt(duration)}
              </span>
            </div>

            <div style={{ textAlign: 'center', margin: '0 auto 2px', maxWidth: 560 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>Fusión en vivo</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, lineHeight: 1.4 }}>
                Lo que elegís en las cámaras es lo que se ve y se exporta al grabar.
              </div>
            </div>

            <div className="fusion-preview-box">
              {/*
              Canvas centrado con proporción fija (evita estirar horizontal el bitmap).
              Los <video> siguen en .fusion-video-decoders solo para decodificar / drawImage.
            */}
              <div className="fusion-preview-inner">
                <canvas ref={canvasRef} width={1280} height={720} />
              </div>
            </div>
            <div className="fusion-video-decoders" aria-hidden>
              {clips.map((c) => (
                <video
                  key={c.cameraId}
                  ref={(el) => setVideoRef(c.cameraId, el)}
                  src={c.fileUrl}
                  preload="auto"
                  muted
                  playsInline
                  onLoadedMetadata={refreshDuration}
                  onLoadedData={refreshDuration}
                  onDurationChange={refreshDuration}
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: 1280,
                    height: 720,
                    objectFit: 'contain'
                  }}
                />
              ))}
            </div>

            <div style={{ width: '100%', maxWidth: 960, margin: '0 auto' }}>
                <div
                  ref={timelineBarRef}
                  style={{
                    position: 'relative',
                    height: 40,
                    borderRadius: 8,
                    background: '#0f172a',
                    border: '1px solid #1e293b',
                    overflow: 'hidden'
                  }}
                >
                  {timelineSegments.map((seg, i) => {
                    const total = timelineScaleDuration
                    const leftPct = (seg.startSec / total) * 100
                    const widthPct = Math.max(
                      0.35,
                      ((seg.endSec - seg.startSec) / total) * 100
                    )
                    return (
                      <div
                        key={`${seg.cameraId}-${i}-${seg.startSec}`}
                        title={`${seg.cameraId} · ${fmt(seg.startSec)} → ${fmt(seg.endSec)}`}
                        style={{
                          position: 'absolute',
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                          top: 0,
                          bottom: 0,
                          background: fusionSegmentColor(fusionCameraColors, seg.cameraId),
                          opacity: 0.88,
                          borderRight: '1px solid rgba(15,23,42,0.85)',
                          boxSizing: 'border-box'
                        }}
                      />
                    )
                  })}
                  <div
                    style={{
                      position: 'absolute',
                      left: `${Math.min(100, (currentTime / timelineScaleDuration) * 100)}%`,
                      top: 0,
                      bottom: 0,
                      width: 2,
                      marginLeft: -1,
                      background: '#f8fafc',
                      boxShadow: '0 0 8px #38bdf8',
                      pointerEvents: 'none',
                      zIndex: 3
                    }}
                  />
                  <div
                    role="presentation"
                    aria-hidden
                    style={{
                      position: 'absolute',
                      inset: 0,
                      zIndex: 4,
                      cursor: 'pointer'
                    }}
                    onClick={(e) => {
                      const bar = timelineBarRef.current
                      if (!bar) return
                      const rect = bar.getBoundingClientRect()
                      const w = rect.width || 1
                      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / w))
                      seek(ratio * timelineScaleDuration)
                    }}
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                    marginTop: 6,
                    fontSize: 10,
                    color: '#64748b'
                  }}
                >
                  <span>
                    Plan de cámara en el tiempo
                    {duration <= 0 && (
                      <span style={{ color: '#64748b' }}> · cargando duración…</span>
                    )}
                  </span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {timelineSegments.length} tramo(s)
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
                  {[...new Set(clips.map((c) => c.cameraId))].map((id) => (
                    <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 2,
                          background: fusionSegmentColor(fusionCameraColors, id),
                          flexShrink: 0
                        }}
                      />
                      <span style={{ color: '#94a3b8' }}>{id}</span>
                    </span>
                  ))}
                </div>

                {fusionPreviewUrl ? (
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
                      Vista previa del archivo grabado
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, lineHeight: 1.4 }}>
                      «Reproducir vista previa» solo mueve el WebM exportado; la mezcla de arriba no se reproduce con
                      ese botón. La línea de tiempo sigue controlando las pistas cargadas; si movés el tiempo ahí, la vista
                      previa salta al mismo instante relativo. Pantalla completa / Esc; sin ícono duplicado en el vídeo.
                      {' '}
                      Podés guardar WebM (rápido) o MP4 H.264 (mejor en el Reproductor de Windows / barra de tiempo).
                    </div>
                    <label
                      htmlFor="fusion-export-filename"
                      style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}
                    >
                      Nombre del archivo (el mismo base sirve para WebM y MP4)
                    </label>
                    <input
                      id="fusion-export-filename"
                      type="text"
                      value={fusionExportFileName}
                      onChange={(e) => setFusionExportFileName(e.target.value)}
                      spellCheck={false}
                      autoComplete="off"
                      disabled={fusionExportBusy}
                      placeholder="mi-fusion.webm"
                      style={{
                        width: '100%',
                        maxWidth: 420,
                        boxSizing: 'border-box',
                        marginBottom: 10,
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid #475569',
                        background: '#020617',
                        color: '#e2e8f0',
                        fontSize: 13
                      }}
                    />
                    <div
                      ref={fusionPreviewWrapRef}
                      className={
                        'fusion-export-preview-wrap' +
                        (fusionPreviewPseudoFullscreen ? ' fusion-export-preview-wrap--pseudo-fs' : '')
                      }
                    >
                      <button
                        type="button"
                        onClick={() => void toggleFusionPreviewFullscreen()}
                        style={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          zIndex: 3,
                          padding: '6px 12px',
                          borderRadius: 8,
                          border: '1px solid rgba(148,163,184,0.5)',
                          background: 'rgba(15,23,42,0.92)',
                          color: '#e2e8f0',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        {fusionPreviewIsFullscreen || fusionPreviewPseudoFullscreen
                          ? 'Salir de pantalla completa'
                          : 'Pantalla completa'}
                      </button>
                      <video
                        ref={fusionPreviewVideoRef}
                        src={fusionPreviewUrl}
                        controls
                        controlsList="nofullscreen"
                        playsInline
                        preload="metadata"
                        className="fusion-export-preview-video"
                        style={{
                          width: '100%',
                          maxHeight: 'min(36vh, 320px)',
                          borderRadius: 8,
                          background: '#000',
                          display: 'block'
                        }}
                        onPlay={() => setFusionPreviewPlaying(true)}
                        onPause={() => setFusionPreviewPlaying(false)}
                      />
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                      <button
                        type="button"
                        disabled={!outputDir || fusionExportBusy}
                        onClick={() => void saveFusionPreviewToDisk()}
                        style={{
                          padding: '8px 14px',
                          borderRadius: 8,
                          border: '1px solid #047857',
                          background: !outputDir || fusionExportBusy ? '#334155' : '#065f46',
                          color: '#ecfdf5',
                          fontWeight: 600,
                          opacity: fusionExportBusy ? 0.85 : 1
                        }}
                      >
                        Guardar WebM
                      </button>
                      <button
                        type="button"
                        disabled={!outputDir || fusionExportBusy}
                        onClick={() => void saveFusionPreviewAsMp4()}
                        style={{
                          padding: '8px 14px',
                          borderRadius: 8,
                          border: '1px solid #1d4ed8',
                          background: !outputDir || fusionExportBusy ? '#334155' : '#1e40af',
                          color: '#eff6ff',
                          fontWeight: 600,
                          opacity: fusionExportBusy ? 0.85 : 1
                        }}
                      >
                        Guardar MP4 (recomendado Windows)
                      </button>
                      <button
                        type="button"
                        disabled={fusionExportBusy}
                        onClick={() => discardFusionPreview()}
                        style={{
                          padding: '8px 14px',
                          borderRadius: 8,
                          border: '1px solid #475569',
                          background: '#1e293b',
                          color: '#e2e8f0',
                          fontWeight: 600
                        }}
                      >
                        Descartar vista previa
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

            {selectorMode === 'compact' ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6, textAlign: 'center' }}>
                  Tocá el nombre para mandar esa cámara al programa.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                  {clips.map((c) => (
                    <button
                      key={c.cameraId}
                      type="button"
                      onClick={() => pickProgramCamera(c.cameraId)}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 8,
                        border:
                          programCameraId === c.cameraId ? '2px solid #38bdf8' : '1px solid #334155',
                        background: programCameraId === c.cameraId ? '#0c4a6e' : '#0f172a',
                        color: '#e2e8f0',
                        fontSize: 12,
                        fontWeight: programCameraId === c.cameraId ? 700 : 500
                      }}
                    >
                      {c.cameraId}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                marginTop: selectorMode === 'compact' ? 10 : 6
              }}
            >
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Selector:</span>
              <button
                type="button"
                onClick={() => setSelectorMode('thumbnails')}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: selectorMode === 'thumbnails' ? '2px solid #38bdf8' : '1px solid #334155',
                  background: selectorMode === 'thumbnails' ? '#0c4a6e' : '#0f172a',
                  color: '#e2e8f0',
                  fontSize: 11,
                  fontWeight: selectorMode === 'thumbnails' ? 700 : 500,
                  cursor: 'pointer'
                }}
              >
                Miniaturas
              </button>
              <button
                type="button"
                onClick={() => setSelectorMode('compact')}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: selectorMode === 'compact' ? '2px solid #38bdf8' : '1px solid #334155',
                  background: selectorMode === 'compact' ? '#0c4a6e' : '#0f172a',
                  color: '#e2e8f0',
                  fontSize: 11,
                  fontWeight: selectorMode === 'compact' ? 700 : 500,
                  cursor: 'pointer'
                }}
              >
                Solo nombres
              </button>
              <span style={{ fontSize: 10, color: '#475569' }}>(nombres = menos carga)</span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 10 }}>
              <button
                type="button"
                disabled={disabledFusion}
                onClick={() => void startFusionRecord()}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: '1px solid transparent',
                  background: '#7c3aed',
                  color: 'white',
                  fontWeight: 600,
                  opacity: disabledFusion ? 0.45 : 1
                }}
              >
                Grabar fusión
              </button>
              {fusionRecording && fusionRecorderSupportsPause ? (
                fusionRecorderPaused ? (
                  <button
                    type="button"
                    onClick={() => void resumeFusionRecording()}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: '1px solid #047857',
                      background: '#065f46',
                      color: '#ecfdf5',
                      fontWeight: 600
                    }}
                  >
                    Reanudar grabación
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => pauseFusionRecording()}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: '1px solid #92400e',
                      background: '#78350f',
                      color: '#fffbeb',
                      fontWeight: 600
                    }}
                  >
                    Pausar grabación
                  </button>
                )
              ) : null}
              <button
                type="button"
                disabled={!fusionRecording}
                onClick={() => void stopFusionRecord()}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: '1px solid #991b1b',
                  background: fusionRecording ? '#b91c1c' : '#334155',
                  color: '#fef2f2',
                  fontWeight: 600,
                  opacity: fusionRecording ? 1 : 0.5
                }}
              >
                Detener grabación
              </button>
              {fusionRecording ? (
                <span style={{ fontSize: 12, fontWeight: 700, color: fusionRecorderPaused ? '#fdba74' : '#e9d5ff' }}>
                  {fusionRecorderPaused ? '■ PAUSA' : '● GRABANDO'}
                </span>
              ) : null}
            </div>
          </div>

          {selectorMode === 'thumbnails' ? (
            <aside className="fusion-sidebar">
              <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', letterSpacing: 0.04 }}>
                Cámaras
              </div>
              <div className="fusion-thumb-strip">
                {clips.map((c) => (
                  <button
                    key={`thumb-${c.cameraId}`}
                    type="button"
                    onClick={() => pickProgramCamera(c.cameraId)}
                    title={`Enviar ${c.cameraId} al programa`}
                    style={{
                      padding: 6,
                      borderRadius: 10,
                      border:
                        programCameraId === c.cameraId ? '3px solid #38bdf8' : '1px solid #334155',
                      background: programCameraId === c.cameraId ? '#0f2438' : '#0c121c',
                      cursor: 'pointer',
                      width: '100%',
                      maxWidth: 200,
                      flexShrink: 0,
                      boxSizing: 'border-box'
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
                      <video
                        ref={(el) => setThumbVideoRef(c.cameraId, el)}
                        src={c.fileUrl}
                        muted
                        playsInline
                        preload="auto"
                        onLoadedData={(e) => {
                          const th = e.currentTarget
                          const master =
                            audioUrl && audioRef.current
                              ? audioRef.current
                              : videoRefs.current.get(clips[0]!.cameraId)
                          if (master && Number.isFinite(master.currentTime)) {
                            th.currentTime = master.currentTime
                          }
                          if (playingRef.current && !th.ended) {
                            void th.play().catch(() => {})
                          }
                        }}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'contain',
                          display: 'block',
                          pointerEvents: 'none'
                        }}
                      />
                    </div>
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 10,
                        fontWeight: programCameraId === c.cameraId ? 700 : 500,
                        color: programCameraId === c.cameraId ? '#7dd3fc' : '#94a3b8',
                        textAlign: 'center',
                        wordBreak: 'break-word'
                      }}
                    >
                      {c.cameraId}
                    </div>
                  </button>
                ))}
              </div>
            </aside>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
