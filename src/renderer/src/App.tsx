import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useCameraAliases } from './cameraAliases'
import { FloatingPcAudioPanel, readStoredPcAudioGainPercent } from './FloatingPcAudioPanel'
import { FusionPanel } from './FusionPanel'
import { LiveFusionPanel } from './LiveFusionPanel'
import { QrConnectOverlay } from './QrConnectOverlay'
import { usePcAudioMix } from './usePcAudioMix'
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

type StudioCameraWorkspace = 'live' | 'liveFusion'

type WorkspaceMode = 'live' | 'liveFusion' | 'fusion'

type SigMsg =
  | { type: 'camera-joined'; cameraId: string; name?: string; workspace?: StudioCameraWorkspace }
  | { type: 'camera-left'; cameraId: string }
  | { type: 'offer'; cameraId: string; sdp: string; workspace?: StudioCameraWorkspace }
  | { type: 'ice'; cameraId: string; candidate: RTCIceCandidateInit | null }

function normalizeStudioWorkspace(raw: unknown): StudioCameraWorkspace {
  return raw === 'liveFusion' ? 'liveFusion' : 'live'
}

function cameraMatchesWorkspace(camWs: StudioCameraWorkspace, mode: WorkspaceMode): boolean {
  if (mode === 'fusion') return false
  if (mode === 'live') return camWs === 'live'
  if (mode === 'liveFusion') return camWs === 'liveFusion'
  return false
}

const HOST_PANEL_HTTP_FALLBACK = 3777

async function hostSigPull(httpPort: number, max: number): Promise<string[]> {
  const r = await fetch(`http://127.0.0.1:${httpPort}/__studio/host-pull?max=${max}`)
  if (!r.ok) throw new Error(`host-pull HTTP ${r.status}`)
  const data: unknown = await r.json()
  return Array.isArray(data) ? (data as string[]) : []
}

