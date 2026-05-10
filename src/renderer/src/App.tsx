import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { FusionPanel } from './FusionPanel'

type SigMsg =
  | { type: 'camera-joined'; cameraId: string; name?: string }
  | { type: 'camera-left'; cameraId: string }
  | { type: 'offer'; cameraId: string; sdp: string }
  | { type: 'ice'; cameraId: string; candidate: RTCIceCandidateInit | null }

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

function pickRecorderMime(): string | undefined {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
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
  const [audioNote, setAudioNote] = useState<string | null>(null)
  const [videoPreset, setVideoPreset] = useState<VideoPresetId>('medium')
  const [signalingReady, setSignalingReady] = useState(false)
  /** URLs, calidad, audio de PC, certificado HTTPS, etc. */
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** Estado WebRTC por “pista” (estilo mezclador): new | connecting | connected | disconnected | failed */
  const [laneRtcState, setLaneRtcState] = useState<Record<string, string>>({})
  /** Cámara ampliada al hacer clic en la miniatura */
  const [expandedCameraId, setExpandedCameraId] = useState<string | null>(null)
  /** Si el celu manda la imagen “de costado”, podés corregir con ↻ (90° por toque). */
  const [manualRotateDeg, setManualRotateDeg] = useState<Record<string, number>>({})
  /** Tiempo ISO transcurrido mostrado (00:00 o H:MM:SS). */
  const [isoElapsedLabel, setIsoElapsedLabel] = useState('00:00')
  /** Separar flujo de celulares + ISO del flujo de edición de fusión (evita mezclar sesiones). */
  const [workspaceMode, setWorkspaceMode] = useState<'live' | 'fusion'>('live')

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

  const urls = useMemo(() => {
    if (!info) return []
    return info.ips.map(
      (ip) => `https://${ip}:${info.port}/?preset=${encodeURIComponent(videoPreset)}`
    )
  }, [info, videoPreset])

  const pingUrls = useMemo(() => {
    if (!info) return []
    return info.ips.map((ip) => `https://${ip}:${info.port}/__studio/ping`)
  }, [info])

  const localPreviewUrl = useMemo(() => {
    if (!info) return ''
    return `https://127.0.0.1:${info.port}/?preset=${encodeURIComponent(videoPreset)}`
  }, [info, videoPreset])

  /** Evita tiles vacíos si el video llega antes que el estado camera-joined */
  const tileCameraIds = useMemo(() => {
    const ids = new Set(cameras)
    for (const id of Object.keys(streams)) ids.add(id)
    return [...ids].sort()
  }, [cameras, streams])

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
        setStatus('Listo. Abrí la URL en cada celular y tocá "Transmitir".')
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

  const handleOffer = useCallback(async (cameraId: string, sdp: string) => {
    // No usar signalingOkRef aquí: si la insignia «Señalización» falla pero el IPC sí entrega ofertas,
    // hay que negociar igual o el celular queda en «Transmitiendo» sin video en la PC.

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
          await handleOffer(msg.cameraId, msg.sdp)
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStatus(`Error al guardar: ${msg}`)
    }
  }, [pendingIsoSave, outputDir, isoFolderNameDraft])

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
          ? new MediaRecorder(stream, { mimeType: videoMime })
          : new MediaRecorder(stream)
        rec.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data)
        }
        recordersRef.current.set(id, rec)
        rec.start(250)
      }

      if (audioStream?.getAudioTracks().length) {
        anyTrack = true
        const chunks: BlobPart[] = []
        chunksRef.current.set(PC_AUDIO_RECORDER_KEY, chunks)
        const rec = audioMime
          ? new MediaRecorder(audioStream, { mimeType: audioMime })
          : new MediaRecorder(audioStream)
        rec.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data)
        }
        recordersRef.current.set(PC_AUDIO_RECORDER_KEY, rec)
        rec.start(250)
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
        'No hay fuentes para grabar: abrí la URL en el celular y tocá Transmitir, o activá «Audio de PC» en configuración.'
      )
      return
    }

    isoRecordingStartedAtRef.current = Date.now()
    setRecording(true)
    setStatus(
      'Grabación ISO en curso: se guarda un WebM por cada cámara en vivo + audio de PC si está activo. Detené para escribir los archivos.'
    )
  }, [audioStream, outputDir, pendingIsoSave, streams])

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
    if (!hasCameras && !hasPcAudio) {
      setStatus(
        'Transmitir en vivo no guarda archivos. Para la grabación ISO: primero que el celular esté “En vivo”, después tocá «Iniciar grabación ISO» abajo (y carpeta elegida).'
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
                    ? 'Guardá o descartá la grabación ISO pendiente antes de pasar a modo Fusión.'
                    : 'Detené la grabación ISO antes de pasar a modo Fusión.'
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
                  : 'No podés pasar a Fusión mientras graba ISO'
                : 'Editar fusión con archivos ya guardados (paso 2)'
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
            2 · Fusión
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
        <button
          type="button"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((v) => !v)}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid #334155',
            background: settingsOpen ? '#1e293b' : '#0f172a',
            color: '#e2e8f0',
            fontWeight: 600
          }}
        >
          {settingsOpen ? 'Ocultar configuración' : 'Configuración'}
        </button>
      </header>

      <section style={{ padding: 16, flex: 1, overflow: 'auto' }}>
        {settingsOpen ? (
          <div
            style={{
              marginBottom: 16,
              paddingBottom: 16,
              borderBottom: '1px solid #1e293b'
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: '#cbd5e1',
                letterSpacing: 0.06,
                textTransform: 'uppercase',
                marginBottom: 14
              }}
            >
              Configuración
            </div>
            <div style={{ marginBottom: 12, fontSize: 13, color: '#94a3b8' }}>
          <div>
            <strong style={{ color: '#e2e8f0' }}>URLs HTTPS para celulares (misma Wi-Fi):</strong>
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#78716c' }}>
            La primera vez el navegador del celular mostrará una advertencia de certificado (normal en LAN). Continuá /
            &quot;Avanzado&quot; y confiá en el sitio; después podrá usar la cámara en contexto seguro.
          </div>
          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>Calidad de video (celulares):</span>
            <select
              value={videoPreset}
              disabled={isoBusy}
              onChange={(ev) => setVideoPreset(ev.target.value as VideoPresetId)}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#e2e8f0',
                maxWidth: '100%'
              }}
            >
              {VIDEO_PRESET_OPTIONS.map((o) => (
                <option key={o.id} value={o.id} title={o.hint}>
                  {o.label}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 11, color: '#64748b' }}>
              {VIDEO_PRESET_OPTIONS.find((o) => o.id === videoPreset)?.hint}
            </span>
          </div>
          {!urls.length ? (
            <div>No se detectaron IPs de LAN (¿Wi-Fi desconectado?).</div>
          ) : (
            urls.map((u) => (
              <div key={u} style={{ marginTop: 6, wordBreak: 'break-all', color: '#cbd5e1' }}>
                {u}
              </div>
            ))
          )}

          {urls.length > 0 ? (
            <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  void window.studio.copyText(urls[0]!).then(() =>
                    setStatus('URL copiada al portapapeles. Pegala en el navegador del celular (Chrome / Safari).')
                  )
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid #334155',
                  background: '#1e293b',
                  color: '#e2e8f0',
                  fontSize: 12
                }}
              >
                Copiar primera URL
              </button>
              <button
                type="button"
                onClick={() =>
                  void window.studio.exportCert().then((ok) =>
                    setStatus(
                      ok
                        ? 'Certificado guardado. Pasalo al celular e instalalo (ver ayuda abajo).'
                        : 'No se pudo exportar el certificado (¿guardaste antes que arrancara el servidor?).'
                    )
                  )
                }
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid #334155',
                  background: '#422006',
                  color: '#fde68a',
                  fontSize: 12
                }}
              >
                Exportar certificado (.crt)
              </button>
            </div>
          ) : null}

          <details style={{ marginTop: 14, fontSize: 12, color: '#94a3b8' }}>
            <summary style={{ cursor: 'pointer', color: '#cbd5e1' }}>
              HTTPS no carga o el celular no confía en la página
            </summary>
            <ol style={{ paddingLeft: 18, marginTop: 10, lineHeight: 1.55 }}>
              <li>
                Probar TLS desde el celular: abrí una URL de ping (debería verse el texto{' '}
                <code style={{ color: '#86efac' }}>studio-live-ok</code>). Si no abre, revisá mismo Wi-Fi,
                firewall en Windows (permitir Node/Electron en redes privadas) y que la IP sea la correcta.
                <div style={{ marginTop: 8 }}>
                  {pingUrls.map((u) => (
                    <div key={u} style={{ wordBreak: 'break-all' }}>
                      <code style={{ color: '#cbd5e1' }}>{u}</code>
                    </div>
                  ))}
                </div>
              </li>
              <li style={{ marginTop: 10 }}>
                En la PC, probá en Chrome/Edge:{' '}
                <code style={{ wordBreak: 'break-all', color: '#cbd5e1' }}>{localPreviewUrl || '—'}</code>
                . Si acá funciona y en el celular no, el problema suele ser confianza del certificado en el
                teléfono.
              </li>
              <li style={{ marginTop: 10 }}>
                <strong>Android:</strong> exportá el certificado con el botón de arriba, pasalo al teléfono y en
                Ajustes → Seguridad → Cifrado / Credenciales → Instalar certificado → &quot;VPN y aplicaciones&quot;
                o &quot;CA&quot; según tu versión. Después volvé a abrir la URL HTTPS.
              </li>
              <li style={{ marginTop: 8 }}>
                <strong>iPhone:</strong> enviate el .crt por Mail/AirDrop, instalá el perfil en Ajustes y en
                Ajustes → General → Información → Ajustes de confianza del certificado activá confianza para ese
                perfil.
              </li>
              <li style={{ marginTop: 8 }}>
                No abras el link dentro de WhatsApp: usá &quot;Abrir en Chrome&quot; o &quot;Abrir en Safari&quot;.
              </li>
            </ol>
          </details>
        </div>

        <div
          style={{
            marginBottom: 16,
            padding: 14,
            borderRadius: 12,
            border: '1px solid #243046',
            background: '#0b1220',
            maxWidth: 560
          }}
        >
          <div style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 8 }}>
            <strong>Audio en esta PC</strong>
            <span style={{ color: '#64748b', fontWeight: 400 }}>
              {' '}
              (interfaz / cóndenser vía dispositivo de grabación de Windows)
            </span>
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10, lineHeight: 1.45 }}>
            <strong style={{ color: '#94a3b8' }}>Opcional.</strong> Si no tenés interfaz enchufada o no querés audio
            en la PC, no hace falta tocar nada acá:{' '}
            <strong style={{ color: '#cbd5e1' }}>las cámaras del celular no dependen del audio de la PC.</strong>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <select
              value={selectedAudioDeviceId}
              disabled={isoBusy}
              onChange={(ev) => setSelectedAudioDeviceId(ev.target.value)}
              style={{
                flex: '1 1 220px',
                minWidth: 200,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#e2e8f0'
              }}
            >
              <option value="">Predeterminado de Windows</option>
              {audioInputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Entrada ${d.deviceId.slice(0, 8)}...`}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={isoBusy}
              onClick={() => void preparePcAudio()}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #334155',
                background: '#14532d',
                color: '#dcfce7'
              }}
            >
              {audioStream ? 'Reactivar audio' : 'Activar audio de PC'}
            </button>
          </div>
          {audioNote ? (
            <div style={{ marginTop: 10, fontSize: 12, color: '#fca5a5' }}>{audioNote}</div>
          ) : null}
          {audioStream ? (
            <>
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>Nivel de entrada</div>
                <AudioLevelMeter stream={audioStream} />
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: '#86efac' }}>
                Entrada activa: al grabar se guarda también un WebM de solo audio con el mismo número de sesión que las
                cámaras.
              </div>
            </>
          ) : (
            <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>
              El navegador no expone ASIO directamente: configurá la interfaz como entrada de grabación
              predeterminado en Windows o elegila en la lista después de activar.
            </div>
          )}
        </div>
          </div>
        ) : null}

        <div style={{ display: workspaceMode === 'live' ? 'block' : 'none' }}>
        <div
          style={{
            marginBottom: 16,
            padding: '12px 14px',
            borderRadius: 12,
            border: '1px solid #334155',
            background: '#0a1628',
            display: 'flex',
            flexDirection: 'column',
            gap: 10
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: 0.06 }}>
            Paso 1 · Grabación ISO (todas las pistas a la vez)
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.55, maxWidth: 720 }}>
            <strong style={{ color: '#e2e8f0' }}>Transmitir desde el celular solo muestra el vídeo en la PC.</strong>{' '}
            Para guardar archivos hace falta esta acción: se graban <strong style={{ color: '#e2e8f0' }}>al mismo tiempo</strong>{' '}
            todas las cámaras conectadas y el audio de PC (si lo activaste). Al detener se te pide un{' '}
            <strong style={{ color: '#e2e8f0' }}>nombre de carpeta</strong> (no puede repetirse si ya existe esa carpeta con archivos{' '}
            <code style={{ color: '#cbd5e1' }}>.webm</code>) y los{' '}
            <code style={{ color: '#cbd5e1' }}>cam-*.webm</code> / <code style={{ color: '#cbd5e1' }}>audio-*.webm</code> quedan{' '}
            dentro de esa subcarpeta; después podés usar la fusión (paso 2) cargando esos archivos.
          </div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            Fuentes que se incluyen si iniciás ISO ahora:{' '}
            <span style={{ color: isoSourcesSummary.camCount || isoSourcesSummary.hasPcAudio ? '#86efac' : '#fbbf24' }}>
              {isoSourcesSummary.label}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#64748b',
                letterSpacing: 0.08,
                textTransform: 'uppercase'
              }}
            >
              Carpeta y controles
            </span>
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
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#e2e8f0',
                opacity: pendingIsoSave ? 0.55 : 1,
                cursor: pendingIsoSave ? 'not-allowed' : 'pointer'
              }}
            >
              Carpeta de grabación
            </button>
            <button
              type="button"
              disabled={Boolean(pendingIsoSave && !recording)}
              title={
                recording
                  ? 'Detiene la grabación; después elegís el nombre de carpeta y guardás los WebM.'
                  : pendingIsoSave
                    ? 'Primero guardá o descartá la grabación pendiente (ventana de nombre).'
                    : 'Inicia grabación simultánea: un archivo por cámara (+ audio PC si aplica). Requiere carpeta y al menos una fuente.'
              }
              onClick={onRecordClick}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                border: '1px solid transparent',
                background: recording ? '#b91c1c' : pendingIsoSave ? '#475569' : '#1d4ed8',
                color: 'white',
                cursor: pendingIsoSave && !recording ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                opacity: pendingIsoSave && !recording ? 0.75 : 1
              }}
            >
              {recording
                ? 'Detener grabación'
                : pendingIsoSave
                  ? 'Pendiente: nombre de carpeta…'
                  : 'Iniciar grabación ISO'}
            </button>
            {urls.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  void window.studio.copyText(urls[0]!).then(() =>
                    setStatus('URL copiada al portapapeles. Pegala en el navegador del celular (Chrome / Safari).')
                  )
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid #334155',
                  background: '#1e293b',
                  color: '#e2e8f0',
                  fontSize: 12
                }}
              >
                Copiar primera URL
              </button>
            ) : null}
            {recording ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'baseline',
                  gap: 10,
                  flexShrink: 0
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: '#fca5a5' }}>● ISO</span>
                <span
                  title="Tiempo de esta grabación ISO"
                  style={{
                    fontSize: 20,
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
            ) : null}
            <span
              style={{
                flex: '1 1 220px',
                fontSize: 12,
                color: '#94a3b8',
                minWidth: 0,
                lineHeight: 1.4
              }}
            >
              {status}
            </span>
          </div>
          {outputDir ? (
            <div style={{ fontSize: 11, color: '#64748b', wordBreak: 'break-all', lineHeight: 1.45 }}>
              Carpeta: <span style={{ color: '#cbd5e1' }}>{outputDir}</span>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#475569' }}>
              Elegí carpeta de grabación para poder guardar WebM al detener.
            </div>
          )}
        </div>

        <div style={{ width: '100%', maxWidth: '100%' }}>
          <div style={{ fontSize: 11, color: '#64748b', letterSpacing: 0.06, textTransform: 'uppercase', marginBottom: 10 }}>
            Entradas en vivo — hasta 3 por fila · clic en el vídeo para ampliar · ↻ gira 90° si queda de costado
          </div>
          <div className="camera-grid">
            {tileCameraIds.map((id) => (
              <CameraTile
                key={id}
                cameraId={id}
                stream={streams[id]}
                rtcState={laneRtcState[id]}
                rotateDeg={manualRotateDeg[id] ?? 0}
                onRotate90={() => bumpRotate(id)}
                onExpand={() => setExpandedCameraId(id)}
              />
            ))}
          </div>
          {!tileCameraIds.length ? (
            <div style={{ color: '#64748b', fontSize: 14 }}>
              Esperando cámaras… Con Studio Live abierto en la PC, abrí la URL en el celular y tocá Transmitir. Si
              &quot;Señalización&quot; no pasa a OK en unos segundos, reiniciá la app.
            </div>
          ) : null}
        </div>

        {expandedCameraId ? (
          <CameraExpandOverlay
            cameraId={expandedCameraId}
            stream={streams[expandedCameraId]}
            rtcState={laneRtcState[expandedCameraId]}
            rotateDeg={manualRotateDeg[expandedCameraId] ?? 0}
            onRotate90={() => bumpRotate(expandedCameraId)}
            onClose={() => setExpandedCameraId(null)}
          />
        ) : null}
        </div>

        <div style={{ display: workspaceMode === 'fusion' ? 'block' : 'none' }}>
          <div
            style={{
              marginBottom: 14,
              padding: '12px 14px',
              borderRadius: 12,
              border: '1px solid #4c1d95',
              background: '#120618',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
              alignItems: 'center'
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: '#e9d5ff' }}>Modo Fusión (paso 2)</span>
            <span style={{ fontSize: 11, color: '#94a3b8', flex: '1 1 200px', lineHeight: 1.4 }}>
              Acá cargás los <code style={{ color: '#cbd5e1' }}>cam-*.webm</code> ya grabados. Las URLs de celulares y la
              cuadrícula en vivo están ocultas para no mezclar con una sesión nueva.
            </span>
            <button
              type="button"
              onClick={() => void pickFolder()}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#e2e8f0',
                fontSize: 12
              }}
            >
              Carpeta de grabación
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceMode('live')}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #334155',
                background: '#1e293b',
                color: '#e2e8f0',
                fontSize: 12,
                fontWeight: 600
              }}
            >
              Volver a sesión en vivo
            </button>
          </div>
          <FusionPanel outputDir={outputDir} liveRecording={isoBusy} onStatus={setStatus} />
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
              Guardar grabación ISO
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
    </div>
  )
}

function AudioLevelMeter({ stream }: { stream: MediaStream }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const decayRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !stream.getAudioTracks().length) return

    decayRef.current = 0

    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return

    const audioCtx = new AC()
    const src = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.55
    src.connect(analyser)

    const buf = new Uint8Array(analyser.fftSize)
    let raf = 0

    const draw = () => {
      void audioCtx.resume()
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) {
        const x = (buf[i]! - 128) / 128
        sum += x * x
      }
      const rms = Math.sqrt(sum / buf.length)
      const instant = Math.min(1, rms * 4.2)
      decayRef.current = Math.max(instant, decayRef.current * 0.94)

      const ctx = canvas.getContext('2d')
      const dpr = window.devicePixelRatio || 1
      const cssW = canvas.clientWidth || 320
      const cssH = 14
      canvas.width = Math.floor(cssW * dpr)
      canvas.height = Math.floor(cssH * dpr)
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.fillStyle = '#1e293b'
        ctx.fillRect(0, 0, cssW, cssH)
        const wFill = cssW * decayRef.current
        const grd = ctx.createLinearGradient(0, 0, cssW, 0)
        grd.addColorStop(0, '#22c55e')
        grd.addColorStop(0.72, '#eab308')
        grd.addColorStop(1, '#ef4444')
        ctx.fillStyle = grd
        ctx.fillRect(0, 0, wFill, cssH)
      }

      raf = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      cancelAnimationFrame(raf)
      src.disconnect()
      analyser.disconnect()
      void audioCtx.close()
    }
  }, [stream])

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        maxWidth: 420,
        height: 14,
        display: 'block',
        borderRadius: 6,
        border: '1px solid #334155'
      }}
    />
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
  stream,
  rtcState,
  rotateDeg,
  onRotate90,
  onExpand
}: {
  cameraId: string
  stream?: MediaStream
  rtcState?: string
  rotateDeg: number
  onRotate90: () => void
  onExpand: () => void
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const hasVideo = Boolean(stream?.getVideoTracks().some((t) => t.readyState === 'live'))
  const intrinsic = useVideoIntrinsicDimensions(ref, stream)
  const portrait = intrinsic ? intrinsic.h > intrinsic.w : false
  const aspectCss = intrinsic ? `${intrinsic.w} / ${intrinsic.h}` : '16 / 9'

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream ?? null
    if (stream?.getVideoTracks().length) void el.play().catch(() => {})
  }, [stream])

  const accent = laneAccentColor(rtcState, hasVideo)
  const label = rtcStatusLabel(rtcState, hasVideo)

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
            <span style={{ fontFamily: 'ui-monospace, monospace', color: '#f1f5f9', fontWeight: 600 }}>
              {cameraId}
            </span>
            <span style={{ color: '#64748b' }}>·</span>
            <span style={{ color: '#cbd5e1' }}>{label}</span>
          </div>
          <button
            type="button"
            title="Girar imagen 90° si el celu en horizontal se ve de costado"
            onClick={(e) => {
              e.stopPropagation()
              onRotate90()
            }}
            style={{
              flexShrink: 0,
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
  stream,
  rtcState,
  rotateDeg,
  onRotate90,
  onClose
}: {
  cameraId: string
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
                fontFamily: 'ui-monospace, monospace',
                fontSize: 18,
                fontWeight: 700,
                color: '#f8fafc'
              }}
            >
              {cameraId}
            </span>
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
