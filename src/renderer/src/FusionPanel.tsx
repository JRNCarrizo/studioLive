import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useCameraAliases } from './cameraAliases'
import { FloatingEqualizerPanel } from './FloatingEqualizerPanel'
import {
  btnAudio,
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
import { useFusionAudioGraph } from './useFusionAudioGraph'

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

/** Duración por defecto del fundido entre tomas en el canvas del programa (ms). */
const PROGRAM_CROSSFADE_MS_DEFAULT = 420

type ProgramFade = { from: string; to: string; start: number }

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
  const cameraAliases = useCameraAliases()
  const [clips, setClips] = useState<VideoClip[]>([])
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [programCameraId, setProgramCameraId] = useState<string | null>(null)
  const [programCrossfadeMs, setProgramCrossfadeMs] = useState(PROGRAM_CROSSFADE_MS_DEFAULT)
  /** Refs para que el rAF del dibujo lea los valores actuales sin reabrir el efecto. */
  const crossfadeMsRef = useRef(programCrossfadeMs)
  const programFadeRef = useRef<ProgramFade | null>(null)
  /** Última cámara que “asentó” en el canvas (al terminar fade o al setear sin fade). */
  const settledProgramIdRef = useRef<string | null>(null)
  useEffect(() => {
    crossfadeMsRef.current = programCrossfadeMs
  }, [programCrossfadeMs])
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

  /** Abre el panel flotante de EQ (aplica al audio que se graba en la fusión). */
  const [eqOpen, setEqOpen] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  /**
   * Encuadre por cámara (zoom 1×–4× + offset normalizado del centro: 0..1).
   * El destino se actualiza con mouse, el actual se interpola en el rAF (suavizado breve).
   * `offsetX/Y = 0.5` significa centro de la imagen. Se clampa para que la ventana visible quede dentro.
   */
  type CamFraming = { zoom: number; offsetX: number; offsetY: number }
  const FRAMING_NEUTRAL: CamFraming = { zoom: 1, offsetX: 0.5, offsetY: 0.5 }
  const framingTargetRef = useRef<Map<string, CamFraming>>(new Map())
  const framingCurrentRef = useRef<Map<string, CamFraming>>(new Map())
  const [framingTick, setFramingTick] = useState(0)
  const programDragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
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
  /** Cuál botón está exportando (para spinner localizado y banner con detalle). */
  const [fusionExportTarget, setFusionExportTarget] = useState<'webm' | 'mp4' | null>(null)
  /** Inicio del export en ms — para mostrar “tiempo transcurrido” mientras dura la operación. */
  const [fusionExportStartMs, setFusionExportStartMs] = useState<number | null>(null)
  const [fusionExportElapsed, setFusionExportElapsed] = useState(0)

  useEffect(() => {
    if (fusionExportStartMs == null) {
      setFusionExportElapsed(0)
      return
    }
    setFusionExportElapsed(Date.now() - fusionExportStartMs)
    const id = window.setInterval(() => {
      setFusionExportElapsed(Date.now() - fusionExportStartMs)
    }, 250)
    return () => window.clearInterval(id)
  }, [fusionExportStartMs])

  const transportPlaying = fusionPreviewUrl ? fusionPreviewPlaying : playing

  const setVideoRef = useCallback((id: string, el: HTMLVideoElement | null) => {
    if (el) videoRefs.current.set(id, el)
    else videoRefs.current.delete(id)
  }, [])

  const setThumbVideoRef = useCallback((id: string, el: HTMLVideoElement | null) => {
    if (el) thumbVideoRefs.current.set(id, el)
    else thumbVideoRefs.current.delete(id)
  }, [])

  /**
   * Cadena Web Audio para el audio de fusión: <audio> → EQ → (parlantes + grabador).
   * El graph se monta una sola vez por elemento, y queda en bypass por defecto si no tocás nada.
   * Necesito el `<audio>` como estado para que el hook reaccione a montaje/desmontaje (un ref no dispara render).
   */
  const [audioElState, setAudioElState] = useState<HTMLAudioElement | null>(null)
  const setAudioElCb = useCallback((el: HTMLAudioElement | null) => {
    audioRef.current = el
    setAudioElState(el)
  }, [])
  const audioGraph = useFusionAudioGraph(audioElState, Boolean(audioUrl))

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

  /** Programa el fundido cuando cambia la cámara del programa; si hay uno en curso, sale desde su destino. */
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
    const sourceFrom = mid && mid.to !== programCameraId ? mid.to : settledProgramIdRef.current

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

  /**
   * Dibujo programa → canvas.
   * Aplica encuadre virtual (zoom + pan) por cámara con interpolación suave (lerp),
   * y cuando hay fundido entre tomas, mezcla `from`/`to` con `globalAlpha` (smoothstep).
   */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !programCameraId) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const lerp = (a: number, b: number, k: number) => a + (b - a) * k

    const drawCamera = (cameraId: string, alpha: number) => {
      const v = videoRefs.current.get(cameraId)
      if (!v || v.readyState < 1) return
      const vw = v.videoWidth
      const vh = v.videoHeight
      if (!vw || !vh) return
      const target = framingTargetRef.current.get(cameraId) ?? FRAMING_NEUTRAL
      const cur = framingCurrentRef.current.get(cameraId) ?? FRAMING_NEUTRAL
      /** 0.22 → llega al destino en ~70–100 ms a 60 Hz; suficiente para no verse "snap". */
      const k = 0.22
      const next: CamFraming = {
        zoom: lerp(cur.zoom, target.zoom, k),
        offsetX: lerp(cur.offsetX, target.offsetX, k),
        offsetY: lerp(cur.offsetY, target.offsetY, k)
      }
      framingCurrentRef.current.set(cameraId, next)
      const cw = canvas.width
      const ch = canvas.height
      const fit = Math.min(cw / vw, ch / vh)
      const dw = vw * fit
      const dh = vh * fit
      const ox = (cw - dw) / 2
      const oy = (ch - dh) / 2
      const z = Math.max(1, Math.min(4, next.zoom))
      const srcW = vw / z
      const srcH = vh / z
      const halfW = srcW / 2
      const halfH = srcH / 2
      const cx = Math.min(vw - halfW, Math.max(halfW, next.offsetX * vw))
      const cy = Math.min(vh - halfH, Math.max(halfH, next.offsetY * vh))
      const sx = cx - halfW
      const sy = cy - halfH
      try {
        ctx.globalAlpha = alpha
        ctx.drawImage(v, sx, sy, srcW, srcH, ox, oy, dw, dh)
      } catch {
        /* fotograma aún no decodificado */
      } finally {
        ctx.globalAlpha = 1
      }
    }

    const draw = () => {
      const cw = canvas.width
      const ch = canvas.height
      ctx.fillStyle = '#020617'
      ctx.fillRect(0, 0, cw, ch)

      const fade = programFadeRef.current
      const ms = crossfadeMsRef.current

      if (!fade || ms <= 0) {
        drawCamera(programCameraId, 1)
        rafRef.current = requestAnimationFrame(draw)
        return
      }

      const elapsed = performance.now() - fade.start
      if (elapsed >= ms) {
        programFadeRef.current = null
        settledProgramIdRef.current = fade.to
        drawCamera(fade.to, 1)
        rafRef.current = requestAnimationFrame(draw)
        return
      }

      const tLin = Math.min(1, elapsed / ms)
      /** Smoothstep: arranca y termina suave (más “cinematográfico” que lineal). */
      const t = tLin * tLin * (3 - 2 * tLin)
      drawCamera(fade.from, 1 - t)
      drawCamera(fade.to, t)
      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [programCameraId, clips])

  /** Lee el encuadre destino actual de la cámara visible (para mostrar % y reset). */
  const programFramingTarget = useMemo<CamFraming>(() => {
    if (!programCameraId) return FRAMING_NEUTRAL
    return framingTargetRef.current.get(programCameraId) ?? FRAMING_NEUTRAL
    // framingTick fuerza re-render al cambiar el target sin re-renderear en cada rAF.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programCameraId, framingTick])

  const updateFramingTarget = useCallback(
    (cameraId: string, mutator: (cur: CamFraming) => CamFraming) => {
      const cur = framingTargetRef.current.get(cameraId) ?? FRAMING_NEUTRAL
      const next = mutator(cur)
      const clamped: CamFraming = {
        zoom: Math.max(1, Math.min(4, next.zoom)),
        offsetX: Math.max(0, Math.min(1, next.offsetX)),
        offsetY: Math.max(0, Math.min(1, next.offsetY))
      }
      framingTargetRef.current.set(cameraId, clamped)
      setFramingTick((n) => n + 1)
    },
    []
  )

  const resetFraming = useCallback(
    (cameraId: string | null) => {
      if (!cameraId) return
      framingTargetRef.current.set(cameraId, { ...FRAMING_NEUTRAL })
      setFramingTick((n) => n + 1)
    },
    []
  )

  /**
   * Convierte (clientX, clientY) sobre el canvas en coords normalizadas (0..1) **del frame de video**,
   * teniendo en cuenta el rect del DOM, el letterbox del canvas y el zoom/offset actual.
   * Devuelve null si el punto cayó fuera del rect del video (en bandas negras).
   */
  const pointerToFrameNormalized = useCallback(
    (clientX: number, clientY: number): { nx: number; ny: number } | null => {
      const canvas = canvasRef.current
      if (!canvas || !programCameraId) return null
      const v = videoRefs.current.get(programCameraId)
      if (!v) return null
      const vw = v.videoWidth
      const vh = v.videoHeight
      if (!vw || !vh) return null
      const rect = canvas.getBoundingClientRect()
      const cssX = clientX - rect.left
      const cssY = clientY - rect.top
      const cw = canvas.width
      const ch = canvas.height
      /** Mapear CSS → coords internas del canvas (1280×720). */
      const px = (cssX / rect.width) * cw
      const py = (cssY / rect.height) * ch
      const fit = Math.min(cw / vw, ch / vh)
      const dw = vw * fit
      const dh = vh * fit
      const ox = (cw - dw) / 2
      const oy = (ch - dh) / 2
      if (px < ox || px > ox + dw || py < oy || py > oy + dh) return null
      const cur = framingTargetRef.current.get(programCameraId) ?? FRAMING_NEUTRAL
      const z = Math.max(1, Math.min(4, cur.zoom))
      /** Posición dentro del rect dibujado (0..1). */
      const u = (px - ox) / dw
      const w = (py - oy) / dh
      /** Tamaño visible del frame (en coords 0..1 del frame). */
      const srcW01 = 1 / z
      const srcH01 = 1 / z
      const halfW01 = srcW01 / 2
      const halfH01 = srcH01 / 2
      const cxN = Math.min(1 - halfW01, Math.max(halfW01, cur.offsetX))
      const cyN = Math.min(1 - halfH01, Math.max(halfH01, cur.offsetY))
      const sx01 = cxN - halfW01
      const sy01 = cyN - halfH01
      return { nx: sx01 + u * srcW01, ny: sy01 + w * srcH01 }
    },
    [programCameraId]
  )

  const onProgramWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (!programCameraId) return
      e.preventDefault()
      const ptr = pointerToFrameNormalized(e.clientX, e.clientY)
      const cur = framingTargetRef.current.get(programCameraId) ?? FRAMING_NEUTRAL
      /** Factor multiplicativo: scroll arriba acerca; mantiene sensación natural en trackpad/rueda. */
      const factor = Math.exp(-e.deltaY * 0.0015)
      const newZoom = Math.max(1, Math.min(4, cur.zoom * factor))
      if (newZoom === cur.zoom) return
      if (!ptr) {
        updateFramingTarget(programCameraId, (c) => ({ ...c, zoom: newZoom }))
        return
      }
      /**
       * Zoom anclado al cursor: queremos que el píxel bajo el cursor (en coords del frame)
       * se quede bajo el cursor. Si conocemos (nx, ny) del puntero antes del zoom y
       * el cursor está a (u,w) en el rect dibujado, despejamos el nuevo offsetX/Y:
       *   nx = (offsetX - 0.5/z') + u * (1/z')  →  offsetX = nx - u/z' + 0.5/z'
       * usando u≈w del nuevo rect (mismas u,w que pre-zoom, porque el rect destino no cambia).
       */
      const canvas = canvasRef.current!
      const v = videoRefs.current.get(programCameraId)!
      const vw = v.videoWidth
      const vh = v.videoHeight
      const cw = canvas.width
      const ch = canvas.height
      const rect = canvas.getBoundingClientRect()
      const cssX = e.clientX - rect.left
      const cssY = e.clientY - rect.top
      const px = (cssX / rect.width) * cw
      const py = (cssY / rect.height) * ch
      const fit = Math.min(cw / vw, ch / vh)
      const dw = vw * fit
      const dh = vh * fit
      const ox = (cw - dw) / 2
      const oy = (ch - dh) / 2
      const u = Math.min(1, Math.max(0, (px - ox) / dw))
      const w = Math.min(1, Math.max(0, (py - oy) / dh))
      const newOffsetX = ptr.nx - u / newZoom + 0.5 / newZoom
      const newOffsetY = ptr.ny - w / newZoom + 0.5 / newZoom
      updateFramingTarget(programCameraId, () => ({
        zoom: newZoom,
        offsetX: newOffsetX,
        offsetY: newOffsetY
      }))
    },
    [pointerToFrameNormalized, programCameraId, updateFramingTarget]
  )

  const onProgramMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!programCameraId) return
      if (e.button !== 0) return
      programDragRef.current = { startX: e.clientX, startY: e.clientY, moved: false }
    },
    [programCameraId]
  )

  const onProgramMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const drag = programDragRef.current
      if (!drag || !programCameraId) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      if (!drag.moved && Math.hypot(dx, dy) < 3) return
      drag.moved = true
      drag.startX = e.clientX
      drag.startY = e.clientY
      const canvas = canvasRef.current
      if (!canvas) return
      const v = videoRefs.current.get(programCameraId)
      if (!v) return
      const vw = v.videoWidth
      const vh = v.videoHeight
      if (!vw || !vh) return
      const rect = canvas.getBoundingClientRect()
      const cw = canvas.width
      const ch = canvas.height
      const fit = Math.min(cw / vw, ch / vh)
      const dw = vw * fit
      const dh = vh * fit
      /** dx en CSS → en frame normalizado: dividir por dw_css y luego por zoom. */
      const cssDxRatio = dx / (rect.width * (dw / cw))
      const cssDyRatio = dy / (rect.height * (dh / ch))
      const cur = framingTargetRef.current.get(programCameraId) ?? FRAMING_NEUTRAL
      const z = Math.max(1, Math.min(4, cur.zoom))
      updateFramingTarget(programCameraId, (c) => ({
        ...c,
        offsetX: c.offsetX - cssDxRatio / z,
        offsetY: c.offsetY - cssDyRatio / z
      }))
    },
    [programCameraId, updateFramingTarget]
  )

  const onProgramMouseUp = useCallback(() => {
    programDragRef.current = null
  }, [])

  const onProgramClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      /** Si el mouse arrastró (>3px), no es "clic puntual" → no centrar. */
      const drag = programDragRef.current
      if (drag?.moved) {
        programDragRef.current = null
        return
      }
      if (!programCameraId) return
      const ptr = pointerToFrameNormalized(e.clientX, e.clientY)
      if (!ptr) return
      updateFramingTarget(programCameraId, (c) => ({ ...c, offsetX: ptr.nx, offsetY: ptr.ny }))
    },
    [pointerToFrameNormalized, programCameraId, updateFramingTarget]
  )

  const onProgramDoubleClick = useCallback(() => {
    resetFraming(programCameraId)
  }, [programCameraId, resetFraming])

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
    setFusionExportTarget('webm')
    setFusionExportStartMs(Date.now())
    onStatus(`Guardando WebM: ${name} …`)
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
      setFusionExportTarget(null)
      setFusionExportStartMs(null)
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
    setFusionExportTarget('mp4')
    setFusionExportStartMs(Date.now())
    onStatus('Generando MP4 con FFmpeg (puede tardar según la duración)…')
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
      setFusionExportTarget(null)
      setFusionExportStartMs(null)
    }
  }, [fusionExportFileName, fusionPreviewUrl, outputDir, sessionId, onStatus])

  /**
   * Cierra por completo la sesión de Fusión (archivos): descarta pistas, plan, vista previa
   * y vuelve al estado vacío. No borra nada del disco. Pide confirmación.
   * Si hay una grabación o exportación en curso, avisa y no procede.
   */
  const closeFusionSession = useCallback(() => {
    if (fusionRecording) {
      onStatus('Finalizá la grabación antes de cerrar la sesión.')
      return
    }
    if (fusionExportBusy) {
      onStatus('Esperá a que termine la exportación antes de cerrar.')
      return
    }
    const empty = !clips.length && !audioUrl && !fusionPreviewUrl && !sessionId
    if (empty) return
    const ok = window.confirm(
      '¿Cerrar la sesión cargada en Fusión?\n\nSe descartan las pistas, el plan de cámara y la vista previa.\nLos archivos ya guardados en disco NO se borran.'
    )
    if (!ok) return

    pauseAll()
    if (fusionPreviewUrl) {
      try {
        URL.revokeObjectURL(fusionPreviewUrl)
      } catch {
        /* vacío */
      }
    }
    setFusionPreviewUrl(null)
    fusionPreviewBlobRef.current = null
    fusionPreviewMimeRef.current = undefined
    setFusionExportFileName('')
    setFusionSegmentsDone([])
    setOpenFusionSeg(null)
    setFusionRecorderPaused(false)
    setProgramCameraId(null)
    setSessionId(null)
    setAudioUrl(null)
    setClips([])
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setLoadErr(null)
    framingTargetRef.current.clear()
    framingCurrentRef.current.clear()
    videoRefs.current.clear()
    thumbVideoRefs.current.clear()
    onStatus('Sesión de fusión cerrada.')
  }, [
    audioUrl,
    clips.length,
    fusionExportBusy,
    fusionPreviewUrl,
    fusionRecording,
    onStatus,
    pauseAll,
    sessionId
  ])

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

  /**
   * Pantalla completa para la vista previa: usamos siempre el modo CSS (fixed + inset 0 + z-index alto).
   * Es 100% confiable en Electron (la Fullscreen API a veces falla en silencio dentro de algunos contextos)
   * y se cierra con el mismo botón o con Esc.
   */
  const toggleFusionPreviewFullscreen = useCallback(() => {
    /** Si por algún motivo entramos al fullscreen real del SO, salimos primero. */
    const fsEl = document.fullscreenElement
    if (fsEl) {
      void document.exitFullscreen?.().catch(() => {})
    }
    setFusionPreviewPseudoFullscreen((v) => !v)
  }, [])

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
    /** Prefiero la pista procesada por el EQ (siempre activa, en bypass cuando todas las bandas están a 0). */
    const eqTrack = audioGraph.processedTrack
    if (aEl && audioUrl && eqTrack) {
      outStream = new MediaStream([vidTrack, eqTrack])
    } else if (aEl && audioUrl) {
      try {
        /** Fallback si el grafo Web Audio no se montó (raro). */
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
  }, [
    audioGraph.processedTrack,
    audioUrl,
    clips,
    getMasterTime,
    onStatus,
    outputDir,
    playAll,
    playing,
    programCameraId
  ])

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
        <button
          type="button"
          onClick={() => setEqOpen((v) => !v)}
          disabled={!audioUrl}
          title={
            audioUrl
              ? 'Abre el ecualizador flotante (se aplica al audio antes de grabar la fusión).'
              : 'Cargá una sesión con audio (audio-*.webm) para usar el EQ.'
          }
          style={{
            ...btnAudio,
            opacity: audioUrl ? 1 : 0.5,
            cursor: audioUrl ? 'pointer' : 'not-allowed'
          }}
        >
          <span aria-hidden style={{ fontSize: 13 }}>≋</span>
          {audioGraph.gains.some((g) => Math.abs(g) > 0.05) && !audioGraph.bypass
            ? ' EQ · activo'
            : ' EQ'}
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
            ref={setAudioElCb}
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

            <div
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                justifyContent: 'center',
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
                title="Tiempo de fundido al cambiar de cámara. 0 = corte seco."
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
                  style={{ width: 140, verticalAlign: 'middle', accentColor: '#7dd3fc' }}
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
              {programCrossfadeMs > 0 ? (
                <button
                  type="button"
                  onClick={() => setProgramCrossfadeMs(0)}
                  title="Volver al corte seco"
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: '1px solid #334155',
                    background: '#0f172a',
                    color: '#cbd5e1',
                    fontSize: 11
                  }}
                >
                  Corte seco
                </button>
              ) : null}
            </div>

            <div className="fusion-preview-box">
              {/*
              Canvas centrado con proporción fija (evita estirar horizontal el bitmap).
              Los <video> siguen en .fusion-video-decoders solo para decodificar / drawImage.
              Mouse: rueda = zoom (anclado al cursor), arrastrar = pan, clic = centrar, doble clic = reset.
            */}
              <div className="fusion-preview-inner">
                <canvas
                  ref={canvasRef}
                  width={1280}
                  height={720}
                  onWheel={onProgramWheel}
                  onMouseDown={onProgramMouseDown}
                  onMouseMove={onProgramMouseMove}
                  onMouseUp={onProgramMouseUp}
                  onMouseLeave={onProgramMouseUp}
                  onClick={onProgramClick}
                  onDoubleClick={onProgramDoubleClick}
                  style={{
                    cursor: programCameraId
                      ? programFramingTarget.zoom > 1.001
                        ? 'grab'
                        : 'zoom-in'
                      : 'default',
                    touchAction: 'none'
                  }}
                />
              </div>
              {programCameraId ? (
                <div
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    zIndex: 2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 8px',
                    borderRadius: 8,
                    background: 'rgba(2, 6, 23, 0.72)',
                    border: '1px solid #1e293b',
                    color: '#e2e8f0',
                    fontSize: 11,
                    pointerEvents: 'auto'
                  }}
                  onMouseDown={(ev) => ev.stopPropagation()}
                  onDoubleClick={(ev) => ev.stopPropagation()}
                >
                  <span
                    title="Rueda = zoom · arrastrar = pan · clic = centrar · doble clic = reset"
                    style={{ color: '#94a3b8' }}
                  >
                    Encuadre
                  </span>
                  <span
                    style={{
                      fontVariantNumeric: 'tabular-nums',
                      color: programFramingTarget.zoom > 1.001 ? '#7dd3fc' : '#64748b',
                      minWidth: 36,
                      textAlign: 'right'
                    }}
                  >
                    {programFramingTarget.zoom.toFixed(2)}×
                  </span>
                  <button
                    type="button"
                    onClick={() => resetFraming(programCameraId)}
                    disabled={
                      programFramingTarget.zoom <= 1.001 &&
                      Math.abs(programFramingTarget.offsetX - 0.5) < 1e-3 &&
                      Math.abs(programFramingTarget.offsetY - 0.5) < 1e-3
                    }
                    title="Reset encuadre (doble clic también)"
                    style={{
                      padding: '2px 8px',
                      borderRadius: 6,
                      border: '1px solid #334155',
                      background: '#0f172a',
                      color: '#cbd5e1',
                      cursor: 'pointer',
                      fontSize: 11
                    }}
                  >
                    Reset
                  </button>
                </div>
              ) : null}
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
                        title={`${cameraAliases.resolve(seg.cameraId)} · ${fmt(seg.startSec)} → ${fmt(seg.endSec)}${
                          cameraAliases.resolve(seg.cameraId) !== seg.cameraId ? ` (${seg.cameraId})` : ''
                        }`}
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
                      <span style={{ color: '#94a3b8' }} title={cameraAliases.resolve(id) !== id ? id : undefined}>
                        {cameraAliases.resolve(id)}
                      </span>
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
                          opacity: fusionExportBusy ? 0.85 : 1,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 8
                        }}
                      >
                        {fusionExportTarget === 'webm' ? (
                          <>
                            <span className="studio-spinner" aria-hidden /> Guardando WebM…
                          </>
                        ) : (
                          'Guardar WebM'
                        )}
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
                          opacity: fusionExportBusy ? 0.85 : 1,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 8
                        }}
                      >
                        {fusionExportTarget === 'mp4' ? (
                          <>
                            <span className="studio-spinner" aria-hidden /> Generando MP4…
                          </>
                        ) : (
                          'Guardar MP4 (recomendado Windows)'
                        )}
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
                    {fusionExportTarget ? (
                      <div
                        role="status"
                        aria-live="polite"
                        style={{
                          marginTop: 10,
                          padding: '10px 12px',
                          borderRadius: 10,
                          border: fusionExportTarget === 'mp4' ? '1px solid #1d4ed8' : '1px solid #047857',
                          background: fusionExportTarget === 'mp4' ? '#0b1a3a' : '#062018',
                          color: fusionExportTarget === 'mp4' ? '#dbeafe' : '#bbf7d0',
                          fontSize: 12,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span className="studio-spinner lg" aria-hidden />
                          <div style={{ flex: 1, minWidth: 0, lineHeight: 1.45 }}>
                            <strong>
                              {fusionExportTarget === 'mp4' ? 'Generando MP4…' : 'Guardando WebM…'}
                            </strong>{' '}
                            {fusionExportTarget === 'mp4'
                              ? 'FFmpeg está re-codificando a H.264. Puede tardar bastante según la duración (no cierres la app).'
                              : 'Escribiendo el archivo en la carpeta de grabación.'}
                          </div>
                          <span
                            style={{
                              fontVariantNumeric: 'tabular-nums',
                              fontWeight: 700,
                              fontSize: 13
                            }}
                          >
                            {Math.floor(fusionExportElapsed / 1000)}s
                          </span>
                        </div>
                        <div className="studio-progress-bar" aria-hidden />
                      </div>
                    ) : null}
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
                      title={cameraAliases.resolve(c.cameraId) !== c.cameraId ? `ID: ${c.cameraId}` : undefined}
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
                      {cameraAliases.resolve(c.cameraId)}
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
                Finalizar grabación
              </button>
              {fusionRecording ? (
                <span style={{ fontSize: 12, fontWeight: 700, color: fusionRecorderPaused ? '#fdba74' : '#e9d5ff' }}>
                  {fusionRecorderPaused ? '■ PAUSA' : '● GRABANDO'}
                </span>
              ) : null}
              <button
                type="button"
                disabled={
                  fusionRecording ||
                  fusionExportBusy ||
                  (!clips.length && !audioUrl && !fusionPreviewUrl && !sessionId)
                }
                onClick={() => closeFusionSession()}
                title="Descarta las pistas cargadas, el plan y la vista previa (no borra archivos del disco)"
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: '1px solid #475569',
                  background: '#1f2937',
                  color: '#e2e8f0',
                  fontWeight: 600,
                  marginLeft: 'auto',
                  opacity:
                    fusionRecording ||
                    fusionExportBusy ||
                    (!clips.length && !audioUrl && !fusionPreviewUrl && !sessionId)
                      ? 0.45
                      : 1
                }}
              >
                Cancelar
              </button>
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
                    title={`Enviar ${cameraAliases.resolve(c.cameraId)} al programa${
                      cameraAliases.resolve(c.cameraId) !== c.cameraId ? ` · ID: ${c.cameraId}` : ''
                    }`}
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
                      {cameraAliases.resolve(c.cameraId)}
                    </div>
                  </button>
                ))}
              </div>
            </aside>
          ) : null}
        </div>
      ) : null}

      <FloatingEqualizerPanel
        open={eqOpen && Boolean(audioUrl)}
        onClose={() => setEqOpen(false)}
        graph={audioGraph}
        fusionRecording={fusionRecording}
      />
    </div>
  )
}