async function hostSigPush(httpPort: number, raw: string): Promise<boolean> {
  const r = await fetch(`http://127.0.0.1:${httpPort}/__studio/host-push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: raw
  })
  return r.ok
}

const rtcConfig: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'balanced',
  rtcpMuxPolicy: 'require'
}

/** Clave interna para el MediaRecorder del audio de la PC (no es cameraId). */
const PC_AUDIO_RECORDER_KEY = 'pc-audio'

type PendingIsoSave = {
  session: number
  items: Array<{ recKey: string; parts: BlobPart[]; mime: string }>
}

function defaultIsoFolderLabel(session: number): string {
  const d = new Date(session)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `grabacion-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

function folderLeafFromPath(fullPath: string): string {
  const t = fullPath.replace(/[/\\]+$/, '')
  const i = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'))
  return i >= 0 ? t.slice(i + 1) : t
}

/**
 * VP8 delante: al grabar varias ISO a la vez el PC re-codifica cada pista; VP9 suele cargar más el CPU y favorecer fotogramas caídos.
 * (Misma idea que la fusión en `FusionPanel.tsx`.)
 */
function pickRecorderMime(): string | undefined {
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

function pickAudioRecorderMime(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm']
  if (typeof MediaRecorder === 'undefined') return undefined
  return candidates.find((c) => MediaRecorder.isTypeSupported(c))
}

const pcAudioConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false
} as const

type VideoPresetId = 'high' | 'medium' | 'low'

/** Bitrate objetivo del WebM ISO en PC (alineado al preset de URL del celular). */
function isoVideoBitsPerSecondForPreset(preset: VideoPresetId): number {
  switch (preset) {
    case 'high':
      return 4_000_000
    case 'medium':
      return 2_500_000
    case 'low':
      return 1_200_000
    default:
      return 2_500_000
  }
}

const ISO_AUDIO_BITS_PER_SECOND = 160_000

const VIDEO_PRESET_OPTIONS: {
  id: VideoPresetId
  label: string
  hint: string
}[] = [
  {
    id: 'high',
    label: 'Alta — 1080p ~30 fps',
    hint: 'Más bitrate; mejor Wi-Fi o pocas cámaras.'
  },
  {
    id: 'medium',
    label: 'Media — 720p ~24 fps',
    hint: 'Equilibrio recomendado por defecto.'
  },
  {
    id: 'low',
    label: 'Baja — 480p ~24 fps',
    hint: 'Wi-Fi flojo o hasta 6 celulares.'
  }
]

export default function App() {
  const [info, setInfo] = useState<{
    port: number
    loopbackSignalingPort: number
    hostPanelHttpPort: number
    ips: string[]
  } | null>(null)
  const [status, setStatus] = useState('Conectando al servidor local...')
  const [cameras, setCameras] = useState<string[]>([])
  const [streams, setStreams] = useState<Record<string, MediaStream>>({})
  const [outputDir, setOutputDir] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  /** Tras detener ISO: blobs en memoria hasta elegir nombre de carpeta y guardar. */
  const [pendingIsoSave, setPendingIsoSave] = useState<PendingIsoSave | null>(null)
  const [isoFolderNameDraft, setIsoFolderNameDraft] = useState('')

  /** Grabando ISO o con archivos en memoria esperando nombre de carpeta. */
  const isoBusy = recording || pendingIsoSave != null

  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([])
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState<string>('')
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null)
  const [pcAudioGainPercent, setPcAudioGainPercent] = useState(() => readStoredPcAudioGainPercent())
  const [audioNote, setAudioNote] = useState<string | null>(null)
  const [videoPreset, setVideoPreset] = useState<VideoPresetId>('medium')
  const [signalingReady, setSignalingReady] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  /** Cartelito flotante "Grabación guardada" tras confirmar el nombre de la carpeta. */
  const [isoSavedToast, setIsoSavedToast] = useState<{ folder: string; path: string } | null>(null)
  const [audioPanelOpen, setAudioPanelOpen] = useState(false)
  /** Estado WebRTC por “pista” (estilo mezclador): new | connecting | connected | disconnected | failed */
  const [laneRtcState, setLaneRtcState] = useState<Record<string, string>>({})
  /** Cámara ampliada al hacer clic en la miniatura */
  const [expandedCameraId, setExpandedCameraId] = useState<string | null>(null)
  /** Si el celu manda la imagen “de costado”, podés corregir con ↻ (90° por toque). */
  const [manualRotateDeg, setManualRotateDeg] = useState<Record<string, number>>({})
  /** Tiempo ISO transcurrido mostrado (00:00 o H:MM:SS). */
  const [isoElapsedLabel, setIsoElapsedLabel] = useState('00:00')
  /** Separar flujo de celulares + ISO del flujo de edición de fusión (evita mezclar sesiones). */
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('live')
  const workspaceModeRef = useRef<WorkspaceMode>('live')

  /** Alias amigables por cameraId, persistidos en localStorage. */
  const cameraAliases = useCameraAliases()

  const bumpRotate = useCallback((id: string) => {
    setManualRotateDeg((prev) => ({
      ...prev,
      [id]: ((prev[id] ?? 0) + 90) % 360
    }))
  }, [])

  /** Hay canal activo con el servidor local (HTTP loopback o IPC). */
  const signalingOkRef = useRef(false)
  const hostPanelHttpPortRef = useRef(0)
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const iceQueuesRef = useRef<Map<string, RTCIceCandidate[]>>(new Map())
  const recordersRef = useRef<Map<string, MediaRecorder>>(new Map())
  const chunksRef = useRef<Map<string, BlobPart[]>>(new Map())
  const sessionRef = useRef<number>(0)
  /** Inicio de la grabación ISO actual (para cronómetro). */
  const isoRecordingStartedAtRef = useRef<number | null>(null)
  const openQrPopover = useCallback(() => {
    setQrOpen(true)
  }, [])
  const openAudioPanel = useCallback(() => {
    setAudioPanelOpen(true)
  }, [])

  useEffect(() => {
    workspaceModeRef.current = workspaceMode
  }, [workspaceMode])

  const pingUrls = useMemo(() => {
    if (!info) return []
    return info.ips.map((ip) => `https://${ip}:${info.port}/__studio/ping`)
  }, [info])

  const localPreviewUrl = useMemo(() => {
    if (!info) return ''
    if (workspaceMode === 'fusion') return ''
    const wsParam = workspaceMode === 'liveFusion' ? 'liveFusion' : 'live'
    return `https://127.0.0.1:${info.port}/?preset=${encodeURIComponent(videoPreset)}&studioWorkspace=${wsParam}`
  }, [info, videoPreset, workspaceMode])

  /** Evita tiles vacíos si el video llega antes que el estado camera-joined */
  const tileCameraIds = useMemo(() => {
    const ids = new Set(cameras)
    for (const id of Object.keys(streams)) ids.add(id)
    return [...ids].sort()
  }, [cameras, streams])

  const pcMix = usePcAudioMix(audioStream, pcAudioGainPercent / 100)
  const pcRecordingStream = pcMix.processedStream ?? audioStream

  /** Resumen de lo que entrará en la grabación ISO simultánea (no es solo “estar en vivo”). */
  const isoSourcesSummary = useMemo(() => {
    const camCount = Object.values(streams).filter((s) =>
      s?.getVideoTracks().some((t) => t.readyState !== 'ended')
    ).length
    const hasPcAudio = Boolean(audioStream?.getAudioTracks().some((t) => t.readyState === 'live'))
    const parts: string[] = []
    if (camCount) parts.push(`${camCount} cámara${camCount !== 1 ? 's' : ''}`)
    if (hasPcAudio) parts.push('audio de PC')
    return {
      camCount,
      hasPcAudio,
      label: parts.length ? parts.join(' + ') : 'ninguna fuente lista todavía'
    }
  }, [streams, audioStream])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const bridge = (
        window as unknown as {
          studio?: { getInfo: () => Promise<Record<string, unknown>> }
        }
      ).studio
      if (!bridge?.getInfo) {
        setStatus(
          'No hay acceso al proceso de Electron: no abras solo http://localhost:5173 en el navegador. Ejecutá «npm run dev» y usá la ventana «Studio Live» que abre aparte, o el ejecutable empaquetado.'
        )
        return
      }
      try {
        const raw = await bridge.getInfo()
        if (cancelled) return
        const port = Number(raw.port)
        const loop =
          typeof raw.loopbackSignalingPort === 'number'
            ? raw.loopbackSignalingPort
            : port + 4000
        const ips = Array.isArray(raw.ips) ? (raw.ips as string[]) : []
        const hostPanelHttpPort =
          typeof raw.hostPanelHttpPort === 'number' && raw.hostPanelHttpPort > 0
            ? raw.hostPanelHttpPort
            : port + HOST_PANEL_HTTP_FALLBACK
        if (!Number.isFinite(port)) throw new Error('Puerto inválido')
        hostPanelHttpPortRef.current = hostPanelHttpPort
        setInfo({ port, loopbackSignalingPort: loop, hostPanelHttpPort, ips })
        setStatus('Listo. Escaneá el QR con cada celular (en Configuración) y tocá "Transmitir".')
      } catch (e) {
        console.error('studio:get-info', e)
        setStatus(
          `No se pudo leer la configuración del estudio (${e instanceof Error ? e.message : String(e)}). Reiniciá la app.`
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const closeCamera = useCallback((cameraId: string) => {
    const pc = pcsRef.current.get(cameraId)
    if (pc) {
      pc.close()
      pcsRef.current.delete(cameraId)
    }
    iceQueuesRef.current.delete(cameraId)
    setStreams((prev) => {
      const n = { ...prev }
      delete n[cameraId]
      return n
    })
    setCameras((prev) => prev.filter((id) => id !== cameraId))
    setLaneRtcState((prev) => {
      const n = { ...prev }
      delete n[cameraId]
      return n
    })
    setManualRotateDeg((prev) => {
      const n = { ...prev }
      delete n[cameraId]
      return n
    })
  }, [])

  /** Una sola pestaña «activa» para las cámaras: al cambiar se cierran los PeerConnections en la PC. */
  const workspaceSwitchSkipRef = useRef(true)
  useEffect(() => {
    if (workspaceSwitchSkipRef.current) {
      workspaceSwitchSkipRef.current = false
      return
    }
    for (const id of [...pcsRef.current.keys()]) {
      closeCamera(id)
    }
    setExpandedCameraId(null)
    setStatus(
      'Pestaña cambiada: se cerraron las conexiones WebRTC de la sesión anterior. Escaneá de nuevo el QR de esta pestaña en cada celular y tocá Transmitir.'
    )
  }, [workspaceMode, closeCamera])

  const handleOffer = useCallback(async (cameraId: string, sdp: string, workspaceRaw?: StudioCameraWorkspace) => {
    // No usar signalingOkRef aquí: si la insignia «Señalización» falla pero el IPC sí entrega ofertas,
    // hay que negociar igual o el celular queda en «Transmitiendo» sin video en la PC.

    const camWs = normalizeStudioWorkspace(workspaceRaw)
    if (!cameraMatchesWorkspace(camWs, workspaceModeRef.current)) {
      return
    }

    const prev = pcsRef.current.get(cameraId)
    if (prev) prev.close()

    const pc = new RTCPeerConnection(rtcConfig)
    pcsRef.current.set(cameraId, pc)
    setLaneRtcState((prev) => ({ ...prev, [cameraId]: pc.connectionState }))

    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track])
      setStreams((prev) => ({ ...prev, [cameraId]: stream }))
      setCameras((prev) => (prev.includes(cameraId) ? prev : [...prev, cameraId]))
      setLaneRtcState((prev) => ({ ...prev, [cameraId]: pc.connectionState }))
      setStatus(`Recibiendo video — cámara ${cameraId}`)
    }

    pc.onicecandidate = (ev) => {
      const payload = JSON.stringify({
        type: 'ice',
        cameraId,
        candidate: ev.candidate?.toJSON() ?? null
      })
      const hp = hostPanelHttpPortRef.current
      if (hp > 0) void hostSigPush(hp, payload)
      else void window.studio.sendSig(payload)
    }

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState
      setLaneRtcState((prev) => ({ ...prev, [cameraId]: st }))
      if (st === 'failed') {
        setStatus(
          `WebRTC falló (${cameraId}). En Windows: Firewall → permitir Studio Live en «Red privada». Refrescá la página del celular.`
        )
      }
      if (st === 'connected') {
        setStatus(`En vivo — cámara ${cameraId}`)
      }
    }

    const queued = iceQueuesRef.current.get(cameraId) ?? []
    iceQueuesRef.current.set(cameraId, [])

    await pc.setRemoteDescription({ type: 'offer', sdp })
    for (const c of queued) await pc.addIceCandidate(c).catch(() => {})

    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    const answerPayload = JSON.stringify({
      type: 'answer',
      cameraId,
      sdp: pc.localDescription?.sdp ?? ''
    })
    const hp = hostPanelHttpPortRef.current
    const answerSent =
      hp > 0 ? await hostSigPush(hp, answerPayload) : await window.studio.sendSig(answerPayload)
    if (!answerSent) {
      setStatus(
        'No se pudo enviar la respuesta al celular. Reiniciá Studio Live; en Windows permití Studio Live en firewall (red privada).'
      )
    }
  }, [])

  const handleIce = useCallback(async (cameraId: string, candidate: RTCIceCandidateInit | null) => {
    if (!candidate) return
    const pc = pcsRef.current.get(cameraId)
    const ice = new RTCIceCandidate(candidate)
    if (!pc || !pc.remoteDescription) {
      const q = iceQueuesRef.current.get(cameraId) ?? []
      q.push(ice)
      iceQueuesRef.current.set(cameraId, q)
      return
    }
    await pc.addIceCandidate(ice).catch(() => {})
  }, [])

  useEffect(() => {
    if (!info) return

    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | undefined

    const dispatchSig = async (raw: string) => {
      let msg: SigMsg
      try {
        msg = JSON.parse(raw) as SigMsg
      } catch {
        return
      }
      if (msg.type === 'camera-joined') {
        signalingOkRef.current = true
        setSignalingReady(true)
        const camWs = normalizeStudioWorkspace(msg.workspace)
        if (!cameraMatchesWorkspace(camWs, workspaceModeRef.current)) {
          setStatus(
            `Un celular se registró con otra URL de modo (${camWs === 'liveFusion' ? 'Fusión en vivo' : 'Sesión en vivo'}). Esta pestaña usa ${
              workspaceModeRef.current === 'liveFusion' ? 'Fusión en vivo' : workspaceModeRef.current === 'live' ? 'Sesión en vivo' : 'archivos'
            } — escaneá el QR de esta pestaña o cambiá a la pestaña correcta.`
          )
          return
        }
        setCameras((prev) => (prev.includes(msg.cameraId) ? prev : [...prev, msg.cameraId]))
        setLaneRtcState((prev) => ({
          ...prev,
          [msg.cameraId]: prev[msg.cameraId] ?? 'new'
        }))
        return
      }
      if (msg.type === 'camera-left') {
        closeCamera(msg.cameraId)
        return
      }
      if (msg.type === 'offer') {
        signalingOkRef.current = true
        setSignalingReady(true)
        try {
          await handleOffer(msg.cameraId, msg.sdp, msg.workspace)
        } catch (e) {
          console.error(e)
          setStatus(
            `Error al negociar video (${msg.cameraId}): ${e instanceof Error ? e.message : String(e)}`
          )
        }
        return
      }
      if (msg.type === 'ice') {
        await handleIce(msg.cameraId, msg.candidate)
      }
    }

    const tick = async () => {
      try {
        const hp = info.hostPanelHttpPort
        const batch =
          hp > 0
            ? await hostSigPull(hp, 120)
            : await window.studio.drainSigMsgs(120)
        if (cancelled) return
        signalingOkRef.current = true
        setSignalingReady(true)
        for (const raw of batch) await dispatchSig(raw)
      } catch (e) {
        console.error('[studio-live] señalización (HTTP loopback o IPC)', e)
        if (!cancelled) {
          setSignalingReady(false)
          signalingOkRef.current = false
        }
      }
    }

    void tick()
    intervalId = window.setInterval(() => void tick(), 35)

    return () => {
      cancelled = true
      if (intervalId !== undefined) window.clearInterval(intervalId)
      signalingOkRef.current = false
      setSignalingReady(false)
      for (const id of [...pcsRef.current.keys()]) closeCamera(id)
      pcsRef.current.clear()
    }
  }, [info, closeCamera, handleIce, handleOffer])

  const pickFolder = async () => {
    const p = await window.studio.pickOutputDir()
    setOutputDir(p)
  }

  const refreshAudioDeviceList = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const list = await navigator.mediaDevices.enumerateDevices()
    setAudioInputs(list.filter((d) => d.kind === 'audioinput'))
  }, [])

  const preparePcAudio = useCallback(async () => {
    setAudioNote(null)
    try {
      audioStream?.getTracks().forEach((t) => t.stop())

      const audioConstraints: MediaTrackConstraints = {
        ...pcAudioConstraints,
        ...(selectedAudioDeviceId ? { deviceId: { exact: selectedAudioDeviceId } } : {})
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false
      })
      setAudioStream(stream)
      await refreshAudioDeviceList()
      setStatus(
        'Audio de PC activo (opcional). Si no tenés interfaz, igual podés usar solo las cámaras del celular.'
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setAudioStream(null)
      setAudioNote(
        `No se activó el audio de la PC (${msg}). No pasa nada: las cámaras por HTTPS no dependen de esto.`
      )
    }
  }, [audioStream, refreshAudioDeviceList, selectedAudioDeviceId])

  useEffect(() => {
    void refreshAudioDeviceList()
  }, [refreshAudioDeviceList])

  useEffect(() => {
    return () => {
      audioStream?.getTracks().forEach((t) => t.stop())
    }
  }, [audioStream])

  useEffect(() => {
    if (!expandedCameraId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpandedCameraId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expandedCameraId])

  useEffect(() => {
    if (!recording) {
      setIsoElapsedLabel('00:00')
      return
    }
    const started = isoRecordingStartedAtRef.current ?? Date.now()
    isoRecordingStartedAtRef.current = started

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

    const tick = () => setIsoElapsedLabel(fmt(Date.now() - started))
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [recording])

  const stopRecording = useCallback(async () => {
    const recMap = recordersRef.current
    const chunksMap = chunksRef.current
    const session = sessionRef.current

    const mimeByCam = new Map<string, string>()
    for (const [id, rec] of recMap.entries()) mimeByCam.set(id, rec.mimeType)

    await Promise.all(
      [...recMap.entries()].map(
        ([, rec]) =>
          new Promise<void>((resolve) => {
            rec.onstop = () => resolve()
            try {
              rec.stop()
            } catch {
              resolve()
            }
          })
      )
    )

    recMap.clear()

    const items: PendingIsoSave['items'] = []
    for (const [recKey, parts] of chunksMap.entries()) {
      items.push({
        recKey,
        parts: [...parts],
        mime:
          mimeByCam.get(recKey) ??
          (recKey === PC_AUDIO_RECORDER_KEY ? 'audio/webm' : 'video/webm')
      })
    }

    chunksMap.clear()
    isoRecordingStartedAtRef.current = null
    setRecording(false)

    if (!items.length) {
      setStatus('No había datos en las pistas al detener.')
      return
    }

    setPendingIsoSave({ session, items })
    setIsoFolderNameDraft(defaultIsoFolderLabel(session))
    setStatus(
      'Grabación detenida. Elegí un nombre de carpeta y tocá Guardar (no puede repetirse si ya existe esa carpeta con .webm).'
    )
  }, [])

  const confirmIsoSave = useCallback(async () => {
    if (!pendingIsoSave || !outputDir) return
    const prep = await window.studio.prepareRecordingFolder(outputDir, isoFolderNameDraft)
    if (!prep.ok) {
      setStatus(prep.message)
      return
    }
    const dest = prep.destDir
    const { session, items } = pendingIsoSave
    try {
      for (const item of items) {
        const blob = new Blob(item.parts, { type: item.mime })
        const buf = await blob.arrayBuffer()
        const name =
          item.recKey === PC_AUDIO_RECORDER_KEY
            ? `audio-${session}.webm`
            : `cam-${item.recKey}-${session}.webm`
        await window.studio.saveVideo(`${dest}/${name}`, buf)
      }
      setPendingIsoSave(null)
      const leaf = folderLeafFromPath(dest)
      setStatus(
        `Grabación guardada en «${leaf}» (subcarpeta dentro de tu carpeta de grabación). Para fusión, cargá los cam-*.webm desde ahí.`
      )
      setIsoSavedToast({ folder: leaf, path: dest })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStatus(`Error al guardar: ${msg}`)
    }
  }, [pendingIsoSave, outputDir, isoFolderNameDraft])

  /** Auto-cierre del cartelito de guardado tras 6 s. */
  useEffect(() => {
    if (!isoSavedToast) return
    const id = window.setTimeout(() => setIsoSavedToast(null), 6000)
    return () => window.clearTimeout(id)
  }, [isoSavedToast])

  const discardPendingIso = useCallback(() => {
    if (!pendingIsoSave) return
    if (!window.confirm('¿Descartar esta grabación? No se guardará ningún archivo.')) return
    setPendingIsoSave(null)
    setStatus('Grabación descartada (no se guardó ningún archivo).')
  }, [pendingIsoSave])

  const startRecording = useCallback(async () => {
    if (!outputDir) {
      setStatus('Elegí una carpeta de grabación antes.')
      return
    }
    if (pendingIsoSave) {
      setStatus('Primero guardá o descartá la grabación anterior (ventana de nombre de carpeta).')
      return
    }

    const videoMime = pickRecorderMime()
    const audioMime = pickAudioRecorderMime()
    const isoVideoBps = isoVideoBitsPerSecondForPreset(videoPreset)
    sessionRef.current = Date.now()
    chunksRef.current = new Map()
    recordersRef.current = new Map()

    let anyTrack = false

    try {
      for (const id of Object.keys(streams)) {
        const stream = streams[id]
        if (!stream) continue
        if (!stream.getVideoTracks().some((t) => t.readyState !== 'ended')) continue
        anyTrack = true
        const chunks: BlobPart[] = []
        chunksRef.current.set(id, chunks)

        const rec = videoMime
          ? new MediaRecorder(stream, { mimeType: videoMime, videoBitsPerSecond: isoVideoBps })
          : new MediaRecorder(stream, { videoBitsPerSecond: isoVideoBps })
        rec.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data)
        }
        recordersRef.current.set(id, rec)
        /** Chunk cada 500 ms: menos callbacks al hilo principal que 250 ms (varias cámaras a la vez). */
        rec.start(500)
      }

      if (pcRecordingStream?.getAudioTracks().length) {
        anyTrack = true
        const chunks: BlobPart[] = []
        chunksRef.current.set(PC_AUDIO_RECORDER_KEY, chunks)
        const rec = audioMime
          ? new MediaRecorder(pcRecordingStream, {
              mimeType: audioMime,
              audioBitsPerSecond: ISO_AUDIO_BITS_PER_SECOND
            })
          : new MediaRecorder(pcRecordingStream, { audioBitsPerSecond: ISO_AUDIO_BITS_PER_SECOND })
        rec.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data)
        }
        recordersRef.current.set(PC_AUDIO_RECORDER_KEY, rec)
        rec.start(500)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      recordersRef.current.forEach((r) => {
        try {
          r.stop()
        } catch {
          /* vacío */
        }
      })
      recordersRef.current.clear()
      chunksRef.current.clear()
      isoRecordingStartedAtRef.current = null
      setStatus(`No se pudo iniciar la grabación: ${msg}`)
      return
    }

    if (!anyTrack) {
      setStatus(
        'No hay fuentes para grabar: escaneá el QR con el celular y tocá Transmitir, o activá «Audio de PC» en configuración.'
      )
      return
    }

    isoRecordingStartedAtRef.current = Date.now()
    setRecording(true)
    setStatus(
      'Grabación en curso: un archivo por cada cámara en vivo + audio de PC si está activo. Detené para escribir los archivos.'
    )
  }, [pcRecordingStream, outputDir, pendingIsoSave, streams, videoPreset])

  const toggleRecord = async () => {
    try {
      if (recording) await stopRecording()
      else await startRecording()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStatus(`Grabación: ${msg}`)
    }
  }

  const onRecordClick = () => {
    if (recording) {
      void toggleRecord()
      return
    }
    if (pendingIsoSave) {
      setStatus('Primero guardá o descartá la grabación anterior (ventana de nombre de carpeta).')
      return
    }
    if (!outputDir) {
      setStatus('Elegí «Carpeta de grabación» arriba antes de grabar.')
      return
    }
    const hasCameras = Object.keys(streams).some((id) => {
      const s = streams[id]
      return s?.getVideoTracks().some((t) => t.readyState === 'live')
    })
    const hasPcAudio = Boolean(audioStream?.getAudioTracks().some((t) => t.readyState === 'live'))
    if (!hasCameras && workspaceMode !== 'fusion') {
      openQrPopover()
      setStatus(
        hasPcAudio
          ? 'No hay cámaras conectadas. Escaneá el QR con cada celular y tocá Transmitir, o seguí sólo con audio de PC reapretando «Iniciar grabación multicámara».'
          : 'No hay cámaras conectadas. Escaneá el QR con cada celular y tocá Transmitir, o activá «Audio de PC» (botón verde) si vas a grabar sólo audio.'
      )
      return
    }
    if (!hasCameras && !hasPcAudio) {
      setStatus(
        'No hay fuentes para grabar. Activá «Audio de PC» o conectá un celular antes de iniciar la grabación.'
      )
      return
    }
    void toggleRecord()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid #1e293b',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap'
        }}
      >
        <strong style={{ letterSpacing: 0.3 }}>Studio Live</strong>
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            flexWrap: 'wrap'
          }}
          role="tablist"
          aria-label="Modo de trabajo"
        >
          <button
            type="button"
            role="tab"
            aria-selected={workspaceMode === 'live'}
            onClick={() => setWorkspaceMode('live')}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border:
                workspaceMode === 'live' ? '2px solid #38bdf8' : '1px solid #334155',
              background: workspaceMode === 'live' ? '#0c4a6e' : '#0f172a',
              color: '#e2e8f0',
              fontSize: 12,
              fontWeight: workspaceMode === 'live' ? 700 : 500
            }}
          >
            1 · Sesión en vivo
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workspaceMode === 'fusion'}
            onClick={() => {
              if (isoBusy) {
                setStatus(
                  pendingIsoSave
                    ? 'Guardá o descartá la grabación pendiente (por pistas) antes de pasar a modo Fusión.'
                    : 'Detené la grabación antes de pasar a modo Fusión.'
                )
                return
              }
              setWorkspaceMode('fusion')
            }}
            disabled={isoBusy}
            title={
              isoBusy
                ? pendingIsoSave
                  ? 'Guardá o descartá la grabación antes de usar Fusión'
                  : 'No podés pasar a Fusión mientras grabás'
                : 'Editar fusión con archivos ya guardados (paso 2 después de Sesión en vivo)'
            }
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border:
                workspaceMode === 'fusion' ? '2px solid #a78bfa' : '1px solid #334155',
              background: workspaceMode === 'fusion' ? '#4c1d95' : '#0f172a',
              color: '#e2e8f0',
              fontSize: 12,
              fontWeight: workspaceMode === 'fusion' ? 700 : 500,
              opacity: isoBusy ? 0.45 : 1
            }}
          >
            2 · Fusión (archivos)
          </button>
          <span aria-hidden style={{ color: '#475569', fontSize: 12, padding: '0 4px' }}>·</span>
          <button
            type="button"
            role="tab"
            aria-selected={workspaceMode === 'liveFusion'}
            onClick={() => {
              if (isoBusy) {
                setStatus(
                  pendingIsoSave
                    ? 'Guardá o descartá la grabación pendiente (por pistas) antes de pasar a Fusión en vivo.'
                    : 'Detené la grabación antes de pasar a Fusión en vivo.'
                )
                return
              }
              setWorkspaceMode('liveFusion')
            }}
            disabled={isoBusy}
            title={
              isoBusy
                ? pendingIsoSave
                  ? 'Guardá o descartá la grabación antes de usar Fusión en vivo'
                  : 'No podés cambiar de pestaña mientras grabás'
                : 'Alternativa: mezcla en vivo con los celulares (graba ya mezclado, sin pistas separadas).'
            }
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border:
                workspaceMode === 'liveFusion' ? '2px solid #14b8a6' : '1px solid #334155',
              background: workspaceMode === 'liveFusion' ? '#134e4a' : '#0f172a',
              color: '#e2e8f0',
              fontSize: 12,
              fontWeight: workspaceMode === 'liveFusion' ? 700 : 500,
              opacity: isoBusy ? 0.45 : 1
            }}
          >
            Alt · Fusión en vivo
          </button>
        </div>
        <span
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 6,
            background: signalingReady ? '#14532d' : '#450a0a',
            color: signalingReady ? '#bbf7d0' : '#fecaca'
          }}
          title="IPC con el proceso principal: vaciado periódico de mensajes del servidor HTTPS/WSS"
        >
          {signalingReady ? 'Señalización: OK' : 'Señalización: no'}
        </span>
        <span style={{ flex: 1 }} />
      </header>

      <section style={{ padding: 16, flex: 1, overflow: 'auto' }}>
        <div style={{ display: workspaceMode === 'live' ? 'block' : 'none' }}>
        <div style={workspaceToolbar('sky')}>
          <div style={workspaceEyebrow}>Paso 1 · Grabar por pistas (una pista por cámara + audio)</div>
          <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.55, maxWidth: 720 }}>
            <strong style={{ color: '#e2e8f0' }}>Transmitir desde el celular solo muestra el vídeo en la PC.</strong>{' '}
            Para guardar archivos hace falta iniciar la grabación (botón abajo, cerca de las cámaras): se graban{' '}
            <strong style={{ color: '#e2e8f0' }}>al mismo tiempo</strong> todas las cámaras conectadas y el audio de PC
            (si lo activaste). Al detener se te pide un <strong style={{ color: '#e2e8f0' }}>nombre de carpeta</strong>{' '}
            y los <code style={{ color: '#cbd5e1' }}>cam-*.webm</code> / <code style={{ color: '#cbd5e1' }}>audio-*.webm</code>{' '}
            quedan dentro; después usás «Fusión» (paso 2) para mezclarlas.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <span style={workspaceActionRowLabel}>Carpeta y conexión</span>
            <button
              type="button"
              onClick={pickFolder}
              disabled={Boolean(pendingIsoSave)}
              title={
                pendingIsoSave
                  ? 'Guardá o descartá la grabación pendiente antes de cambiar la carpeta.'
                  : undefined
              }
              style={{
                ...btnNeutral,
                opacity: pendingIsoSave ? 0.55 : 1,
                cursor: pendingIsoSave ? 'not-allowed' : 'pointer'
              }}
            >
              Carpeta de grabación
            </button>
            <button
              type="button"
              onClick={openQrPopover}
              style={btnQr}
              title="Abre un popover con el QR (mismo Wi-Fi) para escanear desde el celular."
            >
              <span aria-hidden style={{ fontSize: 14 }}>▦</span> QR de cámaras (Sesión en vivo)
            </button>
            <button
              type="button"
              onClick={openAudioPanel}
              style={btnAudio}
              title="Abre un panel flotante con selección de mic, nivel, ganancia y aviso de saturación."
            >
              <span aria-hidden style={{ fontSize: 14 }}>♪</span>
              {audioStream ? ' Audio de PC · activo' : ' Audio de PC'}
            </button>
          </div>
          {outputDir ? (
            <div style={pathLineMuted}>
              Carpeta: <span style={pathTextBright}>{outputDir}</span>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#475569' }}>
              Elegí carpeta de grabación para poder guardar WebM al detener.
            </div>
          )}
        </div>

        <div style={{ width: '100%', maxWidth: '100%' }}>
          <div style={{ fontSize: 11, color: '#64748b', letterSpacing: 0.06, textTransform: 'uppercase', marginBottom: 10 }}>
            Entradas en vivo — hasta 3 por fila · clic en el vídeo para ampliar · ↻ gira 90° · ✕ cierra la cámara
          </div>
          <div className="camera-grid">
            {tileCameraIds.map((id) => (
              <CameraTile
                key={id}
                cameraId={id}
                alias={cameraAliases.aliases[id] ?? null}
                onRename={(next) => cameraAliases.setAlias(id, next)}
                stream={streams[id]}
                rtcState={laneRtcState[id]}
                rotateDeg={manualRotateDeg[id] ?? 0}
                onRotate90={() => bumpRotate(id)}
                onExpand={() => setExpandedCameraId(id)}
                onClose={() => {
                  if (expandedCameraId === id) setExpandedCameraId(null)
                  closeCamera(id)
                  setStatus(`Cámara ${cameraAliases.resolve(id)} cerrada desde el panel.`)
                }}
              />
            ))}
          </div>
          {!tileCameraIds.length ? (
            <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
              <strong style={{ color: '#cbd5e1' }}>Esperando cámaras…</strong> Escaneá el{' '}
              <strong style={{ color: '#e2e8f0' }}>QR de Sesión en vivo</strong> (botón arriba) con cada celular y tocá{' '}
              <strong style={{ color: '#e2e8f0' }}>Transmitir</strong>. Si «Señalización» no pasa a OK en unos
              segundos, reiniciá la app.
            </div>
          ) : null}
        </div>

        <div
          style={{
            marginTop: 14,
            padding: '12px 14px',
            borderRadius: 12,
            border: recording ? '1px solid #7f1d1d' : '1px solid #334155',
            background: recording ? '#1a0a0a' : '#0a1628',
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <span style={workspaceActionRowLabel}>Grabación multicámara</span>
            <button
              type="button"
              disabled={Boolean(pendingIsoSave && !recording)}
              title={
                recording
                  ? 'Finaliza la grabación; después elegís el nombre de carpeta y se guardan los WebM.'
                  : pendingIsoSave
                    ? 'Primero guardá o descartá la grabación pendiente (ventana de nombre).'
                    : 'Inicia grabación simultánea: un archivo por cámara (+ audio PC si aplica). Requiere carpeta y al menos una fuente.'
              }
              onClick={onRecordClick}
              style={{
                padding: '10px 18px',
                borderRadius: 8,
                border: '1px solid transparent',
                background: recording ? '#b91c1c' : pendingIsoSave ? '#475569' : '#1d4ed8',
                color: 'white',
                cursor: pendingIsoSave && !recording ? 'not-allowed' : 'pointer',
                fontWeight: 700,
                fontSize: 13,
                opacity: pendingIsoSave && !recording ? 0.75 : 1
              }}
            >
              {recording
                ? 'Finalizar grabación'
                : pendingIsoSave
                  ? 'Pendiente: nombre de carpeta…'
                  : 'Iniciar grabación multicámara'}
            </button>
            {recording ? (
              <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10, flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#fca5a5' }}>● REC</span>
                <span
                  title="Tiempo de grabación (una pista por cámara + audio si aplica)"
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    fontFamily: 'ui-monospace, monospace',
                    color: '#fecaca',
                    letterSpacing: 0.04
                  }}
                >
                  {isoElapsedLabel}
                </span>
              </span>
            ) : (
              <span style={{ fontSize: 11, color: '#64748b' }}>
                Fuentes:{' '}
                <span style={{ color: isoSourcesSummary.camCount || isoSourcesSummary.hasPcAudio ? '#86efac' : '#fbbf24' }}>
                  {isoSourcesSummary.label}
                </span>
              </span>
            )}
            <span style={{ flex: '1 1 220px', fontSize: 12, color: '#94a3b8', minWidth: 0, lineHeight: 1.4 }}>
              {status}
            </span>
          </div>
        </div>

        {expandedCameraId ? (
          <CameraExpandOverlay
            cameraId={expandedCameraId}
            alias={cameraAliases.aliases[expandedCameraId] ?? null}
            stream={streams[expandedCameraId]}
            rtcState={laneRtcState[expandedCameraId]}
            rotateDeg={manualRotateDeg[expandedCameraId] ?? 0}
            onRotate90={() => bumpRotate(expandedCameraId)}
            onClose={() => setExpandedCameraId(null)}
          />
        ) : null}
        </div>

        <FloatingPcAudioPanel
          open={audioPanelOpen && (workspaceMode === 'live' || workspaceMode === 'liveFusion')}
          onClose={() => setAudioPanelOpen(false)}
          disabled={isoBusy}
          audioInputs={audioInputs}
          selectedDeviceId={selectedAudioDeviceId}
          onDeviceChange={setSelectedAudioDeviceId}
          onActivate={() => void preparePcAudio()}
          audioNote={audioNote}
          rawStream={audioStream}
          analyser={pcMix.analyser}
          gainPercent={pcAudioGainPercent}
          onGainPercentChange={setPcAudioGainPercent}
        />

        <QrConnectOverlay
          open={qrOpen && workspaceMode !== 'fusion'}
          onClose={() => setQrOpen(false)}
          ips={info?.ips ?? []}
          port={info?.port ?? null}
          preset={videoPreset}
          workspace={workspaceMode === 'liveFusion' ? 'liveFusion' : 'live'}
          presetOptions={VIDEO_PRESET_OPTIONS}
          onPresetChange={(id) => setVideoPreset(id as VideoPresetId)}
          presetDisabled={isoBusy}
          pingUrls={pingUrls}
          localPreviewUrl={localPreviewUrl}
          onCopyUrl={(u) => {
            void window.studio.copyText(u).then(() =>
              setStatus('URL copiada al portapapeles. Pegala en el navegador del celular (Chrome / Safari).')
            )
          }}
          onExportCert={() => {
            void window.studio.exportCert().then((ok) =>
              setStatus(
                ok
                  ? 'Certificado guardado. Pasalo al celular e instalalo (ver ayuda del popover).'
                  : 'No se pudo exportar el certificado (¿guardaste antes que arrancara el servidor?).'
              )
            )
          }}
        />

        <div style={{ display: workspaceMode === 'liveFusion' ? 'block' : 'none' }}>
          <LiveFusionPanel
            cameraIds={tileCameraIds}
            streams={streams}
            rtcStates={laneRtcState}
            manualRotateDeg={manualRotateDeg}
            onRotate90={bumpRotate}
            outputDir={outputDir}
            audioStream={pcRecordingStream}
            onStatus={setStatus}
            isoBusy={isoBusy}
            onPickOutputDir={() => void pickFolder()}
            onOpenQr={openQrPopover}
            onOpenAudio={openAudioPanel}
            hasPcAudio={Boolean(audioStream)}
          />
        </div>

        <div style={{ display: workspaceMode === 'fusion' ? 'block' : 'none' }}>
          <div style={workspaceToolbar('violet')}>
            <div style={workspaceEyebrow}>Paso 2 · Fusión con archivos (post-grabación)</div>
            <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.55, maxWidth: 720 }}>
              Acá cargás los <code style={{ color: '#cbd5e1' }}>cam-*.webm</code> ya grabados del paso 1. La cuadrícula en
              vivo y el QR de celulares están en las otras pestañas para no mezclar sesiones.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <span style={workspaceActionRowLabel}>Carpeta y navegación</span>
              <button type="button" onClick={() => void pickFolder()} style={btnNeutral}>
                Carpeta de grabación
              </button>
              <button
                type="button"
                onClick={() => setWorkspaceMode('live')}
                style={{ ...btnNeutral, fontWeight: 600 }}
              >
                Volver a sesión en vivo
              </button>
            </div>
            {outputDir ? (
              <div style={pathLineMuted}>
                Carpeta: <span style={pathTextBright}>{outputDir}</span>
              </div>
            ) : (
              <div style={warnLineNoFolder}>
                <strong style={{ color: '#fef3c7' }}>Sin carpeta elegida.</strong> Tocá «Carpeta de grabación» en esta
                barra (o «Elegir carpeta…» en el panel de abajo si ya scrolleaste) para poder guardar la fusión exportada.
              </div>
            )}
          </div>
          <FusionPanel
            outputDir={outputDir}
            liveRecording={isoBusy}
            onStatus={setStatus}
            onPickOutputDir={() => void pickFolder()}
          />
        </div>
      </section>

      {pendingIsoSave ? (
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
            background: 'rgba(2, 6, 23, 0.78)',
            backdropFilter: 'blur(4px)'
          }}
        >
          <div
            style={{
              width: 'min(440px, 100%)',
              padding: 20,
              borderRadius: 12,
              background: '#0f172a',
              border: '1px solid #334155',
              boxShadow: '0 25px 50px rgba(0,0,0,0.55)'
            }}
          >
            <div id="iso-save-title" style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 8 }}>
              Guardar grabación
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 14, lineHeight: 1.5 }}>
              Elegí un nombre para la subcarpeta dentro de{' '}
              <span style={{ color: '#cbd5e1', wordBreak: 'break-all' }}>{outputDir ?? '—'}</span>. No podés repetir un
              nombre si ya existe una carpeta igual (sin importar mayúsculas) con archivos{' '}
              <code style={{ color: '#cbd5e1' }}>.webm</code>.
            </div>
            <label htmlFor="iso-folder-name" style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>
              Nombre de la carpeta
            </label>
            <input
              id="iso-folder-name"
              type="text"
              autoFocus
              value={isoFolderNameDraft}
              onChange={(e) => setIsoFolderNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void confirmIsoSave()
                }
              }}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 6,
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #475569',
                background: '#020617',
                color: '#f1f5f9',
                fontSize: 14,
                boxSizing: 'border-box'
              }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 18 }}>
              <button
                type="button"
                onClick={() => void confirmIsoSave()}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #15803d',
                  background: '#166534',
                  color: '#ecfccb',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Guardar en disco
              </button>
              <button
                type="button"
                onClick={() => discardPendingIso()}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #475569',
                  background: '#1e293b',
                  color: '#e2e8f0',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Descartar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isoSavedToast ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            right: 20,
            bottom: 20,
            zIndex: 10001,
            minWidth: 280,
            maxWidth: 'calc(100vw - 40px)',
            padding: '12px 14px',
            borderRadius: 12,
            background: '#052e1c',
            border: '1px solid #166534',
            boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
            color: '#dcfce7',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12
          }}
        >
          <div
            aria-hidden
            style={{
              width: 28,
              height: 28,
              flexShrink: 0,
              borderRadius: 999,
              background: '#16a34a',
              color: '#022c1a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              fontWeight: 800
            }}
          >
            ✓
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Grabación guardada</div>
            <div style={{ fontSize: 12, color: '#bbf7d0', marginTop: 2, lineHeight: 1.4, wordBreak: 'break-all' }}>
              Carpeta: <strong style={{ color: '#ecfccb' }}>{isoSavedToast.folder}</strong>
            </div>
            <div style={{ fontSize: 11, color: '#86efac', marginTop: 2, wordBreak: 'break-all' }}>
              {isoSavedToast.path}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsoSavedToast(null)}
            aria-label="Cerrar"
            title="Cerrar"
            style={{
              border: '1px solid #166534',
              background: 'transparent',
              color: '#bbf7d0',
              borderRadius: 6,
              padding: '2px 7px',
              cursor: 'pointer',
              fontSize: 13,
              lineHeight: 1
            }}
          >
            ✕
          </button>
        </div>
      ) : null}
    </div>
  )
}

