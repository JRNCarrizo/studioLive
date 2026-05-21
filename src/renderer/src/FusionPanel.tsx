import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useCameraAliases } from './cameraAliases'
import { FloatingEqualizerPanel } from './FloatingEqualizerPanel'
import {
  btnAudio,
  btnNeutral,
  workspaceEyebrow,
  workspaceInnerCard
} from './workspaceChrome'

import {
  isFusionExportFileName,
  parseRecordingFileName,
  type ParsedRecordingName
} from './recordingFileNames'
import { useFusionAudioGraph } from './useFusionAudioGraph'
import { FusionProgramBackgroundTools } from './FusionProgramBackgroundTools'
import { FusionProgramTools } from './FusionProgramTools'
import { drawProgramBackground, resetProgramCanvas } from './programBackground'
import { useProgramBackground } from './useProgramBackground'
import { FusionSceneSwitcher } from './FusionSceneSwitcher'
import { FusionCameraPlanBar } from './FusionCameraPlanBar'
import {
  cameraAtFusionTime,
  fusionCameraColorMap,
  fusionSegmentColor,
  type FusionTimelineSegment
} from './fusionCameraPlan'
import { FusionStudioTransport } from './FusionStudioTransport'
import { GLYPH } from './uiGlyphs'
import { ProgramCropOverlay } from './ProgramCropOverlay'
import { ProgramLayoutEditorOverlay } from './ProgramLayoutEditorOverlay'
import {
  clampCrop,
  CROP_FULL,
  cropIsFull,
  drawCroppedFramedVideoInRect,
  clientToCropNormalized,
  panFramingByCssDeltaWithCrop,
  type CamCrop
} from './programCrop'
import {
  clampFraming,
  FRAMING_LERP_K,
  FRAMING_NEUTRAL,
  lerpFraming,
  type CamFraming
} from './programFraming'
import { getVideoFrameSize } from './videoFrameSize'
import { useProgramFramingGestures } from './useProgramFramingGestures'
import {
  buildDefaultLayoutAssignments,
  CANVAS_DIMS,
  aspectToOrientation,
  defaultEditableSlotIndex,
  getLayout,
  ORIENTATION_LABEL,
  clampNormalizedSlotRect,
  presetLayoutGeometry,
  isLayoutEdgeCropGeometry,
  slotVideoCoverAlign,
  videoAlignForEdgeCropHandle,
  unionNormalizedSlotRects,
  VIDEO_ALIGN_CENTER,
  PROGRAM_LAYOUTS,
  reconcileLayoutAssignments,
  resolveLayoutSlotRects,
  sceneSignature,
  parseSceneSignature,
  type LayoutAssignments,
  type LayoutEdgeCropHandle,
  type LayoutEdgeCropHandleMap,
  type LayoutGeometryMap,
  type LayoutId,
  type NormalizedSlotRect,
  type ProgramOrientation,
  type SlotRect
} from './programScenes'

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
}

