import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useCameraAliases } from './cameraAliases'
import { configureDisplayCaptureVideoTrack, isDisplayCaptureId } from './displayCapture'
import { ProgramCropOverlay } from './ProgramCropOverlay'
import { FusionProgramBackgroundTools } from './FusionProgramBackgroundTools'
import { FusionProgramTools } from './FusionProgramTools'
import { drawProgramBackground, resetProgramCanvas } from './programBackground'
import { useProgramBackground } from './useProgramBackground'
import { FusionSceneSwitcher } from './FusionSceneSwitcher'
import { FusionCameraPlanBar } from './FusionCameraPlanBar'
import { fusionCameraColorMap, fusionSegmentColor, type FusionTimelineSegment } from './fusionCameraPlan'
import { FusionScenePresetsPanel } from './FusionScenePresetsPanel'
import { FusionStudioTransport } from './FusionStudioTransport'
import { ProgramLayoutEditorOverlay } from './ProgramLayoutEditorOverlay'
import { ProgramReadinessBanner, buildProgramReadiness } from './ProgramReadinessBanner'
import { resolvePresetSlots, type ScenePreset } from './programScenePresets'
import { SourceHealthBadge } from './SourceHealthBadge'
import { useSourceHealthMonitor } from './useSourceHealthMonitor'
import {
  clampCrop,
  CROP_FULL,
  cropIsFull,
  drawCroppedFramedVideoInRect,
  clientToCropNormalized,
  panFramingByCssDeltaWithCrop,
  type CamCrop
} from './programCrop'
import { getVideoFrameSize, getVideoFrameSizeForProgram } from './videoFrameSize'
import { useProgramFramingGestures } from './useProgramFramingGestures'
import { clampFraming, FRAMING_NEUTRAL, type CamFraming } from './programFraming'

/** Centrado por defecto en Fusión en vivo (calibrado vs. miniaturas: un poco a la izquierda y abajo). */
const LIVE_FRAMING_NEUTRAL: CamFraming = { zoom: 1, offsetX: 0.47, offsetY: 0.52 }
import {
  aspectToOrientation,
  buildDefaultLayoutAssignments,
  CANVAS_DIMS,
  defaultEditableSlotIndex,
  getLayout,
  ORIENTATION_LABEL,
  parseSceneSignature,
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
  type LayoutAssignments,
  type LayoutEdgeCropHandle,
  type LayoutEdgeCropHandleMap,
  type LayoutGeometryMap,
  type LayoutId,
  type NormalizedSlotRect,
  type ProgramOrientation,
  type SlotRect
} from './programScenes'
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
  /** Quita la fuente (cámara WebRTC o captura de pantalla). */
  onCloseSource: (cameraId: string) => void
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
  /** Agrega captura de pantalla o ventana (misma fuente que Sesión en vivo). */
  onAddDisplayCapture: () => void | Promise<void>
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
 *
 * Además, en cuanto el stream entrega su primer frame con metadatos, reportamos `videoWidth/videoHeight`
 * para que el panel pueda sugerir la orientación de salida (horizontal/vertical/cuadrado).
 */
function DecoderVideo({
  cameraId,
  stream,
  rotateDeg,
  onVideoEl,
  onAspect
}: {
  cameraId: string
  stream: MediaStream | undefined
  rotateDeg: number
  onVideoEl: (id: string, el: HTMLVideoElement | null) => void
  onAspect: (id: string, w: number, h: number) => void
}) {
  const r = useRef<HTMLVideoElement | null>(null)

  const reportAspect = useCallback(
    (v: HTMLVideoElement) => {
      const { vw, vh } = getVideoFrameSizeForProgram(v, stream, rotateDeg)
      if (vw > 0 && vh > 0) onAspect(cameraId, vw, vh)
    },
    [cameraId, stream, rotateDeg, onAspect]
  )

  useEffect(() => {
    const el = r.current
    if (!el) return
    if (el.srcObject !== stream) {
      el.srcObject = stream ?? null
    }
    const vt = stream?.getVideoTracks()[0]
    if (vt && isDisplayCaptureId(cameraId)) {
      configureDisplayCaptureVideoTrack(vt)
    }
    if (stream) {
      void el.play().catch(() => {})
    }
  }, [stream, cameraId])

  useEffect(() => {
    if (!isDisplayCaptureId(cameraId) || !stream) return
    const id = window.setInterval(() => {
      const el = r.current
      if (el?.paused) void el.play().catch(() => {})
    }, 1500)
    return () => window.clearInterval(id)
  }, [cameraId, stream])

  useEffect(() => {
    const el = r.current
    if (!el || !stream) return
    const read = () => reportAspect(el)
    read()
    const id = window.setInterval(read, 320)
    el.addEventListener('loadedmetadata', read)
    el.addEventListener('resize', read)
    const track = stream.getVideoTracks()[0]
    const onCfg = () => read()
    track?.addEventListener?.('configurationchange', onCfg)
    return () => {
      window.clearInterval(id)
      el.removeEventListener('loadedmetadata', read)
      el.removeEventListener('resize', read)
      track?.removeEventListener?.('configurationchange', onCfg)
    }
  }, [stream, reportAspect])

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
      onLoadedMetadata={(e) => reportAspect(e.currentTarget)}
      onResize={(e) => reportAspect(e.currentTarget)}
      style={{
        transform: rotateDeg ? `rotate(${rotateDeg}deg)` : undefined,
        transformOrigin: 'center center'
      }}
    />
  )
}

