/** Restricciones de captura: señal limpia desde interfaz (sin AGC/eco del navegador). */
export const PC_AUDIO_CAPTURE_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  sampleRate: { ideal: 48000 },
  channelCount: { ideal: 2 }
}

export const MIC_RELEASE_DELAY_MS = 250

/** Da tiempo a que Web Audio suelte el dispositivo tras `stop()` en la pista. */
export async function waitAfterMicRelease(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  await new Promise<void>((resolve) => setTimeout(resolve, MIC_RELEASE_DELAY_MS))
}

type AudioOpenAttempt = boolean | MediaTrackConstraints

function buildAudioOpenAttempts(deviceId: string): AudioOpenAttempt[] {
  const pro: MediaTrackConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  }
  const pro48: MediaTrackConstraints = { ...pro, sampleRate: { ideal: 48000 } }
  const pro48stereo: MediaTrackConstraints = { ...PC_AUDIO_CAPTURE_CONSTRAINTS }
  const pro48mono: MediaTrackConstraints = { ...pro48, channelCount: { ideal: 1 } }

  const attempts: AudioOpenAttempt[] = []

  if (deviceId) {
    attempts.push(
      { ...pro48stereo, deviceId: { exact: deviceId } },
      { ...pro48, deviceId: { ideal: deviceId } },
      { ...pro, deviceId: { ideal: deviceId } },
      { deviceId: { ideal: deviceId } }
    )
  }

  attempts.push(pro48stereo, pro48, pro48mono, pro, true)
  return attempts
}

/**
 * Abre la entrada con reintentos progresivos (exact → ideal → predeterminado → mínimo).
 * Algunas interfaces fallan con sampleRate/canales estrictos o cuando el deviceId cambió.
 */
export async function openPcAudioCapture(deviceId: string): Promise<MediaStream> {
  const attempts = buildAudioOpenAttempts(deviceId)

  let lastErr: unknown
  for (const audio of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: audio === true ? true : audio,
        video: false
      })
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

export function describePcAudioError(err: unknown, deviceLabel?: string): string {
  const name = err instanceof DOMException ? err.name : ''
  const raw = err instanceof Error ? err.message : String(err)
  const lower = raw.toLowerCase()
  const deviceHint = deviceLabel ? ` (entrada: ${deviceLabel})` : ''

  if (name === 'NotAllowedError' || lower.includes('permission')) {
    return 'Windows o el navegador bloquearon el micrófono. Revisá Configuración → Privacidad → Micrófono (acceso para apps de escritorio) y volvé a pulsar Activar audio.'
  }
  if (name === 'NotFoundError' || lower.includes('requested device not found')) {
    return 'No se encontró esa entrada. Elegí «Predeterminado de Windows» u otra en la lista, o reconectá la interfaz por USB.'
  }
  if (
    name === 'NotReadableError' ||
    lower.includes('could not start audio source') ||
    lower.includes('device in use')
  ) {
    return [
      `No se pudo abrir la interfaz / micrófono${deviceHint} (dispositivo ocupado o driver).`,
      'Si ya habías activado el mic, usá «Soltar mic», esperá 1 s y volvé a pulsar Activar audio.',
      'Cerrá otras apps que usen el mic (DAW, Voicemeeter, Discord, OBS).',
      'En Windows → Sonido → Propiedades de la entrada → Avanzado: desactivá «control exclusivo».',
      'Reconectá USB, reiniciá Studio Live y probá «Predeterminado de Windows» primero.'
    ].join(' ')
  }
  if (name === 'OverconstrainedError') {
    return 'Esa entrada ya no está disponible (cambió al reconectar). Elegí otra en la lista o «Predeterminado de Windows».'
  }
  return raw || 'Error desconocido al abrir el audio.'
}

export async function listPcAudioInputs(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const list = await navigator.mediaDevices.enumerateDevices()
  return list.filter((d) => d.kind === 'audioinput')
}

const WANTS_ACTIVE_KEY = 'studioLive.pcAudio.wantsActive'

export function readPcAudioWantsActive(): boolean {
  try {
    return localStorage.getItem(WANTS_ACTIVE_KEY) === '1'
  } catch {
    return false
  }
}

export function writePcAudioWantsActive(v: boolean): void {
  try {
    localStorage.setItem(WANTS_ACTIVE_KEY, v ? '1' : '0')
  } catch {
    /* vacío */
  }
}

export function stopMediaStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop())
}