export function FusionPanel({ outputDir, liveRecording, onStatus }: FusionPanelProps) {
  const cameraAliases = useCameraAliases()
  const { background: programBackground, backgroundRef: programBackgroundRef, setBackground: setProgramBackground } =
    useProgramBackground()
  const [clips, setClips] = useState<VideoClip[]>([])
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [programCameraId, setProgramCameraId] = useState<string | null>(null)
  const [programCrossfadeMs, setProgramCrossfadeMs] = useState(PROGRAM_CROSSFADE_MS_DEFAULT)
  /** Refs para que el rAF del dibujo lea los valores actuales sin reabrir el efecto. */
  const crossfadeMsRef = useRef(programCrossfadeMs)
  const programFadeRef = useRef<ProgramFade | null>(null)
  /** Firma de escena asentada (crossfade entre layouts / composiciones). */
  const settledSceneSigRef = useRef<string | null>(null)
  const [programLayoutId, setProgramLayoutId] = useState<LayoutId>('single')
  const [programSlots, setProgramSlots] = useState<(string | null)[]>([null])
  const [layoutAssignments, setLayoutAssignments] = useState<LayoutAssignments>(() =>
    buildDefaultLayoutAssignments([])
  )
  const [layoutGeometry, setLayoutGeometry] = useState<LayoutGeometryMap>({})
  const layoutGeometryRef = useRef<LayoutGeometryMap>({})
  const [layoutGeometryCeiling, setLayoutGeometryCeiling] = useState<LayoutGeometryMap>({})
  const layoutGeometryCeilingRef = useRef<LayoutGeometryMap>({})
  const [layoutGeometryTick, setLayoutGeometryTick] = useState(0)
  const layoutEdgeCropHandleRef = useRef<LayoutEdgeCropHandleMap>({})
  const activeLayoutEdgeCropRef = useRef<{
    slotIndex: number
    handle: LayoutEdgeCropHandle
  } | null>(null)
  const [selectedLayoutSlot, setSelectedLayoutSlot] = useState(0)
  const [editingLayoutId, setEditingLayoutId] = useState<LayoutId>('single')
  const [orientationSuggestionDismissed, setOrientationSuggestionDismissed] = useState(false)
  const [configPopoverOpen, setConfigPopoverOpen] = useState(false)
  const [cameraAspects, setCameraAspects] = useState<Record<string, { w: number; h: number }>>({})
  const programLayoutIdRef = useRef<LayoutId>('single')
  const programSlotsRef = useRef<(string | null)[]>([null])
  const cameraIdsRef = useRef<string[]>([])
  useEffect(() => {
    crossfadeMsRef.current = programCrossfadeMs
  }, [programCrossfadeMs])
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [fusionRecording, setFusionRecording] = useState(false)
  /** Vista de fuentes: miniaturas al costado del programa (como Fusión en vivo). */
  const selectorMode = 'thumbnails' as const
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
  const [programOrientation, setProgramOrientation] = useState<ProgramOrientation>('landscape')
  const [cropEditOpen, setCropEditOpen] = useState(false)
  const cropEditOpenRef = useRef(false)
  useEffect(() => {
    cropEditOpenRef.current = cropEditOpen
  }, [cropEditOpen])
  useEffect(() => {
    programLayoutIdRef.current = programLayoutId
  }, [programLayoutId])
  useEffect(() => {
    programSlotsRef.current = programSlots
  }, [programSlots])
  useEffect(() => {
    layoutGeometryRef.current = layoutGeometry
  }, [layoutGeometry])
  useEffect(() => {
    layoutGeometryCeilingRef.current = layoutGeometryCeiling
  }, [layoutGeometryCeiling])

  const applySlotEdgeCropHandle = useCallback(
    (layoutId: LayoutId, slotIndex: number, handle: LayoutEdgeCropHandle | null) => {
      if (handle) {
        activeLayoutEdgeCropRef.current = { slotIndex, handle }
      } else if (activeLayoutEdgeCropRef.current?.slotIndex === slotIndex) {
        activeLayoutEdgeCropRef.current = null
      }
      const n = getLayout(layoutId).slotsCount
      const base = [...(layoutEdgeCropHandleRef.current[layoutId] ?? [])]
      while (base.length < n) base.push(null)
      base[slotIndex] = handle
      layoutEdgeCropHandleRef.current = { ...layoutEdgeCropHandleRef.current, [layoutId]: base }
    },
    []
  )

  const cropTargetRef = useRef<Map<string, CamCrop>>(new Map())
  const [cropTick, setCropTick] = useState(0)
  const [manualRotateDeg, setManualRotateDeg] = useState<Record<string, number>>({})
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
  /** Inicio del export en ms — para mostrar tiempo transcurrido mientras dura la operación. */
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
   * Cadena Web Audio para el audio de fusión: audio → EQ → parlantes + grabador.
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

  const handleCameraAspect = useCallback((id: string, w: number, h: number) => {
    setCameraAspects((prev) => {
      const cur = prev[id]
      if (cur && cur.w === w && cur.h === h) return prev
      return { ...prev, [id]: { w, h } }
    })
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

  const reportVideoAspect = useCallback(
    (cameraId: string, el: HTMLVideoElement) => {
      refreshDuration()
      const { vw, vh } = getVideoFrameSize(el)
      if (vw && vh) handleCameraAspect(cameraId, vw, vh)
    },
    [handleCameraAspect, refreshDuration]
  )

  const getMasterTime = useCallback(() => {
    const master =
      audioUrl && audioRef.current
        ? audioRef.current
        : clips[0]
          ? videoRefs.current.get(clips[0].cameraId)
          : undefined
    return master?.currentTime ?? 0
  }, [audioUrl, clips])

  /** Tiempo 0…N dentro de la toma de fusión (no la línea maestra de las pistas). */
  const getFusionPlanTimeSec = useCallback(() => {
    return Math.max(0, getMasterTime() - fusionRecordStartSecRef.current)
  }, [getMasterTime])

  const applyProgramScene = useCallback((nextLayoutId: LayoutId, nextSlots: (string | null)[]) => {
    const layout = getLayout(nextLayoutId)
    const slots = nextSlots.slice(0, layout.slotsCount)
    while (slots.length < layout.slotsCount) slots.push(null)
    setProgramLayoutId(nextLayoutId)
    setProgramSlots(slots)
    if (nextLayoutId === 'single' && slots[0]) {
      setProgramCameraId(slots[0])
    }
  }, [])

  const ensureLayoutGeometry = useCallback(
    (layoutId: LayoutId) => {
      const dim = CANVAS_DIMS[programOrientation]
      const preset = presetLayoutGeometry(layoutId, dim.w, dim.h)
      setLayoutGeometry((prev) => {
        const cur = prev[layoutId]
        const n = getLayout(layoutId).slotsCount
        if (cur?.length === n) return prev
        return { ...prev, [layoutId]: preset }
      })
      setLayoutGeometryCeiling((prev) => {
        const cur = prev[layoutId]
        const n = getLayout(layoutId).slotsCount
        if (cur?.length === n) return prev
        return { ...prev, [layoutId]: preset.map((r) => ({ ...r })) }
      })
      setLayoutGeometryTick((t) => t + 1)
    },
    [programOrientation]
  )

  const sendLayoutToProgram = useCallback(
    (layoutId: LayoutId) => {
      const layout = getLayout(layoutId)
      const saved = layoutAssignments[layoutId] ?? []
      const ids = cameraIdsRef.current
      const slots: (string | null)[] = []
      const used = new Set<string>()
      for (let i = 0; i < layout.slotsCount; i++) {
        const wanted = saved[i] ?? null
        if (wanted && ids.includes(wanted)) {
          slots.push(wanted)
          used.add(wanted)
          continue
        }
        const pick = ids.find((cid) => !used.has(cid)) ?? ids[0] ?? null
        if (pick) used.add(pick)
        slots.push(pick)
      }
      applyProgramScene(layoutId, slots)
      if (layoutId !== 'single') {
        ensureLayoutGeometry(layoutId)
        setSelectedLayoutSlot(defaultEditableSlotIndex(layoutId))
      }
    },
    [applyProgramScene, ensureLayoutGeometry, layoutAssignments]
  )

  const setSlotForLayout = useCallback(
    (layoutId: LayoutId, slotIdx: number, cameraId: string | null) => {
      setLayoutAssignments((prev) => {
        const cur = prev[layoutId] ?? []
        if (cur[slotIdx] === cameraId) return prev
        const next = cur.slice()
        next[slotIdx] = cameraId
        return { ...prev, [layoutId]: next }
      })
      if (programLayoutIdRef.current === layoutId) {
        const live = programSlotsRef.current.slice()
        if (live[slotIdx] !== cameraId) {
          live[slotIdx] = cameraId
          applyProgramScene(layoutId, live)
        }
      }
    },
    [applyProgramScene]
  )

  const pickProgramCamera = useCallback(
    (id: string) => {
      setLayoutAssignments((p) => ({ ...p, single: [id] }))
      applyProgramScene('single', [id])
    },
    [applyProgramScene]
  )

  const fusionPlanAirId =
    programLayoutId === 'single' ? programCameraId : (programSlots[0] ?? null)

  useEffect(() => {
    if (!fusionRecording) return
    const air = fusionPlanAirId
    const t = getFusionPlanTimeSec()
    setOpenFusionSeg((open) => {
      if (open?.cameraId === air) return open
      if (open) {
        setFusionSegmentsDone((prev) => [
          ...prev,
          { startSec: open.startSec, endSec: t, cameraId: open.cameraId }
        ])
      }
      return air ? { cameraId: air, startSec: t } : null
    })
  }, [fusionPlanAirId, fusionRecording, getFusionPlanTimeSec])

  const assignCameraToProgram = useCallback(
    (cameraId: string) => {
      if (programLayoutId !== 'single') {
        setSlotForLayout(programLayoutId, selectedLayoutSlot, cameraId)
        return
      }
      pickProgramCamera(cameraId)
    },
    [pickProgramCamera, programLayoutId, selectedLayoutSlot, setSlotForLayout]
  )

  const fusionPlanTimeSec = useMemo(() => {
    if (fusionRecording) return getFusionPlanTimeSec()
    let max = 0
    for (const s of fusionSegmentsDone) max = Math.max(max, s.endSec)
    return max
  }, [fusionRecording, fusionSegmentsDone, currentTime, getFusionPlanTimeSec])

  const timelineSegments = useMemo(() => {
    const out = [...fusionSegmentsDone]
    if (fusionRecording && openFusionSeg) {
      out.push({
        startSec: openFusionSeg.startSec,
        endSec: fusionPlanTimeSec,
        cameraId: openFusionSeg.cameraId
      })
    }
    return out
  }, [fusionSegmentsDone, fusionRecording, openFusionSeg, fusionPlanTimeSec])

  const timelineScaleDuration = useMemo(() => {
    if (fusionRecording || fusionSegmentsDone.length > 0) {
      let max = fusionPlanTimeSec
      for (const s of timelineSegments) {
        max = Math.max(max, s.endSec, s.startSec)
      }
      return Math.max(max, 0.5)
    }
    const d = Number.isFinite(duration) && duration > 0 ? duration : 0
    return d > 0 ? d : 1
  }, [duration, fusionPlanTimeSec, fusionRecording, fusionSegmentsDone.length, timelineSegments])

  const fusionCameraColors = useMemo(() => {
    const ids = new Set<string>()
    for (const c of clips) ids.add(c.cameraId)
    for (const s of fusionSegmentsDone) ids.add(s.cameraId)
    if (openFusionSeg) ids.add(openFusionSeg.cameraId)
    return fusionCameraColorMap(ids)
  }, [clips, fusionSegmentsDone, openFusionSeg])

  const cameraIds = useMemo(() => clips.map((c) => c.cameraId), [clips])

  const currentSceneSig = useMemo(
    () => sceneSignature({ layoutId: programLayoutId, slots: programSlots }),
    [programLayoutId, programSlots]
  )

  const suggestedOrientation = useMemo<ProgramOrientation | null>(() => {
    if (cameraIds.length === 0) return null
    const orientations = new Set<ProgramOrientation>()
    for (const id of cameraIds) {
      const dim = cameraAspects[id]
      if (!dim) return null
      orientations.add(aspectToOrientation(dim.w, dim.h))
    }
    if (orientations.size !== 1) return null
    const only = [...orientations][0]!
    if (only === programOrientation) return null
    return only
  }, [cameraIds, cameraAspects, programOrientation])

  useEffect(() => {
    if (suggestedOrientation) setOrientationSuggestionDismissed(false)
  }, [suggestedOrientation])

  useEffect(() => {
    if (!configPopoverOpen) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setConfigPopoverOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [configPopoverOpen])

  useEffect(() => {
    cameraIdsRef.current = cameraIds
    setLayoutAssignments((prev) => reconcileLayoutAssignments(prev, cameraIds))
    if (!cameraIds.length) {
      setProgramSlots((prev) => prev.map(() => null))
      return
    }
    setProgramSlots((prev) => {
      const layout = getLayout(programLayoutIdRef.current)
      const slots: (string | null)[] = []
      const used = new Set<string>()
      let changed = false
      for (let i = 0; i < layout.slotsCount; i++) {
        const want = prev[i] ?? null
        if (want && cameraIds.includes(want) && !used.has(want)) {
          slots.push(want)
          used.add(want)
          continue
        }
        const pick = cameraIds.find((cid) => !used.has(cid)) ?? cameraIds[0] ?? null
        if (pick) used.add(pick)
        slots.push(pick)
        if (pick !== want) changed = true
      }
      if (!changed && slots.length === prev.length && slots.every((s, i) => s === prev[i])) return prev
      return slots
    })
  }, [cameraIds])

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
            'Ese archivo es una fusión ya exportada (fusion-*.webm). Acá cargá las pistas del paso 1: los cam-*.webm de cada cámara y, si tenés, el audio-*.webm � no el archivo fusion.'
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
    const camIds = cams.map((c) => c.cameraId)
    setLayoutAssignments(buildDefaultLayoutAssignments(camIds))
    setProgramLayoutId('single')
    setProgramSlots([camIds[0] ?? null])
    setProgramCameraId(camIds[0]!)
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
          /** Miniatura: umbral más holgado que la ISO grande (menos �Stemblor⬝ por jitter del decodificador). */
          if (!th.ended && Math.abs(th.currentTime - t) > 0.38) th.currentTime = t
          /** `play()` con `ended` rebobina al inicio �  loop con el seek al final del maestro. */
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

  /** Fundido al cambiar escena (cámara o layout multi-slot). */
  useLayoutEffect(() => {
    const targetSig = currentSceneSig
    if (!targetSig) {
      settledSceneSigRef.current = null
      programFadeRef.current = null
      return
    }

    if (crossfadeMsRef.current <= 0) {
      settledSceneSigRef.current = targetSig
      programFadeRef.current = null
      return
    }

    const mid = programFadeRef.current
    const sourceFrom = mid && mid.to !== targetSig ? mid.to : settledSceneSigRef.current

    if (sourceFrom === targetSig) {
      if (!mid) settledSceneSigRef.current = targetSig
      return
    }

    if (sourceFrom == null) {
      settledSceneSigRef.current = targetSig
      programFadeRef.current = null
      return
    }

    programFadeRef.current = { from: sourceFrom, to: targetSig, start: performance.now() }
  }, [currentSceneSig, programCrossfadeMs])

  /**
   * Dibujo programa �  canvas (layouts multi-slot + recorte/zoom como Fusión en vivo).
   */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const off = document.createElement('canvas')
    const offCtx = off.getContext('2d')
    if (!offCtx) return

    let cancelled = false
    let rafId = 0

    const drawVideoInRect = (
      target: CanvasRenderingContext2D,
      cameraId: string,
      rect: SlotRect,
      slotNorm?: NormalizedSlotRect,
      ceilingNorm?: NormalizedSlotRect,
      canvasW?: number,
      canvasH?: number,
      slotIndex?: number
    ) => {
      const v = videoRefs.current.get(cameraId)
      if (!v || v.readyState < 1) return
      target.save()
      try {
        const cw = rect.w
        const ch = rect.h
        target.beginPath()
        target.rect(rect.x, rect.y, cw, ch)
        target.clip()
        /** No pintar negro: el lienzo ya trae fondo (`drawProgramBackground`); así se ven bandas/meta en ´contain´ */
        const rot = manualRotateDeg[cameraId] ?? 0
        const { vw, vh } = getVideoFrameSize(v)
        if (!vw || !vh) return
        const layoutId = programLayoutIdRef.current
        let slotFit: 'contain' | 'cover' = 'contain'
        let slotAlign = VIDEO_ALIGN_CENTER
        let coverScaleRect: SlotRect | undefined
        if (layoutId !== 'single' && slotNorm && canvasW != null && canvasH != null) {
          slotFit = 'cover'
          const ceil = clampNormalizedSlotRect(ceilingNorm ?? slotNorm)
          const activeEdge =
            slotIndex != null && activeLayoutEdgeCropRef.current?.slotIndex === slotIndex
              ? activeLayoutEdgeCropRef.current.handle
              : null
          const storedEdge =
            slotIndex != null ? layoutEdgeCropHandleRef.current[layoutId]?.[slotIndex] ?? null : null
          const edgeHandle = activeEdge ?? storedEdge
          const edgeCrop = edgeHandle != null || isLayoutEdgeCropGeometry(slotNorm, ceil)
          if (edgeCrop) {
            slotAlign = edgeHandle
              ? videoAlignForEdgeCropHandle(edgeHandle)
              : slotVideoCoverAlign(slotNorm, ceil)
            coverScaleRect = {
              x: Math.round(ceil.x * canvasW),
              y: Math.round(ceil.y * canvasH),
              w: Math.max(1, Math.round(ceil.w * canvasW)),
              h: Math.max(1, Math.round(ceil.h * canvasH))
            }
          } else {
            slotAlign = VIDEO_ALIGN_CENTER
          }
        }
        const cropEditing =
          cropEditOpenRef.current &&
          programLayoutIdRef.current === 'single' &&
          programSlotsRef.current[0] === cameraId
        if (cropEditing) {
          drawCroppedFramedVideoInRect(
            target,
            v,
            rect,
            CROP_FULL,
            FRAMING_NEUTRAL,
            rot,
            1,
            slotFit,
            slotAlign,
            coverScaleRect,
            vw,
            vh
          )
        } else {
          const crop = cropTargetRef.current.get(cameraId) ?? CROP_FULL
          const tgt = framingTargetRef.current.get(cameraId) ?? FRAMING_NEUTRAL
          const cur = framingCurrentRef.current.get(cameraId) ?? FRAMING_NEUTRAL
          const next = lerpFraming(cur, tgt, FRAMING_LERP_K)
          framingCurrentRef.current.set(cameraId, next)
          drawCroppedFramedVideoInRect(
            target,
            v,
            rect,
            crop,
            next,
            rot,
            1,
            slotFit,
            slotAlign,
            coverScaleRect,
            vw,
            vh
          )
        }
      } catch {
        /* frame no listo */
      } finally {
        target.restore()
      }
    }

    const renderSceneInto = (target: CanvasRenderingContext2D, sig: string, cw: number, ch: number) => {
      resetProgramCanvas(target, cw, ch)
      drawProgramBackground({
        ctx: target,
        cw,
        ch,
        background: programBackgroundRef.current,
        getVideo: (id) => videoRefs.current.get(id),
        getRotateDeg: (id) => manualRotateDeg[id] ?? 0
      })
      const sc = parseSceneSignature(sig)
      const rects = resolveLayoutSlotRects(sc.layoutId, cw, ch, layoutGeometryRef.current[sc.layoutId])
      const geomNorm = layoutGeometryRef.current[sc.layoutId]
      const ceilNorm = layoutGeometryCeilingRef.current[sc.layoutId]
      for (let i = 0; i < rects.length; i++) {
        const id = sc.slots[i] ?? null
        if (!id) continue
        drawVideoInRect(
          target,
          id,
          rects[i]!,
          geomNorm?.[i],
          ceilNorm?.[i] ?? geomNorm?.[i],
          cw,
          ch,
          i
        )
      }
    }

    const drawOnce = () => {
      const cw = canvas.width
      const ch = canvas.height
      const targetSig = sceneSignature({
        layoutId: programLayoutIdRef.current,
        slots: programSlotsRef.current
      })
      const fade = programFadeRef.current
      const ms = crossfadeMsRef.current

      if (!fade || ms <= 0 || !targetSig) {
        renderSceneInto(ctx, targetSig, cw, ch)
        return
      }

      const elapsed = performance.now() - fade.start
      if (elapsed >= ms) {
        programFadeRef.current = null
        settledSceneSigRef.current = fade.to
        renderSceneInto(ctx, fade.to, cw, ch)
        return
      }

      if (off.width !== cw) off.width = cw
      if (off.height !== ch) off.height = ch

      const tLin = Math.min(1, elapsed / ms)
      const t = tLin * tLin * (3 - 2 * tLin)

      renderSceneInto(ctx, fade.from, cw, ch)
      renderSceneInto(offCtx, fade.to, cw, ch)
      ctx.globalAlpha = t
      ctx.drawImage(off, 0, 0)
      ctx.globalAlpha = 1
    }

    const scheduleNext = () => {
      if (cancelled) return
      rafId = requestAnimationFrame(() => {
        if (cancelled) return
        drawOnce()
        scheduleNext()
      })
    }

    scheduleNext()

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
    }
  }, [clips, manualRotateDeg, cropTick, programOrientation])

  /** Lee el encuadre destino actual de la cámara visible (para mostrar % y reset). */
  const programFramingTarget = useMemo<CamFraming>(() => {
    if (!programCameraId) return FRAMING_NEUTRAL
    return framingTargetRef.current.get(programCameraId) ?? FRAMING_NEUTRAL
    // framingTick fuerza re-render al cambiar el target sin re-renderear en cada rAF.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programCameraId, framingTick])

  const applyFraming = useCallback((cameraId: string, next: CamFraming) => {
    const clamped = clampFraming(next)
    framingTargetRef.current.set(cameraId, clamped)
    framingCurrentRef.current.set(cameraId, clamped)
    setFramingTick((n) => n + 1)
  }, [])

  const updateFramingTarget = useCallback(
    (cameraId: string, mutator: (cur: CamFraming) => CamFraming) => {
      const cur = framingTargetRef.current.get(cameraId) ?? FRAMING_NEUTRAL
      applyFraming(cameraId, mutator(cur))
    },
    [applyFraming]
  )

  const resetFraming = useCallback(
    (cameraId: string | null) => {
      if (!cameraId) return
      applyFraming(cameraId, { ...FRAMING_NEUTRAL })
    },
    [applyFraming]
  )

  const programCrop = useMemo<CamCrop>(() => {
    if (!programCameraId) return CROP_FULL
    return cropTargetRef.current.get(programCameraId) ?? CROP_FULL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programCameraId, cropTick])

  const programRotateDeg = programCameraId ? (manualRotateDeg[programCameraId] ?? 0) : 0
  const framingEditable = programLayoutId === 'single' && programCameraId != null
  const layoutEditable = programLayoutId !== 'single'

  const activeLayoutGeometry = useMemo((): NormalizedSlotRect[] => {
    const dim = CANVAS_DIMS[programOrientation]
    const stored = layoutGeometry[programLayoutId]
    if (stored?.length === getLayout(programLayoutId).slotsCount) return stored
    return presetLayoutGeometry(programLayoutId, dim.w, dim.h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programLayoutId, programOrientation, layoutGeometry, layoutGeometryTick])

  const activeLayoutGeometryCeiling = useMemo((): NormalizedSlotRect[] => {
    const dim = CANVAS_DIMS[programOrientation]
    const stored = layoutGeometryCeiling[programLayoutId]
    if (stored?.length === getLayout(programLayoutId).slotsCount) return stored
    return presetLayoutGeometry(programLayoutId, dim.w, dim.h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programLayoutId, programOrientation, layoutGeometryCeiling, layoutGeometryTick])

  const updateCrop = useCallback((cameraId: string, next: CamCrop) => {
    cropTargetRef.current.set(cameraId, clampCrop(next))
    setCropTick((n) => n + 1)
  }, [])

  const resetCrop = useCallback((cameraId: string | null) => {
    if (!cameraId) return
    cropTargetRef.current.set(cameraId, { ...CROP_FULL })
    setCropTick((n) => n + 1)
  }, [])

  const toggleCropEdit = useCallback(() => {
    const next = !cropEditOpenRef.current
    cropEditOpenRef.current = next
    setCropEditOpen(next)
    if (programCameraId) {
      const neutral = { ...FRAMING_NEUTRAL }
      framingTargetRef.current.set(programCameraId, neutral)
      framingCurrentRef.current.set(programCameraId, neutral)
      setFramingTick((n) => n + 1)
    }
  }, [programCameraId])

  const bumpRotate = useCallback((cameraId: string) => {
    setManualRotateDeg((prev) => ({
      ...prev,
      [cameraId]: ((prev[cameraId] ?? 0) + 90) % 360
    }))
  }, [])

  const removeClipFromSession = useCallback(
    (cameraId: string) => {
      setClips((prev) => {
        const next = prev.filter((c) => c.cameraId !== cameraId)
        if (programCameraId === cameraId) {
          setProgramCameraId(next[0]?.cameraId ?? null)
        }
        return next
      })
      cropTargetRef.current.delete(cameraId)
      framingTargetRef.current.delete(cameraId)
      framingCurrentRef.current.delete(cameraId)
      setManualRotateDeg((prev) => {
        const n = { ...prev }
        delete n[cameraId]
        return n
      })
    },
    [programCameraId]
  )

  useEffect(() => {
    if (!programCameraId) return
    const v = videoRefs.current.get(programCameraId)
    if (!v?.videoWidth) return
    const want = aspectToOrientation(v.videoWidth, v.videoHeight)
    setProgramOrientation((cur) => (cur === want ? cur : want))
  }, [programCameraId, clips])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dim = CANVAS_DIMS[programOrientation]
    if (canvas.width !== dim.w || canvas.height !== dim.h) {
      canvas.width = dim.w
      canvas.height = dim.h
    }
  }, [programOrientation])

  useProgramFramingGestures({
    enabled: framingEditable && !cropEditOpen,
    cameraId: programCameraId,
    canvasRef,
    getVideo: (id) => videoRefs.current.get(id),
    getCrop: (id) => cropTargetRef.current.get(id) ?? CROP_FULL,
    getFraming: (id) => framingTargetRef.current.get(id) ?? FRAMING_NEUTRAL,
    applyFraming,
    rotateDeg: programRotateDeg,
    programDragRef
  })

  const onProgramMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!programCameraId || cropEditOpen) return
      if (e.button !== 0) return
      programDragRef.current = { startX: e.clientX, startY: e.clientY, moved: false }
    },
    [cropEditOpen, programCameraId]
  )

  const onProgramMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const drag = programDragRef.current
      if (!drag || !programCameraId || cropEditOpen) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      if (!drag.moved && Math.hypot(dx, dy) < 3) return
      drag.moved = true
      drag.startX = e.clientX
      drag.startY = e.clientY
      const canvas = canvasRef.current
      const v = videoRefs.current.get(programCameraId)
      if (!canvas || !v) return
      const crop = cropTargetRef.current.get(programCameraId) ?? CROP_FULL
      const cur = framingTargetRef.current.get(programCameraId) ?? FRAMING_NEUTRAL
      const next = panFramingByCssDeltaWithCrop({
        dx,
        dy,
        canvas,
        video: v,
        crop,
        cur,
        rotateDeg: programRotateDeg
      })
      applyFraming(programCameraId, next)
    },
    [applyFraming, cropEditOpen, programCameraId, programRotateDeg]
  )

  const onProgramMouseUp = useCallback(() => {
    programDragRef.current = null
  }, [])

  const onProgramClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const drag = programDragRef.current
      if (drag?.moved) {
        programDragRef.current = null
        return
      }
      if (!programCameraId || cropEditOpen) return
      const canvas = canvasRef.current
      const v = videoRefs.current.get(programCameraId)
      if (!canvas || !v) return
      const crop = cropTargetRef.current.get(programCameraId) ?? CROP_FULL
      const cur = framingTargetRef.current.get(programCameraId) ?? FRAMING_NEUTRAL
      const ptr = clientToCropNormalized(
        e.clientX,
        e.clientY,
        canvas,
        v,
        crop,
        cur,
        programRotateDeg
      )
      if (!ptr) return
      applyFraming(programCameraId, { ...cur, offsetX: ptr.nx, offsetY: ptr.ny })
    },
    [applyFraming, cropEditOpen, programCameraId, programRotateDeg]
  )

  const onProgramDoubleClick = useCallback(() => {
    if (cropEditOpen) return
    resetFraming(programCameraId)
  }, [cropEditOpen, programCameraId, resetFraming])


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
        const rel = Math.max(0, x - fusionRecordStartSecRef.current)
        const cam = cameraAtFusionTime(rel, fusionSegmentsDone)
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
   * (0.25 en ISO / lógica distinta en thumbs) �  seeks en bucle en una miniatura; tras varias vistas previa canceladas se notaba más.
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
    const tEnd = getFusionPlanTimeSec()
    setOpenFusionSeg((open) => {
      if (open) {
        setFusionSegmentsDone((prev) => [
          ...prev,
          { startSec: open.startSec, endSec: tEnd, cameraId: open.cameraId }
        ])
      }
      return null
    })
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
  }, [fusionPreviewUrl, getFusionPlanTimeSec, onStatus, pauseAll, sessionId])

  /** Fin de la pista maestra: si `playing` queda true, el tick sigue haciendo play/seek en miniaturas `ended` �  salto en bucle. */
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
    onStatus(`Guardando WebM: ${name}${GLYPH.ellipsis}`)
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
    onStatus(`Generando MP4 con FFmpeg (puede tardar según la duración)${GLYPH.ellipsis}`)
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
    /** Sin timeslice: un solo `dataavailable` al parar � evita trabajo cada ~100 ms que tironeaba el hilo principal. */
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
    fusionPlanAirId,
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
          Cargar pistas WebM{GLYPH.ellipsis}
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
          <span aria-hidden style={{ fontSize: 14 }}>{GLYPH.eq}</span>
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
          <div className="fusion-program-heading">
            <div style={{ textAlign: 'center', margin: '0 auto', maxWidth: 560 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>Programa (salida)</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, lineHeight: 1.45 }}>
                Mezcla de las grabaciones cargadas. Elegí la escena con la barra izquierda del programa y las
                cámaras en las fuentes a la derecha.
                {programLayoutId === 'single' ? (
                  <>
                    {' '}
                    <strong>Recorte</strong> / <strong>Zoom</strong>: pellizco y mover a la vez (sin
                    soltar); clic y arrastrar en zoom.
                  </>
                ) : (
                  <>
                    {' '}
                    En multi-cámara: tocá un recuadro en el programa y asigná con la miniatura.
                  </>
                )}
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
            <div className="fusion-program-heading-sources">
              Fuentes (tocá = al programa)
            </div>
          </div>

          <div className="fusion-stage">
            <div className="fusion-main-flow">
            <div className="fusion-preview-row">
            <div className="fusion-preview-column">
              <div className="fusion-program-layout">
                {clips.length > 0 ? (
                  <aside className="fusion-program-rail fusion-program-rail--left">
                    <FusionSceneSwitcher
                      programLayoutId={programLayoutId}
                      onOpenConfig={() => setConfigPopoverOpen(true)}
                      onSelectLayout={sendLayoutToProgram}
                      showOrientationDot={!!suggestedOrientation && !orientationSuggestionDismissed}
                      programRecording={fusionRecording}
                    />
                  </aside>
                ) : null}
                <div className="fusion-program-center">
                <div
                  className={`fusion-preview-box fusion-preview-box--${programOrientation}`}
                  style={{
                    aspectRatio: `${CANVAS_DIMS[programOrientation].w}/${CANVAS_DIMS[programOrientation].h}`
                  }}
                >
                  <div className="fusion-preview-inner">
                    <div className="fusion-preview-canvas-wrap">
                  <canvas
                    ref={canvasRef}
                    width={CANVAS_DIMS[programOrientation].w}
                    height={CANVAS_DIMS[programOrientation].h}
                    onMouseDown={onProgramMouseDown}
                    onMouseMove={onProgramMouseMove}
                    onMouseUp={onProgramMouseUp}
                    onMouseLeave={onProgramMouseUp}
                    onClick={onProgramClick}
                    onDoubleClick={onProgramDoubleClick}
                    style={{
                      cursor:
                        framingEditable && !cropEditOpen
                          ? programFramingTarget.zoom > 1.001
                            ? 'grab'
                            : 'zoom-in'
                          : 'default',
                      touchAction: 'none',
                      pointerEvents: cropEditOpen || layoutEditable ? 'none' : 'auto'
                    }}
                  />
                  {layoutEditable && !cropEditOpen ? (
                    <ProgramLayoutEditorOverlay
                      canvas={canvasRef.current}
                      layoutId={programLayoutId}
                      orientation={programOrientation}
                      geometry={activeLayoutGeometry}
                      geometryCeiling={activeLayoutGeometryCeiling}
                      selectedSlotIndex={selectedLayoutSlot}
                      slotCameraIds={programSlots}
                      resolveAlias={cameraAliases.resolve}
                      onSelectSlot={setSelectedLayoutSlot}
                      onGeometryChange={(next) => {
                        setLayoutGeometry((prev) => ({ ...prev, [programLayoutId]: next }))
                        setLayoutGeometryTick((t) => t + 1)
                      }}
                      onSlotCeilingChange={(slotIndex, ceiling) => {
                        setLayoutGeometryCeiling((prev) => {
                          const n = getLayout(programLayoutId).slotsCount
                          const base = [...(prev[programLayoutId] ?? [])]
                          while (base.length < n) base.push(ceiling)
                          const prevC = base[slotIndex] ?? ceiling
                          base[slotIndex] = unionNormalizedSlotRects(prevC, ceiling)
                          const next = { ...prev, [programLayoutId]: base }
                          layoutGeometryCeilingRef.current = next
                          return next
                        })
                      }}
                      onSlotCeilingTranslate={(slotIndex, ceiling) => {
                        setLayoutGeometryCeiling((prev) => {
                          const n = getLayout(programLayoutId).slotsCount
                          const base = [...(prev[programLayoutId] ?? [])]
                          while (base.length < n) base.push(ceiling)
                          base[slotIndex] = ceiling
                          const next = { ...prev, [programLayoutId]: base }
                          layoutGeometryCeilingRef.current = next
                          return next
                        })
                      }}
                      onSlotEdgeCropHandle={(slotIndex, handle) => {
                        applySlotEdgeCropHandle(programLayoutId, slotIndex, handle)
                      }}
                      onSlotCropReset={(slotIndex) => {
                        const id = programSlots[slotIndex]
                        if (!id) return
                        cropTargetRef.current.set(id, { ...CROP_FULL })
                        setCropTick((t) => t + 1)
                      }}
                      onResetLayout={() => {
                        const dim = CANVAS_DIMS[programOrientation]
                        const preset = presetLayoutGeometry(programLayoutId, dim.w, dim.h)
                        setLayoutGeometry((prev) => ({ ...prev, [programLayoutId]: preset }))
                        setLayoutGeometryCeiling((prev) => ({
                          ...prev,
                          [programLayoutId]: preset.map((r) => ({ ...r }))
                        }))
                        layoutEdgeCropHandleRef.current = {
                          ...layoutEdgeCropHandleRef.current,
                          [programLayoutId]: preset.map(() => null)
                        }
                        activeLayoutEdgeCropRef.current = null
                        for (const id of programSlots) {
                          if (id) cropTargetRef.current.set(id, { ...CROP_FULL })
                        }
                        setCropTick((t) => t + 1)
                        setLayoutGeometryTick((t) => t + 1)
                      }}
                    />
                  ) : null}
                  {cropEditOpen && framingEditable && programCameraId ? (
                    <ProgramCropOverlay
                      canvas={canvasRef.current}
                      video={videoRefs.current.get(programCameraId) ?? null}
                      crop={programCrop}
                      rotateDeg={programRotateDeg}
                      onCropChange={(next) => updateCrop(programCameraId, next)}
                    />
                  ) : null}
                </div>
              </div>
                </div>
                <FusionCameraPlanBar
                  visible={clips.length > 0}
                  segments={timelineSegments}
                  scaleDuration={timelineScaleDuration}
                  currentTime={fusionPlanTimeSec}
                  segmentColor={(id) => fusionSegmentColor(fusionCameraColors, id)}
                  resolveAlias={cameraAliases.resolve}
                  legendCameraIds={cameraIds}
                  onSeek={(t) => seek(fusionRecordStartSecRef.current + t)}
                />
                </div>
                {clips.length > 0 ? (
                  <aside className="fusion-program-rail fusion-program-rail--right">
                    <FusionProgramBackgroundTools
                      background={programBackground}
                      cameraIds={clips.map((c) => c.cameraId)}
                      resolveAlias={cameraAliases.resolve}
                      onBackgroundChange={setProgramBackground}
                    />
                    {framingEditable && programCameraId ? (
                      <FusionProgramTools
                        cropEditOpen={cropEditOpen}
                        programCrop={programCrop}
                        programFramingTarget={programFramingTarget}
                        framingNeutral={FRAMING_NEUTRAL}
                        onToggleCropEdit={toggleCropEdit}
                        onResetCrop={() => resetCrop(programCameraId)}
                        onResetFraming={() => resetFraming(programCameraId)}
                      />
                    ) : null}
                  </aside>
                ) : null}
              </div>
            </div>
          <aside className="fusion-sidebar">
            <div
              className="fusion-sidebar-sources--mobile"
              style={{ fontSize: 11, fontWeight: 600, color: '#64748b', letterSpacing: 0.04, marginBottom: 8 }}
            >
              Fuentes (tocá = al programa)
            </div>
            <div className="fusion-thumb-strip">
              {clips.map((c) => {
                const onAir = programSlots.includes(c.cameraId)
                const cardClass = onAir
                  ? 'fusion-thumb-card fusion-thumb-card--on-air-manual'
                  : 'fusion-thumb-card fusion-thumb-card--idle'
                return (
                  <div key={c.cameraId} className={cardClass}>
                    <div className="fusion-thumb-preview-wrap">
                      <button
                        type="button"
                        className="fusion-thumb-pick"
                        onClick={() => assignCameraToProgram(c.cameraId)}
                        title={
                          layoutEditable
                            ? `Asignar a recuadro ${selectedLayoutSlot + 1}: ${cameraAliases.resolve(c.cameraId)}`
                            : `Programa: ${cameraAliases.resolve(c.cameraId)}`
                        }
                      >
                        <div className="fusion-thumb-pick-video">
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
                      </button>
                      <button
                        type="button"
                        className="fusion-thumb-overlay-btn fusion-thumb-rotate"
                        onClick={() => bumpRotate(c.cameraId)}
                        title="Girar imagen 90°"
                        aria-label={`Rotar ${cameraAliases.resolve(c.cameraId)}`}
                      >
                        {GLYPH.rotate}
                      </button>
                      <button
                        type="button"
                        className="fusion-thumb-overlay-btn fusion-thumb-close"
                        onClick={() => {
                          removeClipFromSession(c.cameraId)
                          onStatus(`Pista «${cameraAliases.resolve(c.cameraId)}» quitada de la sesión.`)
                        }}
                        title="Quitar esta grabación de la sesión"
                        aria-label={`Quitar ${cameraAliases.resolve(c.cameraId)}`}
                      >
                        {GLYPH.close}
                      </button>
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: onAir ? 700 : 500,
                        color: onAir ? '#99f6e4' : '#94a3b8',
                        textAlign: 'center',
                        wordBreak: 'break-word'
                      }}
                      title={
                        cameraAliases.resolve(c.cameraId) !== c.cameraId ? `ID: ${c.cameraId}` : undefined
                      }
                    >
                      {cameraAliases.resolve(c.cameraId)}
                    </div>
                  </div>
                )
              })}
            </div>
          </aside>
            </div>

          <FusionStudioTransport
            mode="files"
            visible
            playing={transportPlaying}
            fusionRecording={fusionRecording}
            fusionRecorderPaused={fusionRecorderPaused}
            fusionPreviewUrl={fusionPreviewUrl}
            recordPauseSupported={fusionRecorderSupportsPause}
            canRecord={!disabledFusion}
            canPlay={clips.length > 0 || fusionPreviewUrl !== null}
            canCloseSession={
              !(
                fusionRecording ||
                fusionExportBusy ||
                (!clips.length && !audioUrl && !fusionPreviewUrl && !sessionId)
              )
            }
            currentTime={currentTime}
            duration={duration}
            onTogglePlay={() => void togglePlay()}
            onRecordStart={() => void startFusionRecord()}
            onRecordPause={pauseFusionRecording}
            onRecordResume={() => void resumeFusionRecording()}
            onRecordStop={() => void stopFusionRecord()}
            onCloseSession={closeFusionSession}
          />

            <div className="fusion-video-decoders" aria-hidden>
              {clips.map((c) => (
                <video
                  key={c.cameraId}
                  ref={(el) => setVideoRef(c.cameraId, el)}
                  src={c.fileUrl}
                  preload="auto"
                  muted
                  playsInline
                  onLoadedMetadata={(e) => reportVideoAspect(c.cameraId, e.currentTarget)}
                  onLoadedData={(e) => reportVideoAspect(c.cameraId, e.currentTarget)}
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
                      En la barra de abajo, «Play» con vista previa activa solo mueve el WebM exportado; la
                      mezcla del programa no se reproduce con ese botón. La barra de tiempo controla las pistas cargadas;
                      si movés el tiempo, la vista previa salta al mismo instante relativo. Pantalla completa / Esc.
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
                            <span className="studio-spinner" aria-hidden /> Guardando WebM{GLYPH.ellipsis}
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
                            <span className="studio-spinner" aria-hidden /> Generando MP4{GLYPH.ellipsis}
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
                              {fusionExportTarget === 'mp4'
                                ? `Generando MP4${GLYPH.ellipsis}`
                                : `Guardando WebM${GLYPH.ellipsis}`}
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

            </div>
          </div>
      ) : null}

      {configPopoverOpen ? (
        <div
          role="dialog"
          aria-modal
          aria-label="Configuración por formato (Fusión por archivos)"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfigPopoverOpen(false)
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            background: 'rgba(2, 6, 23, 0.6)',
            backdropFilter: 'blur(2px)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: '5vh 12px',
            overflowY: 'auto'
          }}
        >
          <div
            style={{
              width: 'min(720px, 100%)',
              maxHeight: '90vh',
              overflowY: 'auto',
              background: '#0c121c',
              border: '1px solid #334155',
              borderRadius: 14,
              boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
              padding: 16,
              color: '#e2e8f0'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 8
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Configuración por formato</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, lineHeight: 1.45 }}>
                  Elegí qué grabaciones van en cada formato y la orientación de salida. Los botones de la barra
                  izquierda del programa aplican cada formato a la mezcla.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfigPopoverOpen(false)}
                aria-label="Cerrar configuración"
                style={{
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid #334155',
                  background: '#0f172a',
                  color: '#e2e8f0',
                  fontSize: 14,
                  cursor: 'pointer',
                  flexShrink: 0
                }}
              >
                �
              </button>
            </div>

            {!clips.length ? (
              <div style={{ fontSize: 11, color: '#94a3b8', padding: '12px 0' }}>
                Cargá las grabaciones cam-*.webm para configurar los formatos.
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 8,
                    marginTop: 10,
                    marginBottom: 10,
                    paddingBottom: 10,
                    borderBottom: '1px solid #1e293b'
                  }}
                >
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>Orientación de salida:</span>
                  {(['landscape', 'portrait', 'square'] as ProgramOrientation[]).map((o) => {
                    const active = programOrientation === o
                    const locked = fusionRecording || fusionExportBusy || Boolean(fusionPreviewUrl)
                    return (
                      <button
                        key={`orient-file-${o}`}
                        type="button"
                        disabled={locked}
                        onClick={() => {
                          if (locked) return
                          setProgramOrientation(o)
                          setOrientationSuggestionDismissed(true)
                        }}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: active ? '2px solid #38bdf8' : '1px solid #334155',
                          background: active ? '#0c4a6e' : '#0f172a',
                          color: '#e2e8f0',
                          fontSize: 11,
                          fontWeight: active ? 700 : 500,
                          cursor: locked ? 'not-allowed' : 'pointer',
                          opacity: locked ? 0.55 : 1
                        }}
                      >
                        {ORIENTATION_LABEL[o]}
                      </button>
                    )
                  })}
                  <span style={{ fontSize: 10, color: '#475569' }}>
                    Salida: {CANVAS_DIMS[programOrientation].w}�{CANVAS_DIMS[programOrientation].h}
                  </span>
                </div>

                {suggestedOrientation && !orientationSuggestionDismissed ? (
                  <div
                    role="status"
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 10,
                      marginBottom: 10,
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid #1d4ed8',
                      background: '#0b1a3a',
                      color: '#dbeafe',
                      fontSize: 11
                    }}
                  >
                    <span>
                      Las grabaciones parecen ser{' '}
                      <strong>{ORIENTATION_LABEL[suggestedOrientation].toLowerCase()}</strong>. ¿Cambiar la salida?
                    </span>
                    <button
                      type="button"
                      disabled={fusionRecording || fusionExportBusy || Boolean(fusionPreviewUrl)}
                      onClick={() => {
                        setProgramOrientation(suggestedOrientation)
                        setOrientationSuggestionDismissed(true)
                      }}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        border: '1px solid #2563eb',
                        background: '#1e40af',
                        color: '#eff6ff',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      Sí, cambiar
                    </button>
                    <button
                      type="button"
                      onClick={() => setOrientationSuggestionDismissed(true)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        border: '1px solid #334155',
                        background: '#0f172a',
                        color: '#e2e8f0',
                        fontSize: 11,
                        cursor: 'pointer'
                      }}
                    >
                      No, dejar {ORIENTATION_LABEL[programOrientation]}
                    </button>
                  </div>
                ) : null}

                <div
                  style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}
                  role="tablist"
                  aria-label="Editar formato"
                >
                  {PROGRAM_LAYOUTS.map((p) => {
                    const editing = editingLayoutId === p.id
                    const live = programLayoutId === p.id
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="tab"
                        aria-selected={editing}
                        onClick={() => setEditingLayoutId(p.id)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: editing ? '2px solid #38bdf8' : '1px solid #334155',
                          background: editing ? '#0c4a6e' : '#0f172a',
                          color: '#e2e8f0',
                          fontSize: 11,
                          fontWeight: editing ? 700 : 500,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          cursor: 'pointer'
                        }}
                      >
                        <span>{p.short}</span>
                        {live ? (
                          <span
                            style={{
                              fontSize: 9,
                              padding: '1px 6px',
                              borderRadius: 999,
                              background: '#7c2d12',
                              color: '#fed7aa',
                              fontWeight: 700
                            }}
                          >
                            AL AIRE
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: 8
                  }}
                >
                  {getLayout(editingLayoutId)
                    .slotLabels(programOrientation)
                    .map((label, i) => {
                      const cur = (layoutAssignments[editingLayoutId] ?? [])[i] ?? ''
                      return (
                        <label
                          key={`slot-file-${editingLayoutId}-${i}`}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                            fontSize: 10,
                            color: '#94a3b8'
                          }}
                        >
                          <span style={{ color: '#cbd5e1', fontWeight: 600 }}>
                            Slot {i + 1} · {label}
                          </span>
                          <select
                            value={cur}
                            onChange={(e) =>
                              setSlotForLayout(editingLayoutId, i, e.target.value || null)
                            }
                            style={{
                              padding: '6px 8px',
                              borderRadius: 8,
                              border: '1px solid #475569',
                              background: '#020617',
                              color: '#e2e8f0',
                              fontSize: 12
                            }}
                          >
                            <option value="">� Vacío (negro) �</option>
                            {cameraIds.map((cid) => (
                              <option key={cid} value={cid}>
                                {cameraAliases.resolve(cid)}
                              </option>
                            ))}
                          </select>
                        </label>
                      )
                    })}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={() => {
                      sendLayoutToProgram(editingLayoutId)
                      setConfigPopoverOpen(false)
                    }}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 8,
                      border: '1px solid #2dd4bf',
                      background: '#134e4a',
                      color: '#ccfbf1',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    Aplicar {getLayout(editingLayoutId).short} al programa
                  </button>
                </div>
              </>
            )}
          </div>
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