function laneAccentColor(rtcState: string | undefined, hasVideo: boolean): string {
  if (rtcState === 'failed') return '#dc2626'
  if (hasVideo && rtcState === 'connected') return '#22c55e'
  if (rtcState === 'connected' && !hasVideo) return '#eab308'
  if (rtcState === 'connecting' || rtcState === 'checking') return '#eab308'
  return '#475569'
}

/** Dimensiones intrínsecas del vídeo (al rotar el celu cambian w/h; hay que sondear). */
function useVideoIntrinsicDimensions(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  stream: MediaStream | undefined
): { w: number; h: number } | null {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    setDims(null)
    const el = videoRef.current

    const read = () => {
      const v = videoRef.current
      if (!v) return
      let w = v.videoWidth
      let h = v.videoHeight
      const track = stream?.getVideoTracks()[0]
      const s = track?.getSettings?.()
      if (s?.width && s?.height) {
        if (w === 0 || h === 0) {
          w = s.width
          h = s.height
        } else {
          const vp = h > w
          const sp = s.height > s.width
          /** Tras rotar, a veces el track ya tiene retrato/apaisado pero el video element sigue con el tamaño anterior */
          if (vp !== sp) {
            w = s.width
            h = s.height
          } else {
            /** WebRTC: getSettings suele reflejar el frame codificado; videoWidth a veces va un paso atrás y el tile queda en 16:9 + max-height bajo → sensación de “falta abajo”. */
            w = s.width
            h = s.height
          }
        }
      }
      if (w > 0 && h > 0) {
        setDims((prev) => (prev?.w === w && prev?.h === h ? prev : { w, h }))
      }
    }

    el?.addEventListener('loadedmetadata', read)
    el?.addEventListener('resize', read)
    read()

    /** Rotación del emisor: loadedmetadata a veces no vuelve a disparar */
    const poll = window.setInterval(read, 320)

    const track = stream?.getVideoTracks()[0]
    const onCfg = () => read()
    track?.addEventListener?.('configurationchange', onCfg)

    return () => {
      window.clearInterval(poll)
      el?.removeEventListener('loadedmetadata', read)
      el?.removeEventListener('resize', read)
      track?.removeEventListener?.('configurationchange', onCfg)
    }
  }, [stream, videoRef])

  return dims
}

