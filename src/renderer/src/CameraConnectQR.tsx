import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

type StudioCameraWorkspace = 'live' | 'liveFusion'

type Props = {
  ips: string[]
  port: number
  preset: string
  workspace: StudioCameraWorkspace
  onCopyUrl: (url: string) => void
  /** Tamaño en px del QR (lado del cuadrado). */
  size?: number
}

/**
 * Bloque de “unirse al estudio”: QR escaneable + selector de IP LAN + URL como texto fallback.
 * La URL embebe `preset` y `studioWorkspace`, así que el QR se regenera cuando cambian esos valores.
 */
export function CameraConnectQR({
  ips,
  port,
  preset,
  workspace,
  onCopyUrl,
  size = 220
}: Props) {
  const [ipIdx, setIpIdx] = useState(0)

  useEffect(() => {
    if (ipIdx >= ips.length) setIpIdx(0)
  }, [ips, ipIdx])

  const selectedIp = ips[ipIdx] ?? ips[0] ?? ''

  const url = useMemo(() => {
    if (!selectedIp) return ''
    return `https://${selectedIp}:${port}/?preset=${encodeURIComponent(preset)}&studioWorkspace=${workspace}`
  }, [selectedIp, port, preset, workspace])

  if (!ips.length) {
    return (
      <div
        style={{
          padding: 12,
          borderRadius: 10,
          border: '1px solid #7f1d1d',
          background: '#1f0a0a',
          color: '#fecaca',
          fontSize: 13,
          maxWidth: 560
        }}
      >
        No se detectaron IPs de red local. Conectá la PC al Wi-Fi (o Ethernet) y reiniciá Studio Live.
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: 20,
        flexWrap: 'wrap',
        alignItems: 'stretch'
      }}
    >
      <div
        style={{
          background: 'white',
          padding: 12,
          borderRadius: 14,
          border: '1px solid #243046',
          boxShadow: '0 4px 18px rgba(0,0,0,0.35)',
          flexShrink: 0,
          alignSelf: 'flex-start'
        }}
        aria-label="Código QR para conectar el celular"
      >
        <QRCodeSVG
          value={url || ' '}
          size={size}
          level="M"
          marginSize={0}
          bgColor="#ffffff"
          fgColor="#0b1220"
        />
      </div>

      <div style={{ flex: '1 1 280px', minWidth: 240, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600, marginBottom: 4 }}>
          Escaneá con la cámara del celular
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10, lineHeight: 1.45 }}>
          Apuntá la cámara del teléfono al código. Abrí el enlace en <strong style={{ color: '#e2e8f0' }}>Chrome</strong>{' '}
          o <strong style={{ color: '#e2e8f0' }}>Safari</strong> — no dentro de WhatsApp.
        </div>

        {ips.length > 1 ? (
          <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label htmlFor="studio-connect-ip" style={{ fontSize: 12, color: '#94a3b8' }}>
              IP:
            </label>
            <select
              id="studio-connect-ip"
              value={ipIdx}
              onChange={(ev) => setIpIdx(Number(ev.target.value))}
              style={{
                padding: '4px 8px',
                borderRadius: 8,
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#e2e8f0',
                fontSize: 12
              }}
            >
              {ips.map((ip, i) => (
                <option key={ip} value={i}>
                  {ip}
                  {i === 0 ? ' (recomendada)' : ''}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 11, color: '#64748b' }}>Probá otra si la primera no carga.</span>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>
            IP de esta PC en la red: <strong style={{ color: '#cbd5e1' }}>{selectedIp}</strong>
          </div>
        )}

        <div
          style={{
            fontSize: 11,
            color: '#cbd5e1',
            wordBreak: 'break-all',
            background: '#0f172a',
            border: '1px solid #1e293b',
            borderRadius: 8,
            padding: '8px 10px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            lineHeight: 1.45
          }}
        >
          {url}
        </div>

        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={() => onCopyUrl(url)}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid #334155',
              background: '#1e293b',
              color: '#e2e8f0',
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            Copiar URL del QR
          </button>
        </div>
      </div>
    </div>
  )
}