function ThumbVideo({
  stream,
  rotateDeg,
  isDisplayCapture = false
}: {
  stream: MediaStream | undefined
  rotateDeg: number
  isDisplayCapture?: boolean
}) {
  const r = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const el = r.current
    if (!el) return
    if (el.srcObject !== stream) {
      el.srcObject = stream ?? null
    }
    const vt = stream?.getVideoTracks()[0]
    if (vt && isDisplayCapture) configureDisplayCaptureVideoTrack(vt)
    if (stream) {
      void el.play().catch(() => {})
    }
  }, [stream, isDisplayCapture])

  useEffect(() => {
    if (!isDisplayCapture || !stream) return
    const id = window.setInterval(() => {
      const el = r.current
      if (el?.paused) void el.play().catch(() => {})
    }, 1500)
    return () => window.clearInterval(id)
  }, [stream, isDisplayCapture])

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
  onCloseSource,
  outputDir,
  audioStream,
  onStatus,
  isoBusy,
  onPickOutputDir,
  onOpenQr,
  onOpenAudio,
  hasPcAudio,
  onAddDisplayCapture
}: LiveFusionPanelProps) {
  const cameraAliases = useCameraAliases()
  const { background: programBackground, backgroundRef: programBackgroundRef, setBackground: setProgramBackground } =
    useProgramBackground()
  const [mixMode, setMixMode] = useState<LiveMixMode>('manual')
  const [programRecording, setProgramRecording] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  /** Cuál botón está exportando (para spinner localizado y banner con detalle). */
  const [exportTarget, setExportTarget] = useState<'webm' | 'mp4' | null>(null)
  /** Inicio del export en ms — para mostrar “tiempo transcurrido” mientras dura la operación. */
  const [exportStartMs, setExportStartMs] = useState<number | null>(null)
  const [exportElapsed, setExportElapsed] = useState(0)
  /** Última ruta exportada con éxito (cartelito verde con la ruta de guardado). */
  const [lastSavedPath, setLastSavedPath] = useState<string | null>(null)
  const [programBlob, setProgramBlob] = useState<Blob | null>(null)
  const [exportFileName, setExportFileName] = useState('')
  const [programPreviewUrl, setProgramPreviewUrl] = useState<string | null>(null)
  const [programElapsedLabel, setProgramElapsedLabel] = useState('00:00')
  const [programSegmentsDone, setProgramSegmentsDone] = useState<FusionTimelineSegment[]>([])
  const [openProgramSeg, setOpenProgramSeg] = useState<{ cameraId: string; startSec: number } | null>(
    null
  )

  /** Refresca el contador de segundos del banner de exportación cada 250ms mientras corre. */
  useEffect(() => {
    if (exportStartMs == null) {
      setExportElapsed(0)
      return
    }
    setExportElapsed(Date.now() - exportStartMs)
    const id = window.setInterval(() => {
      setExportElapsed(Date.now() - exportStartMs)
    }, 250)
    return () => window.clearInterval(id)
  }, [exportStartMs])

  const [autoOptionsExpanded, setAutoOptionsExpanded] = useState(true)
  const [autoStrategy, setAutoStrategy] = useState<AutoDirectorStrategy>('roundRobin')
  const [autoShotDurationSec, setAutoShotDurationSec] = useState(6)
  const [autoAvoidConsecutive, setAutoAvoidConsecutive] = useState(true)
  const [autoWeights, setAutoWeights] = useState<Record<string, number>>({})
  /** 0 = corte seco; manual y automático. */
  const [programCrossfadeMs, setProgramCrossfadeMs] = useState(PROGRAM_CROSSFADE_MS_DEFAULT)

  /**
   * Escena al aire: layout (cuántos slots y dónde) + cámara por slot.
   * Para layout 'single' actúa exactamente como el `programCameraId` antiguo: una cámara a pantalla
   * completa, con su crossfade entre tomas. Para layouts multi-slot, el director automático queda
   * deshabilitado (no tiene sentido rotar dentro de una pantalla partida) y se avisa al usuario.
   */
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
  const [programOrientation, setProgramOrientation] = useState<ProgramOrientation>('landscape')
  const [cameraAspects, setCameraAspects] = useState<Record<string, { w: number; h: number }>>({})
  const [orientationSuggestionDismissed, setOrientationSuggestionDismissed] = useState(false)
  const [configPopoverOpen, setConfigPopoverOpen] = useState(false)
  /** Modo editor de recorte (marco sobre el vídeo; desactiva zoom con rueda en el canvas). */
  const [cropEditOpen, setCropEditOpen] = useState(false)
  const cropEditOpenRef = useRef(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  /** Recorte por fuente: qué parte del frame entra al programa / grabación. */
  const cropTargetRef = useRef<Map<string, CamCrop>>(new Map())
  const [cropTick, setCropTick] = useState(0)
  /** Encuadre por fuente (zoom + pan dentro del recorte); se interpola en el loop del canvas. */
  const framingTargetRef = useRef<Map<string, CamFraming>>(new Map())
  const framingCurrentRef = useRef<Map<string, CamFraming>>(new Map())
  const [framingTick, setFramingTick] = useState(0)
  const programDragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null)
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const programRecordingStartedAtRef = useRef<number | null>(null)
  const cameraIdsRef = useRef<string[]>([])
  const autoWeightsRef = useRef<Record<string, number>>({})
  const crossfadeMsRef = useRef(programCrossfadeMs)
  const settledSceneSigRef = useRef<string | null>(null)
  const programFadeRef = useRef<ProgramFade | null>(null)
  const programLayoutIdRef = useRef<LayoutId>('single')
  const programSlotsRef = useRef<(string | null)[]>([null])

  crossfadeMsRef.current = programCrossfadeMs
  useEffect(() => {
    programLayoutIdRef.current = programLayoutId
  }, [programLayoutId])
  useEffect(() => {
    programSlotsRef.current = programSlots
  }, [programSlots])
  useEffect(() => {
    cropEditOpenRef.current = cropEditOpen
  }, [cropEditOpen])

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

  /** Firma de la escena que está al aire ahora (clave estable para el crossfade y el EDL futuro). */
  const currentSceneSig = useMemo(
    () => sceneSignature({ layoutId: programLayoutId, slots: programSlots }),
    [programLayoutId, programSlots]
  )

  const setVideoRef = useCallback((id: string, el: HTMLVideoElement | null) => {
    if (el) videoRefs.current.set(id, el)
    else videoRefs.current.delete(id)
  }, [])

  const sourceHealth = useSourceHealthMonitor({
    cameraIds,
    streams,
    rtcStates,
    getVideo: (id) => videoRefs.current.get(id)
  })

  const recordingReadiness = useMemo(
    () =>
      buildProgramReadiness({
        cameraIds,
        health: sourceHealth,
        resolveAlias: cameraAliases.resolve,
        forRecording: true
      }),
    [cameraIds, sourceHealth, cameraAliases]
  )

  /**
   * Cuando la lista de cámaras conectadas cambia:
   *  - Reconciliamos la asignación guardada por formato (si una cámara se desconectó, intentamos
   *    rellenar con la primera disponible para no mandar negros).
   *  - Si la cámara que está al aire en algún slot ya no existe, también reconciliamos `programSlots`.
   *  - Si entran cámaras nuevas y no había nada al aire, mandamos la primera a 'single' por defecto
   *    para mantener el comportamiento previo (auto-encuadre en la primera fuente activa).
   *  - Limpiamos `cameraAspects` de cámaras que ya no están conectadas.
   */
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
        // En 'single' siempre buscamos rellenar para no quedarnos con la pantalla en negro al entrar
        // una cámara nueva; en multi-slot dejamos vacío (= negro) para no inventar fuentes.
        if (layout.id === 'single') {
          const pick = cameraIds.find((id) => !used.has(id)) ?? cameraIds[0] ?? null
          if (pick) used.add(pick)
          slots.push(pick)
          if (pick !== want) changed = true
        } else {
          slots.push(null)
          if (want != null) changed = true
        }
      }
      return changed ? slots : prev
    })
    setCameraAspects((prev) => {
      let touched = false
      const next: Record<string, { w: number; h: number }> = {}
      for (const k of Object.keys(prev)) {
        if (cameraIds.includes(k)) next[k] = prev[k]!
        else touched = true
      }
      return touched ? next : prev
    })
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

  /**
   * Encadena fundidos al cambiar la escena (su firma). Si hay un fundido activo, sale desde su escena
   * destino. La firma cubre tanto cámara individual ('cam-id') como composiciones multi-slot
   * (`layoutId|cam0+cam1+…`), así que el crossfade es válido también entre layouts distintos.
   */
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

  /**
   * Director automático: solo opera cuando estamos en layout 'single' (rotando la cámara al aire).
   * En layouts multi-slot (PIP, 2×, 2×2, 1+2) el corte automático no tendría sentido — se desactiva
   * de hecho y un cartel arriba avisa al usuario. Al volver a 'single', el intervalo reaparece.
   */
  useEffect(() => {
    if (mixMode !== 'auto') return
    if (programLayoutId !== 'single') return
    const curIds = cameraIdsRef.current
    if (curIds.length === 0) return

    const durationMs = Math.max(2000, Math.min(120000, autoShotDurationSec * 1000))

    const step = () => {
      const ids = cameraIdsRef.current
      if (ids.length === 0) return
      const prev = programSlotsRef.current[0] ?? null
      let next: string | null = prev
      if (ids.length === 1) next = ids[0]!
      else if (autoStrategy === 'roundRobin') {
        const idx = Math.max(0, ids.indexOf(prev ?? ids[0]!))
        next = ids[(idx + 1) % ids.length]!
      } else {
        const wmap = autoWeightsRef.current
        let cand = pickWeightedCamera(ids, wmap)
        if (autoAvoidConsecutive && ids.length > 1 && prev) {
          let tries = 0
          while (cand === prev && tries < 20) {
            cand = pickWeightedCamera(ids, wmap)
            tries++
          }
        }
        next = cand
      }
      if (next && next !== prev) {
        setLayoutAssignments((p) => ({ ...p, single: [next!] }))
        setProgramLayoutId('single')
        setProgramSlots([next])
      }
    }

    const id = window.setInterval(step, durationMs)
    return () => window.clearInterval(id)
  }, [mixMode, programLayoutId, autoShotDurationSec, autoStrategy, autoAvoidConsecutive])

  /**
   * Loop de pintura del canvas del programa.
   *
   * Dibuja la escena completa según `programLayoutId` + `programSlots`. Cada slot recibe su rect
   * (`PROGRAM_LAYOUTS`) y dentro del rect el video va con letterbox (`drawVideoInRect`), de modo que
   * un video vertical en una celda horizontal deja bandas donde el vídeo no llega (fondo del programa).
   *
   * El canvas se limpia con `drawProgramBackground`; slots vacíos o letterbox muestran ese fondo.
   *
   * El crossfade entre escenas se aplica a nivel "frame completo": se renderiza la escena anterior y
   * la nueva en un buffer offscreen, y se mezcla con globalAlpha. Esto permite cambiar entre
   * cualquier par de layouts (no sólo 'single') sin saltos.
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
      const stream = streams[cameraId]
      if (!v || !stream) return
      target.save()
      try {
        const cw = rect.w
        const ch = rect.h
        target.beginPath()
        target.rect(rect.x, rect.y, cw, ch)
        target.clip()
        /** No pintar negro: el lienzo ya trae fondo (`drawProgramBackground`); así se ven bandas/meta en ´contain´ */
        const rot = manualRotateDeg[cameraId] ?? 0
        const { vw, vh } = getVideoFrameSize(v, stream)
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
          /* Marco quieto: frame completo sin zoom/pan mientras se ajusta el recorte. */
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
          const framing = framingTargetRef.current.get(cameraId) ?? LIVE_FRAMING_NEUTRAL
          framingCurrentRef.current.set(cameraId, framing)
          drawCroppedFramedVideoInRect(
            target,
            v,
            rect,
            crop,
            framing,
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
        getStream: (id) => streams[id],
        getRotateDeg: (id) => manualRotateDeg[id] ?? 0
      })
      const sc = parseSceneSignature(sig)
      const rects = resolveLayoutSlotRects(sc.layoutId, cw, ch, layoutGeometryRef.current[sc.layoutId])
      const geomNorm = layoutGeometryRef.current[sc.layoutId]
      const ceilNorm = layoutGeometryCeilingRef.current[sc.layoutId]
      for (let i = 0; i < rects.length; i++) {
        const id = sc.slots[i] ?? null
        if (!id) {
          // slot vacío → se ve el fondo del programa
          continue
        }
        const r = rects[i]!
        drawVideoInRect(target, id, r, geomNorm?.[i], ceilNorm?.[i] ?? geomNorm?.[i], cw, ch, i)
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

    /** rAF continuo: zoom/pan deben pintarse aunque el stream no entregue frames nuevos (vfc no dispara). */
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
  }, [streams, programOrientation])

  /**
   * Cambia la escena al aire. La firma de `scene` se vuelve la "to" del próximo crossfade.
   * Para layout 'single' la firma coincide con el cameraId pelado, igual que en Fusión por archivos.
   */
  const applyProgramScene = useCallback(
    (nextLayoutId: LayoutId, nextSlots: (string | null)[]) => {
      const layout = getLayout(nextLayoutId)
      const slots = nextSlots.slice(0, layout.slotsCount)
      while (slots.length < layout.slotsCount) slots.push(null)
      setProgramLayoutId(nextLayoutId)
      setProgramSlots(slots)
    },
    []
  )

  /** Atajo: mandar 1 cámara al programa (layout = single, slot 0 = id). */
  const pickProgram = useCallback(
    (id: string) => {
      setLayoutAssignments((prev) => {
        if (prev.single?.[0] === id) return prev
        return { ...prev, single: [id] }
      })
      applyProgramScene('single', [id])
    },
    [applyProgramScene]
  )

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

  /**
   * Aplica la asignación guardada para `layoutId` al programa (lo que dispara la barra lateral en vivo).
   * Si algún slot quedó vacío en la configuración, intentamos rellenar con cámaras disponibles para
   * no mandar negros sin querer.
   */
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
      // Cambiar a un layout multi-slot mientras está activo el modo automático no tiene sentido:
      // pasamos a manual en silencio (un avisito visible aparece en el popover y arriba del canvas).
      if (layoutId !== 'single' && mixMode === 'auto') {
        setMixMode('manual')
      }
      applyProgramScene(layoutId, slots)
      if (layoutId !== 'single') {
        ensureLayoutGeometry(layoutId)
        setSelectedLayoutSlot(defaultEditableSlotIndex(layoutId))
      }
    },
    [applyProgramScene, ensureLayoutGeometry, layoutAssignments, mixMode]
  )

  /**
   * Cambia, para `layoutId`, la cámara de un slot puntual (sólo configuración).
   * Si ese layout es el que está al aire ahora mismo, también actualiza el programa en vivo
   * para que el cambio se vea reflejado sin pedir un segundo clic.
   */
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

  const assignCameraToProgram = useCallback(
    (cameraId: string) => {
      if (programLayoutId !== 'single' && mixMode === 'manual') {
        setSlotForLayout(programLayoutId, selectedLayoutSlot, cameraId)
        return
      }
      pickProgram(cameraId)
    },
    [mixMode, pickProgram, programLayoutId, selectedLayoutSlot, setSlotForLayout]
  )

  /** Reporta las dimensiones reales del primer frame de una cámara para sugerir orientación. */
  const handleCameraAspect = useCallback((id: string, w: number, h: number) => {
    setCameraAspects((prev) => {
      const cur = prev[id]
      if (cur && cur.w === w && cur.h === h) return prev
      return { ...prev, [id]: { w, h } }
    })
  }, [])

  /**
   * Si todas las cámaras conectadas comparten una orientación distinta de la actual de salida,
   * sugerimos cambiar la salida (el usuario decide). Si dismisseó la sugerencia, no insistimos.
   */
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

  // Si entran cámaras nuevas y la sugerencia volvió a aparecer, queremos avisar otra vez.
  useEffect(() => {
    if (suggestedOrientation) setOrientationSuggestionDismissed(false)
  }, [suggestedOrientation])

  /** ESC cierra el popover sin guardar nada (la config persiste mientras el componente esté montado). */
  useEffect(() => {
    if (!configPopoverOpen) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setConfigPopoverOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [configPopoverOpen])

  /** Para la UI vieja que mostraba "la cámara en programa", exponemos el slot 0 del layout actual. */
  const programCameraId = programSlots[0] ?? null

  const getProgramRecordTimeSec = useCallback(() => {
    const started = programRecordingStartedAtRef.current
    if (!started) return 0
    return (Date.now() - started) / 1000
  }, [])

  const programPlanTimeSec = useMemo(() => {
    if (programRecording && programRecordingStartedAtRef.current) {
      return (Date.now() - programRecordingStartedAtRef.current) / 1000
    }
    let max = 0
    for (const s of programSegmentsDone) max = Math.max(max, s.endSec)
    return max
  }, [programRecording, programElapsedLabel, programSegmentsDone])

  const programTimelineSegments = useMemo(() => {
    const out = [...programSegmentsDone]
    if (programRecording && openProgramSeg) {
      out.push({
        startSec: openProgramSeg.startSec,
        endSec: programPlanTimeSec,
        cameraId: openProgramSeg.cameraId
      })
    }
    return out
  }, [programSegmentsDone, programRecording, openProgramSeg, programPlanTimeSec])

  const programTimelineScale = useMemo(() => {
    let max = programPlanTimeSec
    for (const s of programTimelineSegments) {
      max = Math.max(max, s.endSec, s.startSec)
    }
    return max > 0 ? max : 1
  }, [programPlanTimeSec, programTimelineSegments])

  const programCameraColors = useMemo(() => {
    const ids = new Set(cameraIds)
    for (const s of programSegmentsDone) ids.add(s.cameraId)
    if (openProgramSeg) ids.add(openProgramSeg.cameraId)
    return fusionCameraColorMap(ids)
  }, [cameraIds, programSegmentsDone, openProgramSeg])

  useEffect(() => {
    if (!programRecording) return
    const air = programCameraId
    const t = getProgramRecordTimeSec()
    setOpenProgramSeg((open) => {
      if (open?.cameraId === air) return open
      if (open) {
        setProgramSegmentsDone((prev) => [
          ...prev,
          { startSec: open.startSec, endSec: t, cameraId: open.cameraId }
        ])
      }
      return air ? { cameraId: air, startSec: t } : null
    })
  }, [programCameraId, programRecording, getProgramRecordTimeSec])

  const programRotateDeg = programCameraId ? (manualRotateDeg[programCameraId] ?? 0) : 0
  const programStream = programCameraId ? streams[programCameraId] : undefined
  const framingEditable = programLayoutId === 'single' && programCameraId != null
  const layoutEditable = programLayoutId !== 'single' && mixMode === 'manual'

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

  /**
   * Con una sola cámara al aire, la orientación de salida sigue la del frame real
   * (evita mezcla 16:9 con celular en retrato → se corta arriba/abajo).
   */
  useEffect(() => {
    if (programLayoutId !== 'single' || !programCameraId) return
    const dim = cameraAspects[programCameraId]
    if (!dim) return
    const want = aspectToOrientation(dim.w, dim.h)
    setProgramOrientation((cur) => (cur === want ? cur : want))
  }, [programLayoutId, programCameraId, cameraAspects])

  const programCrop = useMemo<CamCrop>(() => {
    if (!programCameraId) return CROP_FULL
    return cropTargetRef.current.get(programCameraId) ?? CROP_FULL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programCameraId, cropTick])

  const programFramingTarget = useMemo<CamFraming>(() => {
    if (!programCameraId) return LIVE_FRAMING_NEUTRAL
    return framingTargetRef.current.get(programCameraId) ?? LIVE_FRAMING_NEUTRAL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programCameraId, framingTick])

  const applyFraming = useCallback((cameraId: string, next: CamFraming) => {
    const clamped = clampFraming(next)
    framingTargetRef.current.set(cameraId, clamped)
    framingCurrentRef.current.set(cameraId, clamped)
    setFramingTick((n) => n + 1)
  }, [])

  const updateFramingTarget = useCallback((cameraId: string, mutator: (cur: CamFraming) => CamFraming) => {
    const cur = framingTargetRef.current.get(cameraId) ?? LIVE_FRAMING_NEUTRAL
    applyFraming(cameraId, mutator(cur))
  }, [applyFraming])

  const resetFraming = useCallback((cameraId: string | null) => {
    if (!cameraId) return
    applyFraming(cameraId, { ...LIVE_FRAMING_NEUTRAL })
  }, [applyFraming])

  const updateCrop = useCallback((cameraId: string, next: CamCrop) => {
    cropTargetRef.current.set(cameraId, clampCrop(next))
    setCropTick((n) => n + 1)
  }, [])

  const resetCrop = useCallback((cameraId: string | null) => {
    if (!cameraId) return
    cropTargetRef.current.set(cameraId, { ...CROP_FULL })
    setCropTick((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!framingEditable) {
      cropEditOpenRef.current = false
      setCropEditOpen(false)
    }
  }, [framingEditable])

  const toggleCropEdit = useCallback(() => {
    const next = !cropEditOpenRef.current
    cropEditOpenRef.current = next
    setCropEditOpen(next)
    const camId = programSlotsRef.current[0]
    if (camId) {
      const neutral = { ...FRAMING_NEUTRAL }
      framingTargetRef.current.set(camId, neutral)
      framingCurrentRef.current.set(camId, neutral)
      setFramingTick((n) => n + 1)
    }
  }, [])

  useProgramFramingGestures({
    enabled: framingEditable && !cropEditOpen,
    cameraId: programCameraId,
    canvasRef,
    getVideo: (id) => videoRefs.current.get(id),
    getCrop: (id) => cropTargetRef.current.get(id) ?? CROP_FULL,
    getFraming: (id) => framingTargetRef.current.get(id) ?? LIVE_FRAMING_NEUTRAL,
    applyFraming,
    rotateDeg: programRotateDeg,
    stream: programStream,
    neutralFraming: LIVE_FRAMING_NEUTRAL,
    programDragRef
  })

  const onProgramMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!framingEditable || !programCameraId || cropEditOpen) return
      if (e.button !== 0) return
      programDragRef.current = { startX: e.clientX, startY: e.clientY, moved: false }
    },
    [cropEditOpen, framingEditable, programCameraId]
  )

  const onProgramMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const drag = programDragRef.current
      if (!drag || !framingEditable || !programCameraId || cropEditOpen) return
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
      const cur = framingTargetRef.current.get(programCameraId) ?? LIVE_FRAMING_NEUTRAL
      const next = panFramingByCssDeltaWithCrop({
        dx,
        dy,
        canvas,
        video: v,
        crop,
        cur,
        rotateDeg: programRotateDeg,
        stream: programStream
      })
      applyFraming(programCameraId, next)
    },
    [applyFraming, cropEditOpen, framingEditable, programCameraId, programRotateDeg, programStream]
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
      if (!framingEditable || !programCameraId || cropEditOpen) return
      const canvas = canvasRef.current
      const v = videoRefs.current.get(programCameraId)
      if (!canvas || !v) return
      const crop = cropTargetRef.current.get(programCameraId) ?? CROP_FULL
      const cur = framingTargetRef.current.get(programCameraId) ?? LIVE_FRAMING_NEUTRAL
      const ptr = clientToCropNormalized(
        e.clientX,
        e.clientY,
        canvas,
        v,
        crop,
        cur,
        programRotateDeg,
        programStream
      )
      if (!ptr) return
      updateFramingTarget(programCameraId, (c) => ({ ...c, offsetX: ptr.nx, offsetY: ptr.ny }))
    },
    [cropEditOpen, framingEditable, programCameraId, programRotateDeg, programStream, updateFramingTarget]
  )

  const onProgramDoubleClick = useCallback(() => {
    if (!framingEditable || cropEditOpen) return
    resetFraming(programCameraId)
  }, [cropEditOpen, framingEditable, programCameraId, resetFraming])

  const applyScenePreset = useCallback(
    (preset: ScenePreset) => {
      const ids = cameraIdsRef.current
      const { layoutId, slots } = resolvePresetSlots(preset, ids)
      setProgramOrientation(preset.programOrientation)
      setProgramCrossfadeMs(preset.programCrossfadeMs)
      setProgramBackground(preset.background)
      setLayoutAssignments({
        ...buildDefaultLayoutAssignments(ids),
        ...preset.layoutAssignments
      })
      applyProgramScene(layoutId, slots)
      if (layoutId !== 'single') {
        ensureLayoutGeometry(layoutId)
        setSelectedLayoutSlot(defaultEditableSlotIndex(layoutId))
      }
      onStatus(`Preset «${preset.name}» aplicado.`)
    },
    [applyProgramScene, ensureLayoutGeometry, onStatus, setProgramBackground]
  )

  const startProgramRecording = useCallback(() => {
    if (isoBusy) {
      onStatus('No podés grabar el programa mientras hay una grabación por pistas pendiente o en curso.')
      return
    }
    if (!outputDir) {
      onStatus('Tocá «Carpeta de grabación» arriba en esta sección antes de grabar el programa.')
      return
    }
    if (!recordingReadiness.ready) {
      const detail = recordingReadiness.issues[0] ?? recordingReadiness.summary
      onStatus(`${recordingReadiness.summary} ${detail}`)
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
    const t0 = Date.now()
    programRecordingStartedAtRef.current = t0
    setProgramSegmentsDone([])
    const air = programSlotsRef.current[0] ?? null
    setOpenProgramSeg(air ? { cameraId: air, startSec: 0 } : null)
    rec.start()
    setProgramRecording(true)
    setExportFileName(`live-program-${Date.now()}.webm`)
    onStatus(
      mixMode === 'auto'
        ? 'Grabando programa en modo automático (director por reglas).'
        : 'Grabando salida del programa (canvas). Cambiá de toma con las miniaturas.'
    )
  }, [audioStream, isoBusy, mixMode, onStatus, outputDir, recordingReadiness])

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
    const tEnd = getProgramRecordTimeSec()
    setOpenProgramSeg((open) => {
      if (open) {
        setProgramSegmentsDone((prev) => [
          ...prev,
          { startSec: open.startSec, endSec: tEnd, cameraId: open.cameraId }
        ])
      }
      return null
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
  }, [getProgramRecordTimeSec, onStatus, openProgramSeg])

  const saveProgramBlob = useCallback(async () => {
    if (!programBlob || !outputDir) {
      onStatus('No hay archivo para guardar o falta carpeta de grabación.')
      return
    }
    const fallback = `live-program-${Date.now()}.webm`
    const name = sanitizeLiveFileName(exportFileName, fallback)
    const filePath = joinOutputPath(outputDir, name)
    setExportBusy(true)
    setExportTarget('webm')
    setExportStartMs(Date.now())
    setLastSavedPath(null)
    onStatus(`Guardando WebM: ${name} …`)
    try {
      const buf = await programBlob.arrayBuffer()
      await window.studio.saveVideo(filePath, buf)
      setProgramBlob(null)
      setLastSavedPath(filePath)
      onStatus(`Programa guardado (WebM): ${name}`)
    } catch (e) {
      onStatus(`Error al guardar: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setExportBusy(false)
      setExportTarget(null)
      setExportStartMs(null)
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
    setExportTarget('mp4')
    setExportStartMs(Date.now())
    setLastSavedPath(null)
    onStatus('Generando MP4 con FFmpeg (puede tardar según la duración)…')
    try {
      const buf = await programBlob.arrayBuffer()
      const r = await window.studio.saveFusionMp4(filePath, buf)
      if (!r.ok) {
        onStatus(`No se pudo exportar MP4: ${r.message}`)
        return
      }
      setProgramBlob(null)
      setLastSavedPath(filePath)
      onStatus(`Programa guardado (MP4): ${name}`)
    } catch (e) {
      onStatus(`Error al exportar MP4: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setExportBusy(false)
      setExportTarget(null)
      setExportStartMs(null)
    }
  }, [exportFileName, onStatus, outputDir, programBlob])

  const discardProgramBlob = useCallback(() => {
    setProgramBlob(null)
    setLastSavedPath(null)
    onStatus('Vista previa del programa descartada.')
  }, [onStatus])

  /** Cierra el cartelito verde de "guardado". El próximo guardado lo vuelve a abrir. */
  const dismissLastSaved = useCallback(() => setLastSavedPath(null), [])

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
    setProgramSegmentsDone([])
    setOpenProgramSeg(null)
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
        <button
          type="button"
          disabled={isoBusy || programRecording}
          onClick={() => void onAddDisplayCapture()}
          style={{
            ...btnNeutral,
            fontWeight: 600,
            opacity: isoBusy || programRecording ? 0.55 : 1,
            cursor: isoBusy || programRecording ? 'not-allowed' : 'pointer'
          }}
          title="Pantalla completa o ventana de esta PC (selector de Windows)."
        >
          <span aria-hidden style={{ fontSize: 14 }}>⧉</span> Pantalla / ventana
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
          <div className="fusion-workspace-top">
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
            {cameraIds.length > 0 ? (
              <>
                <ProgramReadinessBanner
                  cameraIds={cameraIds}
                  health={sourceHealth}
                  resolveAlias={cameraAliases.resolve}
                />
                <FusionScenePresetsPanel
                  disabled={programRecording}
                  getSnapshot={() => ({
                    programLayoutId,
                    layoutAssignments,
                    programOrientation,
                    programCrossfadeMs,
                    background: programBackground
                  })}
                  onApplyPreset={applyScenePreset}
                  onStatus={onStatus}
                />
              </>
            ) : null}

          </div>

          <div className="fusion-program-heading">
            <div style={{ textAlign: 'center', margin: '0 auto', maxWidth: 560 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>Programa (salida)</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, lineHeight: 1.45 }}>
                {mixMode === 'manual' ? (
                  <>
                    Vista que iría “al aire”. Elegí la escena con las fuentes a la derecha.
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
                  </>
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
            <div className="fusion-program-heading-sources">
              {mixMode === 'manual' ? 'Fuentes (tocá = al programa)' : 'Fuentes (vista previa · elige el director)'}
            </div>
          </div>

          <div className="fusion-stage">
            <div className="fusion-main-flow">
            <div className="fusion-preview-row">
            <div className="fusion-preview-column">
              {mixMode === 'auto' && programLayoutId !== 'single' ? (
                <div className="fusion-program-notice">Director automático pausado (layout multi-slot)</div>
              ) : null}
              <div className="fusion-program-layout">
                {cameraIds.length > 0 ? (
                  <aside className="fusion-program-rail fusion-program-rail--left">
                    <FusionSceneSwitcher
                      programLayoutId={programLayoutId}
                      onOpenConfig={() => setConfigPopoverOpen(true)}
                      onSelectLayout={sendLayoutToProgram}
                      showOrientationDot={!!suggestedOrientation && !orientationSuggestionDismissed}
                      programRecording={programRecording}
                      mixMode={mixMode}
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
                      stream={programStream}
                      crop={programCrop}
                      rotateDeg={programRotateDeg}
                      onCropChange={(next) => updateCrop(programCameraId, next)}
                    />
                  ) : null}
                </div>
              </div>
                </div>
                <FusionCameraPlanBar
                  visible={cameraIds.length > 0}
                  segments={programTimelineSegments}
                  scaleDuration={programTimelineScale}
                  currentTime={programPlanTimeSec}
                  segmentColor={(id) => fusionSegmentColor(programCameraColors, id)}
                  resolveAlias={cameraAliases.resolve}
                  legendCameraIds={cameraIds}
                />
                </div>
                {cameraIds.length > 0 ? (
                  <aside className="fusion-program-rail fusion-program-rail--right">
                    <FusionProgramBackgroundTools
                      background={programBackground}
                      cameraIds={cameraIds}
                      resolveAlias={cameraAliases.resolve}
                      onBackgroundChange={setProgramBackground}
                    />
                    {framingEditable && programCameraId ? (
                      <FusionProgramTools
                        cropEditOpen={cropEditOpen}
                        programCrop={programCrop}
                        programFramingTarget={programFramingTarget}
                        framingNeutral={LIVE_FRAMING_NEUTRAL}
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
              {mixMode === 'manual' ? 'Fuentes (tocá = al programa)' : 'Fuentes (vista previa · elige el director)'}
            </div>
            <div className="fusion-thumb-strip">
              {cameraIds.map((id) => {
                const onAir =
                  programLayoutId === 'single'
                    ? programCameraId === id
                    : programSlots.includes(id)
                const cardClass = onAir
                  ? mixMode === 'manual'
                    ? 'fusion-thumb-card fusion-thumb-card--on-air-manual'
                    : 'fusion-thumb-card fusion-thumb-card--on-air-auto'
                  : 'fusion-thumb-card fusion-thumb-card--idle'
                return (
                  <div key={id} className={cardClass}>
                    <div className="fusion-thumb-preview-wrap">
                      <button
                        type="button"
                        className="fusion-thumb-pick"
                        disabled={mixMode === 'auto'}
                        onClick={() => assignCameraToProgram(id)}
                        title={
                          mixMode === 'manual'
                            ? layoutEditable
                              ? `Asignar a recuadro ${selectedLayoutSlot + 1}: ${cameraAliases.resolve(id)}`
                              : `Programa: ${cameraAliases.resolve(id)}`
                            : 'En automático la toma la elige el director; pasá a Manual para elegir vos.'
                        }
                      >
                        <div className="fusion-thumb-pick-video">
                          <ThumbVideo
                            stream={streams[id]}
                            rotateDeg={manualRotateDeg[id] ?? 0}
                            isDisplayCapture={isDisplayCaptureId(id)}
                          />
                        </div>
                      </button>
                      {!isDisplayCaptureId(id) ? (
                        <button
                          type="button"
                          className="fusion-thumb-overlay-btn fusion-thumb-rotate"
                          onClick={() => onRotate90(id)}
                          title="Girar imagen 90°"
                          aria-label={`Rotar ${cameraAliases.resolve(id)}`}
                        >
                          ↻
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="fusion-thumb-overlay-btn fusion-thumb-close"
                        onClick={() => {
                          onCloseSource(id)
                          onStatus(
                            isDisplayCaptureId(id)
                              ? `Fuente «${cameraAliases.resolve(id)}» cerrada.`
                              : `Cámara «${cameraAliases.resolve(id)}» desconectada.`
                          )
                        }}
                        title={
                          isDisplayCaptureId(id)
                            ? 'Quitar esta captura de pantalla/ventana'
                            : 'Cerrar / desconectar esta cámara'
                        }
                        aria-label={`Cerrar ${cameraAliases.resolve(id)}`}
                      >
                        ✕
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
                      title={cameraAliases.aliases[id] ? `ID interno: ${id}` : undefined}
                    >
                      {cameraAliases.resolve(id)}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 2 }}>
                      <SourceHealthBadge
                        health={
                          sourceHealth[id] ?? {
                            state: 'waiting',
                            label: 'Comprobando…'
                          }
                        }
                        compact
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </aside>
            </div>

          <FusionStudioTransport
            mode="live"
            visible={cameraIds.length > 0}
            fusionRecording={programRecording}
            elapsedLabel={programElapsedLabel}
            canRecord={!disabledProgramRec && !programRecording && recordingReadiness.ready}
            canCancel={(programRecording || programBlob !== null) && !exportBusy}
            onRecordStart={() => void startProgramRecording()}
            onRecordStop={() => void stopProgramRecording()}
            onCancel={cancelProgramFlow}
          />

            <div className="fusion-video-decoders" aria-hidden>
              {cameraIds.map((id) => (
                <DecoderVideo
                  key={id}
                  cameraId={id}
                  stream={streams[id]}
                  rotateDeg={manualRotateDeg[id] ?? 0}
                  onVideoEl={setVideoRef}
                  onAspect={handleCameraAspect}
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
                      opacity: exportBusy ? 0.85 : 1,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8
                    }}
                  >
                    {exportTarget === 'webm' ? (
                      <>
                        <span className="studio-spinner" aria-hidden /> Guardando WebM…
                      </>
                    ) : (
                      'Guardar WebM en carpeta'
                    )}
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
                      opacity: exportBusy ? 0.85 : 1,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8
                    }}
                  >
                    {exportTarget === 'mp4' ? (
                      <>
                        <span className="studio-spinner" aria-hidden /> Generando MP4…
                      </>
                    ) : (
                      'Guardar MP4 (recomendado Windows)'
                    )}
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
                      fontWeight: 600,
                      opacity: exportBusy ? 0.6 : 1
                    }}
                  >
                    Descartar
                  </button>
                </div>
                {exportTarget ? (
                  <div
                    role="status"
                    aria-live="polite"
                    style={{
                      marginTop: 10,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border:
                        exportTarget === 'mp4' ? '1px solid #1d4ed8' : '1px solid #047857',
                      background: exportTarget === 'mp4' ? '#0b1a3a' : '#062018',
                      color: exportTarget === 'mp4' ? '#dbeafe' : '#bbf7d0',
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
                          {exportTarget === 'mp4' ? 'Generando MP4…' : 'Guardando WebM…'}
                        </strong>{' '}
                        {exportTarget === 'mp4'
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
                        {Math.floor(exportElapsed / 1000)}s
                      </span>
                    </div>
                    <div className="studio-progress-bar" aria-hidden />
                  </div>
                ) : null}
              </div>
            ) : null}

            {lastSavedPath ? (
              <div
                role="status"
                aria-live="polite"
                style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid #047857',
                  background: '#062018',
                  color: '#bbf7d0',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap'
                }}
              >
                <span style={{ fontSize: 16 }} aria-hidden>
                  ✓
                </span>
                <div style={{ flex: 1, minWidth: 0, lineHeight: 1.45 }}>
                  <strong>Programa guardado.</strong>{' '}
                  <span style={{ color: '#86efac', wordBreak: 'break-all' }}>{lastSavedPath}</span>
                </div>
                <button
                  type="button"
                  onClick={dismissLastSaved}
                  aria-label="Cerrar aviso de guardado"
                  title="Cerrar"
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: '1px solid #065f46',
                    background: '#022c22',
                    color: '#bbf7d0',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  OK
                </button>
              </div>
            ) : null}
            </div>

          </div>
        </div>

      {!cameraIds.length ? (
        <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
          <strong style={{ color: '#fca5a5' }}>No hay video:</strong> escaneá el <strong style={{ color: '#e2e8f0' }}>QR
          de Fusión en vivo</strong> (botón arriba) con cada celular y tocá <strong style={{ color: '#e2e8f0' }}>Transmitir</strong>.
          Recordá que el QR de «Sesión en vivo» no sirve acá — cada pestaña usa el suyo.
        </div>
      ) : null}

      {configPopoverOpen ? (
        <div
          role="dialog"
          aria-modal
          aria-label="Configuración por formato (Fusión en vivo)"
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
              position: 'relative',
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
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                  Elegí qué cámaras aparecen en cada formato y la orientación de la salida. Después, con
                  los botones de la barra lateral del programa, mandás cada formato al aire (también
                  durante la grabación). En layouts multi-slot el director automático queda pausado.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfigPopoverOpen(false)}
                aria-label="Cerrar configuración"
                title="Cerrar (Esc)"
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
                ×
              </button>
            </div>

            {cameraIds.length === 0 ? (
              <div style={{ fontSize: 11, color: '#94a3b8', padding: '12px 0' }}>
                Esperá a que los celulares se conecten (escaneá el QR) para configurar los formatos.
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
                    const locked = programRecording || programBlob !== null || exportBusy
                    return (
                      <button
                        key={`orient-${o}`}
                        type="button"
                        disabled={locked}
                        onClick={() => {
                          if (locked) return
                          setProgramOrientation(o)
                          setOrientationSuggestionDismissed(true)
                        }}
                        title={
                          locked
                            ? 'Finalizá la grabación y descartá la vista previa antes de cambiar la orientación'
                            : `Salida ${ORIENTATION_LABEL[o]} (${CANVAS_DIMS[o].w}×${CANVAS_DIMS[o].h})`
                        }
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
                    Salida final: {CANVAS_DIMS[programOrientation].w}×{CANVAS_DIMS[programOrientation].h}.
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
                      Detecté que <strong>todas tus cámaras</strong> son{' '}
                      <strong>{ORIENTATION_LABEL[suggestedOrientation].toLowerCase()}</strong>. ¿Querés
                      que la salida también sea {ORIENTATION_LABEL[suggestedOrientation]}?
                    </span>
                    <button
                      type="button"
                      disabled={programRecording || programBlob !== null || exportBusy}
                      onClick={() => {
                        setProgramOrientation(suggestedOrientation)
                        setOrientationSuggestionDismissed(true)
                      }}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        border: '1px solid #2563eb',
                        background:
                          programRecording || programBlob !== null || exportBusy
                            ? '#334155'
                            : '#1e40af',
                        color: '#eff6ff',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor:
                          programRecording || programBlob !== null || exportBusy
                            ? 'not-allowed'
                            : 'pointer'
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
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    marginBottom: 10
                  }}
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
                        title={`Editar: ${p.label}${live ? ' · al aire' : ''}`}
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
                        <span style={{ fontSize: 10, color: editing ? '#bae6fd' : '#94a3b8' }}>
                          {p.label.split(' (')[0]}
                        </span>
                        {live ? (
                          <span
                            title="Este formato está al aire"
                            style={{
                              fontSize: 9,
                              padding: '1px 6px',
                              borderRadius: 999,
                              background: '#7c2d12',
                              color: '#fed7aa',
                              fontWeight: 700
                            }}
                          >
                            LIVE
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
                          key={`slot-${editingLayoutId}-${i}`}
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
                            <option value="">— Vacío (negro) —</option>
                            {cameraIds.map((cid) => (
                              <option key={cid} value={cid}>
                                {cameraAliases.resolve(cid)}
                                {cameraAliases.resolve(cid) !== cid ? ` (${cid})` : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                      )
                    })}
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    alignItems: 'center',
                    marginTop: 12
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      sendLayoutToProgram(editingLayoutId)
                      setConfigPopoverOpen(false)
                    }}
                    title="Manda este formato (con las cámaras configuradas) al programa"
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
                    Mandar “{getLayout(editingLayoutId).short}” al programa
                  </button>
                  <span style={{ fontSize: 10, color: '#475569' }}>
                    Editar acá no toca lo que ya está al aire (si no es el formato actual).
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
