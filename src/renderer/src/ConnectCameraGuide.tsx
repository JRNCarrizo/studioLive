import { useMemo, useState } from 'react'

import {
  buildConnectDiagnostic,
  deriveConnectProgress,
  type ConnectStep
} from './cameraConnectGuide'
import { btnNeutral } from './workspaceChrome'

type Props = {
  ips: string[]
  port: number | null
  signalingReady: boolean
  cameraIds: string[]
  streams: Record<string, MediaStream | undefined>
  rtcStates: Record<string, string | undefined>
  pingUrls: string[]
  connectUrl: string
  onCopyConnectUrl: (url: string) => void
  onCopyPingUrl: (url: string) => void
  onExportCert: () => void
}

function stepIcon(state: ConnectStep['state']): string {
  if (state === 'done') return '✓'
  if (state === 'warn') return '!'
  if (state === 'current') return '→'
  return '○'
}

function stepColors(state: ConnectStep['state']): { border: string; bg: string; title: string } {
  if (state === 'done') return { border: '#166534', bg: 'rgba(22, 101, 52, 0.2)', title: '#bbf7d0' }
  if (state === 'warn') return { border: '#b45309', bg: 'rgba(120, 53, 15, 0.35)', title: '#fde68a' }
  if (state === 'current') return { border: '#0284c7', bg: 'rgba(12, 74, 110, 0.45)', title: '#7dd3fc' }
  return { border: '#334155', bg: 'rgba(15, 23, 42, 0.6)', title: '#94a3b8' }
}

export function ConnectCameraGuide({
  ips,
  port,
  signalingReady,
  cameraIds,
  streams,
  rtcStates,
  pingUrls,
  connectUrl,
  onCopyConnectUrl,
  onCopyPingUrl,
  onExportCert
}: Props) {
  const [diagOpen, setDiagOpen] = useState(false)

  const progress = useMemo(
    () =>
      deriveConnectProgress({
        ips,
        port,
        signalingReady,
        cameraIds,
        streams,
        rtcStates
      }),
    [ips, port, signalingReady, cameraIds, streams, rtcStates]
  )

  const diagnostic = useMemo(
    () =>
      buildConnectDiagnostic({
        ips,
        port,
        signalingReady,
        cameraIds,
        streams,
        rtcStates
      }),
    [ips, port, signalingReady, cameraIds, streams, rtcStates]
  )

  const pingUrl = pingUrls[0] ?? ''

  return (
    <div className="connect-camera-guide">
      <div className="connect-camera-guide__head">
        <div>
          <div className="connect-camera-guide__headline">{progress.headline}</div>
          <div className="connect-camera-guide__subline">{progress.subline}</div>
        </div>
        <div className="connect-camera-guide__badges" aria-label="Estado de conexión">
          <span className={`connect-badge${progress.networkOk ? ' connect-badge--ok' : ''}`}>Red</span>
          <span className={`connect-badge${progress.phoneJoined ? ' connect-badge--ok' : ''}`}>Celular</span>
          <span className={`connect-badge${progress.phoneTransmitting ? ' connect-badge--ok' : ''}`}>
            Video
          </span>
        </div>
      </div>

      <ol className="connect-camera-guide__steps">
        {progress.steps.map((step, idx) => {
          const colors = stepColors(step.state)
          return (
            <li
              key={step.id}
              className="connect-camera-guide__step"
              style={{ borderColor: colors.border, background: colors.bg }}
            >
              <span className="connect-camera-guide__step-num" aria-hidden>
                {stepIcon(step.state)}
              </span>
              <div>
                <div className="connect-camera-guide__step-title" style={{ color: colors.title }}>
                  {idx + 1}. {step.title}
                </div>
                <div className="connect-camera-guide__step-detail">{step.detail}</div>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="connect-camera-guide__actions">
        {connectUrl ? (
          <button type="button" style={btnNeutral} onClick={() => onCopyConnectUrl(connectUrl)}>
            Copiar link para el celular
          </button>
        ) : null}
        {pingUrl ? (
          <button type="button" style={btnNeutral} onClick={() => onCopyPingUrl(pingUrl)}>
            Copiar prueba ping
          </button>
        ) : null}
        <button
          type="button"
          style={{ ...btnNeutral, fontWeight: 700 }}
          onClick={() => setDiagOpen((v) => !v)}
        >
          {diagOpen ? 'Ocultar diagnóstico' : 'Diagnosticar conexión'}
        </button>
      </div>

      {diagOpen ? (
        <div className="connect-camera-guide__diag">
          {diagnostic.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {pingUrl ? (
            <p className="connect-camera-guide__diag-url">
              Prueba en el celular: <code>{pingUrl}</code> → debe decir <strong>studio-live-ok</strong>
            </p>
          ) : null}
          <p className="connect-camera-guide__diag-url">
            Firewall Windows: Configuración → Privacidad y seguridad → Firewall → Permitir una app → Studio Live
            (red privada).
          </p>
        </div>
      ) : null}

      <details className="connect-camera-guide__optional">
        <summary>Opcional: instalar certificado (.crt) en el celular</summary>
        <p>
          No es obligatorio. Sirve para no ver el aviso HTTPS cada vez. Instalalo <strong>solo en el teléfono</strong>,
          nunca con doble clic en Windows.
        </p>
        <button type="button" className="connect-camera-guide__cert-btn" onClick={onExportCert}>
          Exportar .crt para el celular
        </button>
      </details>
    </div>
  )
}
