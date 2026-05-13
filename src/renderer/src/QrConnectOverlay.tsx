import { useEffect } from 'react'

import { CameraConnectQR } from './CameraConnectQR'

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

  if (!open) return null

  const presetHint = presetOptions.find((o) => o.id === preset)?.hint

  return (
    <div
      role="dialog"
      aria-modal="true"
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
          width: 'min(720px, 100%)',
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
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              Conectar cámaras — {workspace === 'liveFusion' ? 'Fusión en vivo' : 'Sesión en vivo'}
            </div>
            <div style={{ fontSize: 11, color: '#64748b' }}>
              Escaneá con el celular en la misma Wi-Fi. Cerrá con Esc o tocando fuera.
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

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
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
              onExportCert={onExportCert}
            />
          )}

          <details style={{ fontSize: 12, color: '#94a3b8' }}>
            <summary style={{ cursor: 'pointer', color: '#cbd5e1' }}>
              HTTPS no carga o el celular no confía en la página
            </summary>
            <ol style={{ paddingLeft: 18, marginTop: 10, lineHeight: 1.55 }}>
              <li>
                Probar TLS desde el celular: abrí una URL de ping (debería verse el texto{' '}
                <code style={{ color: '#86efac' }}>studio-live-ok</code>). Si no abre, revisá mismo Wi-Fi, firewall en
                Windows (permitir Node/Electron en redes privadas) y que la IP sea la correcta.
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
                <code style={{ wordBreak: 'break-all', color: '#cbd5e1' }}>{localPreviewUrl || '—'}</code>. Si acá
                funciona y en el celular no, el problema suele ser confianza del certificado en el teléfono.
              </li>
              <li style={{ marginTop: 10 }}>
                <strong>Android:</strong> exportá el certificado con el botón de arriba, pasalo al teléfono y en
                Ajustes → Seguridad → Cifrado / Credenciales → Instalar certificado → &quot;VPN y aplicaciones&quot; o
                &quot;CA&quot; según tu versión.
              </li>
              <li style={{ marginTop: 8 }}>
                <strong>iPhone:</strong> enviate el .crt por Mail/AirDrop, instalá el perfil y en Ajustes → General →
                Información → Ajustes de confianza del certificado activá confianza para ese perfil.
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