function rtcStatusLabel(rtcState: string | undefined, hasVideo: boolean): string {
  if (!rtcState || rtcState === 'new') return 'Esperando…'
  if (rtcState === 'connected')
    return hasVideo ? 'En vivo' : 'Sin video…'
  if (rtcState === 'connecting' || rtcState === 'checking') return 'Uniendo…'
  if (rtcState === 'failed') return 'Falló'
  return rtcState
}

/** 90°/270°: el rectángulo del layout no coincide con el bbox pintado; sin ajuste, overflow recorta y “solo se ve el centro”. */
function isSidewaysRotation(deg: number): boolean {
  const n = ((deg % 360) + 360) % 360
  return n === 90 || n === 270
}

/** Contenedor con container-type + style en vídeo; padre del vídeo debe tener containerType: 'size'. */
function videoPreviewStyle(rotateDeg: number): React.CSSProperties {
  const sideways = isSidewaysRotation(rotateDeg)
  const base: React.CSSProperties = {
    margin: 0,
    transform: `rotate(${rotateDeg}deg)`,
    transformOrigin: 'center center',
    objectFit: 'contain',
    objectPosition: 'center center',
    display: 'block'
  }
  if (sideways) {
    return {
      ...base,
      maxWidth: '100cqh',
      maxHeight: '100cqw',
      width: 'auto',
      height: 'auto'
    }
  }
  /** inset 0 evita recortes raros con grid/flex + % height en el elemento vídeo */
  return {
    ...base,
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%'
  }
}

