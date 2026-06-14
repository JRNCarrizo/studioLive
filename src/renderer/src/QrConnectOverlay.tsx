import { useEffect, useMemo } from 'react'

import { CameraConnectQR } from './CameraConnectQR'
import { ConnectCameraGuide } from './ConnectCameraGuide'

type StudioCameraWorkspace = 'live' | 'liveFusion'

type VideoPresetOption = { id: string; label: string; hint: string }

type Props = {
  open: boolean
  onClose: () => void
  ips: string[]
  port: number | null
  preset: string
  workspace: StudioCameraWorkspace
  presetOptions: VideoPresetOption[]
  onPresetChange: (id: string) => void
  presetDisabled: boolean
  signalingReady: boolean
  cameraIds: string[]
  streams: Record<string, MediaStream | undefined>
  rtcStates: Record<string, string | undefined>
  pingUrls: string[]
  localPreviewUrl: string
  onCopyUrl: (url: string) => void
  onExportCert: () => void
}

export function QrConnectOverlay({
  open,
  onClose,
  ips,
  port,
  preset,
  workspace,
  presetOptions,
  onPresetChange,
  presetDisabled,
  signalingReady,
  cameraIds,
  streams,
  rtcStates,
  pingUrls,
  localPreviewUrl,
  onCopyUrl,
  onExportCert
}: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const recommendedConnectUrl = useMemo(() => {
    const ip = ips[0]
    if (!ip || port == null) return ''
    return `https://${ip}:${port}/?preset=${encodeURIComponent(preset)}&studioWorkspace=${workspace}`
  }, [ips, port, preset, workspace])

  if (!open) return null

  const presetHint = presetOptions.find((o) => o.id === preset)?.hint

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-connect-title"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2, 6, 23, 0.7)',
        backdropFilter: 'blur(2px)',
        zIndex: 70,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(780px, 100%)',
          maxHeight: 'calc(100vh - 48px)',
          overflow: 'auto',
          borderRadius: 14,
          border: '1px solid #334155',
          background: '#0b1220',
          color: '#e2e8f0',
          boxShadow: '0 16px 56px rgba(0,0,0,0.6)'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 16px',
            borderBottom: '1px solid #1e293b',
            background: '#0f172a'
          }}
        >
          <div>
            <div id="qr-connect-title" style={{ fontSize: 14, fontWeight: 700 }}>
              Conectar cámaras — {workspace === 'liveFusion' ? 'Fusión en vivo' : 'Sesión en vivo'}
            </div>
            <div style={{ fontSize: 11, color: '#64748b' }}>
              Misma Wi‑Fi · Chrome o Safari en el celular · Esc para cerrar
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid #334155',
              background: '#1e293b',
              color: '#cbd5e1',
              fontSize: 13,
              cursor: 'pointer'
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ConnectCameraGuide
            ips={ips}
            port={port}
            signalingReady={signalingReady}
            cameraIds={cameraIds}
            streams={streams}
            rtcStates={rtcStates}
            pingUrls={pingUrls}
            connectUrl={recommendedConnectUrl}
            onCopyConnectUrl={onCopyUrl}
            onCopyPingUrl={onCopyUrl}
            onExportCert={onExportCert}
          />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>Calidad de video (celulares):</span>
            <select
              value={preset}
              disabled={presetDisabled}
              onChange={(ev) => onPresetChange(ev.target.value)}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#e2e8f0',
                maxWidth: '100%'
              }}
            >
              {presetOptions.map((o) => (
                <option key={o.id} value={o.id} title={o.hint}>
                  {o.label}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 11, color: '#64748b' }}>{presetHint}</span>
          </div>

          {port == null || !ips.length ? (
            <div
              style={{
                padding: 12,
                borderRadius: 10,
                border: '1px solid #7f1d1d',
                background: '#1f0a0a',
                color: '#fecaca',
                fontSize: 13
              }}
            >
              {port == null
                ? 'Iniciando servidor local…'
                : 'No se detectaron IPs de red local. Conectá la PC al Wi-Fi (o Ethernet) y reiniciá Studio Live.'}
            </div>
          ) : (
            <CameraConnectQR
              ips={ips}
              port={port}
              preset={preset}
              workspace={workspace}
              onCopyUrl={onCopyUrl}
            />
          )}

          <details style={{ fontSize: 12, color: '#94a3b8' }}>
            <summary style={{ cursor: 'pointer', color: '#cbd5e1' }}>Más ayuda (HTTPS, ping, PC local)</summary>
            <ol style={{ paddingLeft: 18, marginTop: 10, lineHeight: 1.55 }}>
              <li>
                Probar TLS desde el celular: abrí una URL de ping (debería verse{' '}
                <code style={{ color: '#86efac' }}>studio-live-ok</code>).
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
              </li>
              <li style={{ marginTop: 8 }}>
                No abras el link dentro de WhatsApp: usá &quot;Abrir en Chrome&quot; o &quot;Abrir en Safari&quot;.
              </li>
            </ol>
          </details>
        </div>
      </div>
    </div>
  )
}
