import { useEffect, useState } from 'react'

type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'

type UpdateEventPayload =
  | { phase: 'checking' }
  | { phase: 'available'; version: string }
  | { phase: 'not-available' }
  | { phase: 'downloading'; percent: number }
  | { phase: 'ready'; version: string }
  | { phase: 'error'; message: string }

export function UpdateBanner() {
  const [phase, setPhase] = useState<UpdatePhase>('idle')
  const [version, setVersion] = useState<string | null>(null)
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)

  useEffect(() => {
    void window.studio.getAppVersion().then(setAppVersion)
    return window.studio.onUpdateEvent((payload: UpdateEventPayload) => {
      switch (payload.phase) {
        case 'checking':
          setPhase('checking')
          setError(null)
          break
        case 'available':
          setPhase('available')
          setVersion(payload.version)
          break
        case 'not-available':
          setPhase('idle')
          break
        case 'downloading':
          setPhase('downloading')
          setPercent(payload.percent)
          break
        case 'ready':
          setPhase('ready')
          setVersion(payload.version)
          break
        case 'error':
          setPhase('error')
          setError(payload.message)
          break
        default:
          break
      }
    })
  }, [])

  if (phase === 'idle' && !error) {
    return (
      <button
        type="button"
        onClick={() => void window.studio.checkForUpdates()}
        title={`Versión ${appVersion ?? '…'} · Buscar actualizaciones`}
        style={{
          padding: '5px 10px',
          borderRadius: 8,
          border: '1px solid #334155',
          background: '#0f172a',
          color: '#94a3b8',
          fontSize: 11,
          cursor: 'pointer',
          flexShrink: 0
        }}
      >
        v{appVersion ?? '…'}
      </button>
    )
  }

  if (phase === 'checking') {
    return (
      <span style={{ fontSize: 11, color: '#94a3b8', flexShrink: 0 }}>Buscando actualizaciones…</span>
    )
  }

  if (phase === 'available' || phase === 'downloading') {
    return (
      <span style={{ fontSize: 11, color: '#7dd3fc', flexShrink: 0 }}>
        {phase === 'downloading'
          ? `Descargando v${version ?? ''}… ${Math.round(percent)}%`
          : `Actualización v${version ?? ''}…`}
      </span>
    )
  }

  if (phase === 'ready') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: '#bbf7d0' }}>Listo: v{version}</span>
        <button
          type="button"
          onClick={() => void window.studio.installUpdate()}
          style={{
            padding: '5px 10px',
            borderRadius: 8,
            border: '1px solid #16a34a',
            background: '#14532d',
            color: '#bbf7d0',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          Reiniciar e instalar
        </button>
      </div>
    )
  }

  if (phase === 'error' && error) {
    return (
      <button
        type="button"
        onClick={() => void window.studio.checkForUpdates()}
        title={error}
        style={{
          padding: '5px 10px',
          borderRadius: 8,
          border: '1px solid #7f1d1d',
          background: '#450a0a',
          color: '#fecaca',
          fontSize: 11,
          cursor: 'pointer',
          flexShrink: 0
        }}
      >
        Update falló · reintentar
      </button>
    )
  }

  return null
}