function CameraTile({
  cameraId,
  alias,
  onRename,
  stream,
  rtcState,
  rotateDeg,
  onRotate90,
  onExpand,
  onClose
}: {
  cameraId: string
  alias: string | null
  onRename: (next: string | null) => void
  stream?: MediaStream
  rtcState?: string
  rotateDeg: number
  onRotate90: () => void
  onExpand: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const hasVideo = Boolean(stream?.getVideoTracks().some((t) => t.readyState === 'live'))
  const intrinsic = useVideoIntrinsicDimensions(ref, stream)
  const portrait = intrinsic ? intrinsic.h > intrinsic.w : false
  const aspectCss = intrinsic ? `${intrinsic.w} / ${intrinsic.h}` : '16 / 9'
  const [editing, setEditing] = useState(false)
  const [draftAlias, setDraftAlias] = useState(alias ?? '')
  const aliasInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream ?? null
    if (stream?.getVideoTracks().length) void el.play().catch(() => {})
  }, [stream])

  useEffect(() => {
    if (!editing) setDraftAlias(alias ?? '')
  }, [alias, editing])

  useEffect(() => {
    if (editing) {
      const id = window.setTimeout(() => {
        aliasInputRef.current?.focus()
        aliasInputRef.current?.select()
      }, 0)
      return () => window.clearTimeout(id)
    }
    return undefined
  }, [editing])

  const commitRename = () => {
    const next = draftAlias.trim()
    onRename(next.length ? next : null)
    setEditing(false)
  }
  const cancelRename = () => {
    setDraftAlias(alias ?? '')
    setEditing(false)
  }

  const accent = laneAccentColor(rtcState, hasVideo)
  const label = rtcStatusLabel(rtcState, hasVideo)
  const displayName = alias && alias.length ? alias : cameraId

  return (
    <div
      style={{
        display: 'flex',
        margin: 0,
        padding: 0,
        border: '1px solid #1e293b',
        borderRadius: 10,
        overflow: 'hidden',
        background: 'linear-gradient(180deg, #0a0f18 0%, #070b12 100%)',
        boxShadow: 'inset 0 1px 0 rgba(148,163,184,0.06)',
        width: '100%',
        minHeight: 0
      }}
    >
      <div
        aria-hidden
        style={{
          width: 4,
          flexShrink: 0,
          background: accent,
          boxShadow: rtcState === 'connecting' || rtcState === 'checking' ? `0 0 8px ${accent}` : undefined
        }}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div
          style={{
            padding: '5px 8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            borderBottom: '1px solid #1e293b',
            fontSize: 10,
            color: '#94a3b8'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0, flex: '1 1 auto' }}>
            {editing ? (
              <input
                ref={aliasInputRef}
                value={draftAlias}
                onChange={(e) => setDraftAlias(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitRename()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelRename()
                  }
                }}
                onBlur={commitRename}
                onClick={(e) => e.stopPropagation()}
                placeholder={cameraId}
                maxLength={48}
                style={{
                  flex: '1 1 120px',
                  minWidth: 0,
                  padding: '2px 6px',
                  borderRadius: 6,
                  border: '1px solid #475569',
                  background: '#0f172a',
                  color: '#f1f5f9',
                  fontSize: 11,
                  fontWeight: 600
                }}
              />
            ) : (
              <span
                title={alias ? `Alias · ID interno: ${cameraId}` : 'Tocá ✎ para renombrar esta cámara'}
                style={{
                  fontFamily: alias ? 'inherit' : 'ui-monospace, monospace',
                  color: '#f1f5f9',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 220
                }}
              >
                {displayName}
              </span>
            )}
            {!editing && alias ? (
              <span
                style={{
                  color: '#64748b',
                  fontSize: 9,
                  fontFamily: 'ui-monospace, monospace'
                }}
                title={`ID interno: ${cameraId}`}
              >
                {cameraId}
              </span>
            ) : null}
            <span style={{ color: '#64748b' }}>·</span>
            <span style={{ color: '#cbd5e1' }}>{label}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              title={alias ? 'Renombrar (Enter para guardar, Esc cancela)' : 'Asignar un nombre amigable'}
              aria-label={`Renombrar cámara ${displayName}`}
              onClick={(e) => {
                e.stopPropagation()
                setEditing((v) => !v)
              }}
              style={{
                padding: '4px 9px',
                fontSize: 13,
                lineHeight: 1,
                borderRadius: 8,
                border: '1px solid #475569',
                background: editing ? '#0c4a6e' : '#1e293b',
                color: '#e2e8f0',
                cursor: 'pointer'
              }}
            >
              ✎
            </button>
            <button
              type="button"
              title="Girar imagen 90° si el celu en horizontal se ve de costado"
              onClick={(e) => {
                e.stopPropagation()
                onRotate90()
              }}
              style={{
                padding: '4px 10px',
                fontSize: 15,
                lineHeight: 1,
                borderRadius: 8,
                border: '1px solid #475569',
                background: '#1e293b',
                color: '#e2e8f0',
                cursor: 'pointer'
              }}
            >
              ↻
            </button>
            <button
              type="button"
              title="Cerrar / desconectar esta cámara (útil si quedó colgada o duplicada)"
              aria-label={`Cerrar cámara ${displayName}`}
              onClick={(e) => {
                e.stopPropagation()
                onClose()
              }}
              style={{
                padding: '4px 9px',
                fontSize: 14,
                lineHeight: 1,
                borderRadius: 8,
                border: '1px solid #7f1d1d',
                background: '#3f0a0a',
                color: '#fecaca',
                cursor: 'pointer',
                fontWeight: 700
              }}
            >
              ✕
            </button>
          </div>
        </div>
        <div
          role="button"
          tabIndex={0}
          title="Clic para ver en grande · Escape cierra el detalle"
          onClick={onExpand}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onExpand()
            }
          }}
          style={{
            cursor: 'pointer',
            position: 'relative',
            width: '100%',
            aspectRatio: aspectCss,
            maxHeight: portrait ? 'min(58vh, 520px)' : 'min(30vh, 240px)',
            overflow: 'hidden',
            background: '#020617'
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              containerType: 'size',
              ...(isSidewaysRotation(rotateDeg)
                ? {
                    display: 'grid',
                    placeItems: 'center'
                  }
                : {}),
              minWidth: 0,
              minHeight: 0,
              overflow: 'hidden'
            }}
          >
            <video
              ref={ref}
              autoPlay
              playsInline
              muted
              style={videoPreviewStyle(rotateDeg)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function CameraExpandOverlay({
  cameraId,
  alias,
  stream,
  rtcState,
  rotateDeg,
  onRotate90,
  onClose
}: {
  cameraId: string
  alias?: string | null
  stream?: MediaStream
  rtcState?: string
  rotateDeg: number
  onRotate90: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const hasVideo = Boolean(stream?.getVideoTracks().some((t) => t.readyState === 'live'))
  const intrinsic = useVideoIntrinsicDimensions(ref, stream)
  const portrait = intrinsic ? intrinsic.h > intrinsic.w : false

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream ?? null
    if (stream?.getVideoTracks().length) void el.play().catch(() => {})
  }, [stream])

  const accent = laneAccentColor(rtcState, hasVideo)

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(2, 6, 23, 0.92)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        backdropFilter: 'blur(6px)'
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-expand-title"
        style={{
          /* En vertical: panel angosto tipo teléfono; en horizontal: cine */
          width: portrait ? 'min(52vw, 520px)' : 'min(96vw, 1200px)',
          height: 'min(92vh, 900px)',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          outline: 'none',
          minHeight: 0
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexShrink: 0
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              id="camera-expand-title"
              style={{
                fontFamily: alias ? 'inherit' : 'ui-monospace, monospace',
                fontSize: 18,
                fontWeight: 700,
                color: '#f8fafc'
              }}
              title={alias ? `ID interno: ${cameraId}` : undefined}
            >
              {alias && alias.length ? alias : cameraId}
            </span>
            {alias ? (
              <span
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: 11,
                  color: '#64748b'
                }}
              >
                {cameraId}
              </span>
            ) : null}
            <span
              style={{
                fontSize: 12,
                padding: '2px 10px',
                borderRadius: 999,
                background: `${accent}33`,
                color: '#e2e8f0',
                border: `1px solid ${accent}66`
              }}
            >
              {rtcStatusLabel(rtcState, hasVideo)}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              title="Girar la imagen 90°"
              onClick={onRotate90}
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid #475569',
                background: '#1e293b',
                color: '#f1f5f9',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              ↻ 90°
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '10px 18px',
                borderRadius: 10,
                border: '1px solid #475569',
                background: '#1e293b',
                color: '#f1f5f9',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Cerrar · Esc
            </button>
          </div>
        </div>
        <div
          style={{
            borderRadius: 12,
            overflow: 'hidden',
            border: '1px solid #334155',
            background: '#020617',
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            position: 'relative',
            containerType: 'size',
            ...(isSidewaysRotation(rotateDeg)
              ? {
                  display: 'grid',
                  placeItems: 'center'
                }
              : {})
          }}
        >
          <video
            ref={ref}
            autoPlay
            playsInline
            muted
            style={videoPreviewStyle(rotateDeg)}
          />
        </div>
        <p style={{ margin: 0, fontSize: 12, color: '#64748b', flexShrink: 0 }}>
          Si el celu está horizontal y acá se ve de costado: tocá ↻ en la miniatura o acá. El navegador del celu a veces no avisa bien la rotación a la PC.
        </p>
      </div>
    </div>
  )
}
