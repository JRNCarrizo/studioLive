import { isDisplayCaptureId } from './displayCapture'

export type SourceHealthState = 'ok' | 'waiting' | 'frozen' | 'no_signal'

export type SourceHealthInfo = {
  state: SourceHealthState
  label: string
  detail?: string
}

const FROZEN_SAMPLE_MS = 500
const FROZEN_STREAK = 6

function frameFingerprint(video: HTMLVideoElement): number | null {
  if (video.readyState < 2 || video.videoWidth < 1 || video.videoHeight < 1) return null
  const w = 32
  const h = 18
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  try {
    ctx.drawImage(video, 0, 0, w, h)
    const d = ctx.getImageData(0, 0, w, h).data
    let hsum = 0
    for (let i = 0; i < d.length; i += 16) {
      hsum = (hsum + d[i]! + d[i + 1]! + d[i + 2]!) | 0
    }
    return hsum
  } catch {
    return null
  }
}

type SampleState = {
  streak: number
  lastFp: number | null
}

const sampleState = new Map<string, SampleState>()

export function resetSourceHealthSamples(cameraId?: string): void {
  if (cameraId) sampleState.delete(cameraId)
  else sampleState.clear()
}

function updateFrozenStreak(cameraId: string, fp: number | null): boolean {
  if (fp == null) {
    sampleState.delete(cameraId)
    return false
  }
  const cur = sampleState.get(cameraId) ?? { streak: 0, lastFp: null }
  if (cur.lastFp === fp) cur.streak += 1
  else {
    cur.streak = 0
    cur.lastFp = fp
  }
  sampleState.set(cameraId, cur)
  return cur.streak >= FROZEN_STREAK
}

export function evaluateSourceHealth(params: {
  cameraId: string
  video: HTMLVideoElement | undefined
  stream: MediaStream | undefined
  rtcState: string | undefined
}): SourceHealthInfo {
  const { cameraId, video, stream, rtcState } = params
  const track = stream?.getVideoTracks()[0]
  const trackLive = track && track.readyState === 'live' && track.enabled !== false

  if (!stream || !track || track.readyState === 'ended') {
    return {
      state: 'no_signal',
      label: 'Sin señal',
      detail: 'No hay vídeo activo en esta fuente.'
    }
  }

  if (!trackLive) {
    return {
      state: 'waiting',
      label: 'Esperando vídeo',
      detail: 'La fuente está conectada pero aún no entrega imagen.'
    }
  }

  if (!isDisplayCaptureId(cameraId)) {
    const rtc = rtcState ?? ''
    if (rtc === 'connecting' || rtc === 'checking' || rtc === 'new') {
      return {
        state: 'waiting',
        label: 'Conectando',
        detail: 'Negociando con el celular…'
      }
    }
    if (rtc === 'failed' || rtc === 'disconnected' || rtc === 'closed') {
      return {
        state: 'no_signal',
        label: 'Desconectada',
        detail: 'Reescaneá el QR y tocá Transmitir en el celular.'
      }
    }
    if (!video || video.readyState < 2 || !video.videoWidth) {
      return {
        state: 'waiting',
        label: 'Esperando frame',
        detail: 'El vídeo del celular aún no tiene tamaño.'
      }
    }
    return { state: 'ok', label: 'En vivo' }
  }

  if (!video || video.readyState < 2 || !video.videoWidth) {
    return {
      state: 'waiting',
      label: 'Iniciando captura',
      detail: 'Esperá unos segundos tras elegir pantalla o ventana.'
    }
  }

  const fp = frameFingerprint(video)
  const frozen = updateFrozenStreak(cameraId, fp)
  if (frozen) {
    return {
      state: 'frozen',
      label: 'Parece congelada',
      detail:
        'La imagen no cambia. Para YouTube o el navegador: cerrá esta fuente y capturá la pantalla completa (monitor), no la ventana de Chrome/Edge.'
    }
  }

  return { state: 'ok', label: 'Se mueve' }
}

export const SOURCE_HEALTH_SAMPLE_MS = FROZEN_SAMPLE_MS

export function healthStateColor(state: SourceHealthState): string {
  switch (state) {
    case 'ok':
      return '#34d399'
    case 'waiting':
      return '#fbbf24'
    case 'frozen':
      return '#f87171'
    case 'no_signal':
      return '#94a3b8'
    default:
      return '#94a3b8'
  }
}
