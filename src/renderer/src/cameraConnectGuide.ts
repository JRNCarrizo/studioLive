import { isDisplayCaptureId } from './displayCapture'

export type ConnectStepId = 'network' | 'scan' | 'https' | 'transmit'

export type ConnectStepState = 'done' | 'current' | 'pending' | 'warn'

export type ConnectStep = {
  id: ConnectStepId
  title: string
  detail: string
  state: ConnectStepState
}

export type ConnectProgress = {
  networkOk: boolean
  phoneJoined: boolean
  phoneTransmitting: boolean
  joinedCount: number
  transmittingCount: number
  steps: ConnectStep[]
  headline: string
  subline: string
}

function phoneCameraIds(cameraIds: string[]): string[] {
  return cameraIds.filter((id) => !isDisplayCaptureId(id))
}

function isTransmitting(stream: MediaStream | undefined, rtcState: string | undefined): boolean {
  const hasLiveVideo = Boolean(
    stream?.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled !== false)
  )
  if (!hasLiveVideo) return false
  return rtcState === 'connected' || rtcState === 'connecting' || rtcState === 'checking' || !rtcState
}

export function deriveConnectProgress(params: {
  ips: string[]
  port: number | null
  signalingReady: boolean
  cameraIds: string[]
  streams: Record<string, MediaStream | undefined>
  rtcStates: Record<string, string | undefined>
}): ConnectProgress {
  const { ips, port, signalingReady, cameraIds, streams, rtcStates } = params
  const networkOk = Boolean(port && ips.length > 0 && signalingReady)
  const phones = phoneCameraIds(cameraIds)
  const joinedCount = phones.length
  const phoneJoined = joinedCount > 0
  const transmittingIds = phones.filter((id) => isTransmitting(streams[id], rtcStates[id]))
  const transmittingCount = transmittingIds.length
  const phoneTransmitting = transmittingCount > 0

  const networkState: ConnectStepState = networkOk ? 'done' : port == null ? 'current' : 'warn'
  let scanState: ConnectStepState = 'pending'
  let httpsState: ConnectStepState = 'pending'
  let transmitState: ConnectStepState = 'pending'

  if (networkOk && !phoneJoined) scanState = 'current'
  if (networkOk && phoneJoined) scanState = 'done'
  if (phoneJoined && !phoneTransmitting) httpsState = 'current'
  if (phoneTransmitting) {
    httpsState = 'done'
    transmitState = 'done'
  } else if (phoneJoined) {
    transmitState = 'current'
  }

  const recommendedIp = ips[0] ?? '—'
  const portLabel = port ?? '—'

  const steps: ConnectStep[] = [
    {
      id: 'network',
      title: 'Red lista en la PC',
      detail: networkOk
        ? `Servidor activo · IP recomendada ${recommendedIp}:${portLabel} · misma Wi‑Fi que el celular.`
        : port == null
          ? 'Esperando que arranque el servidor local…'
          : ips.length === 0
            ? 'No hay IP de red. Conectá la PC al Wi‑Fi o Ethernet y reiniciá Studio Live.'
            : 'El servidor aún no responde. Reiniciá la app o revisá el firewall (red privada).',
      state: networkState
    },
    {
      id: 'scan',
      title: 'Escaneá el QR en el celular',
      detail:
        'Usá la cámara del teléfono o Chrome. Abrí el enlace en Chrome (Android) o Safari (iPhone). No abras el link dentro de WhatsApp.',
      state: scanState
    },
    {
      id: 'https',
      title: 'Aviso de seguridad → Continuar',
      detail:
        'Es normal en red local. Tocá Avanzado → Continuar (Android) o Visitar sitio web (iPhone). No hace falta instalar el .crt.',
      state: httpsState
    },
    {
      id: 'transmit',
      title: 'Tocá Transmitir en el celular',
      detail: phoneTransmitting
        ? `Video en vivo (${transmittingCount} celular${transmittingCount !== 1 ? 'es' : ''}). Ya podés cerrar este panel.`
        : 'En la página del celular, pulsá el botón grande Transmitir para mandar video a la PC.',
      state: transmitState
    }
  ]

  let headline = 'Conectá tu primer celular'
  let subline = 'Seguí los pasos en orden.'

  if (phoneTransmitting) {
    headline =
      transmittingCount === joinedCount
        ? `¡Listo! ${transmittingCount} cámara${transmittingCount !== 1 ? 's' : ''} en vivo`
        : `${transmittingCount} transmitiendo · ${joinedCount - transmittingCount} esperando «Transmitir»`
    subline = 'Las miniaturas aparecen en el panel principal.'
  } else if (phoneJoined) {
    headline = 'Celular conectado — falta Transmitir'
    subline = 'La página del teléfono ya llegó a la PC. Tocá Transmitir en el celular.'
  } else if (networkOk) {
    headline = 'Escaneá el QR'
    subline = 'PC y celular en la misma Wi‑Fi.'
  } else {
    headline = 'Preparando la conexión…'
    subline = 'Revisá red y firewall abajo si tarda.'
  }

  return {
    networkOk,
    phoneJoined,
    phoneTransmitting,
    joinedCount,
    transmittingCount,
    steps,
    headline,
    subline
  }
}

export type ConnectDiagnostic = {
  ok: boolean
  lines: string[]
}

export function buildConnectDiagnostic(params: {
  ips: string[]
  port: number | null
  signalingReady: boolean
  cameraIds: string[]
  streams: Record<string, MediaStream | undefined>
  rtcStates: Record<string, string | undefined>
}): ConnectDiagnostic {
  const progress = deriveConnectProgress(params)
  const lines: string[] = []

  if (!params.port) lines.push('El servidor local todavía no arrancó. Esperá unos segundos.')
  if (params.port && params.ips.length === 0) {
    lines.push('No hay IP de red detectada. Conectá la PC al Wi‑Fi y reiniciá Studio Live.')
  }
  if (params.ips.length && !params.signalingReady) {
    lines.push(
      'Señalización caída. En Windows: Firewall → permitir Studio Live en red privada. Reiniciá la app.'
    )
  }
  if (progress.networkOk && !progress.phoneJoined) {
    lines.push('Desde el celular probá la URL de ping (debe decir studio-live-ok).')
    lines.push('Escaneá el QR y abrí en Chrome/Safari, no en WhatsApp.')
    lines.push('Si ves aviso HTTPS: Avanzado → Continuar.')
  }
  if (progress.phoneJoined && !progress.phoneTransmitting) {
    lines.push('El celular ya se registró. Falta pulsar Transmitir en la pantalla del teléfono.')
  }
  if (progress.phoneTransmitting) {
    lines.push('Todo OK: hay video en vivo desde el celular.')
  }

  if (lines.length === 0) {
    lines.push('No hay problemas obvios. Si falla, revisá misma Wi‑Fi y firewall.')
  }

  return { ok: progress.phoneTransmitting, lines }
}
