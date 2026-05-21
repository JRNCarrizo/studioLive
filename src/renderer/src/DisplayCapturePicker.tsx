import { useEffect, useState } from 'react'

import type { DisplaySourceOption } from './displayCapture'
import { btnNeutral } from './workspaceChrome'

type Props = {
  open: boolean
  onClose: () => void
  onPick: (sourceId: string) => void
}

export function DisplayCapturePicker({ open, onClose, onPick }: Props) {
  const [sources, setSources] = useState<DisplaySourceOption[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setErr(null)
    setSources([])
    void window.studio
      .listDisplaySources()
      .then((list) => {
        if (cancelled) return
        const sorted = [...list].sort((a, b) => {
          if (a.kind === b.kind) return a.name.localeCompare(b.name)
          return a.kind === 'screen' ? -1 : 1
        })
        setSources(sorted)
        if (!sorted.length) setErr('No se encontraron pantallas ni ventanas para capturar.')
      })
      .catch((e) => {
        if (cancelled) return
        setErr(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="display-picker-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10002,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(2, 6, 23, 0.82)',
        backdropFilter: 'blur(4px)'
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(720px, 100%)',
          maxHeight: 'min(85vh, 720px)',
          overflow: 'auto',
          padding: 18,
          borderRadius: 12,
          background: '#0f172a',
          border: '1px solid #334155',
          boxShadow: '0 25px 50px rgba(0,0,0,0.55)'
        }}
      >
        <div id="display-picker-title" style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 8 }}>
          Elegir pantalla o ventana
        </div>
        <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10, lineHeight: 1.5 }}>
          Elegí qué compartir desde esta PC. Evitá la ventana de Studio Live para no ver un efecto espejo.
        </p>
        <p
          style={{
            fontSize: 11,
            color: '#bae6fd',
            marginBottom: 10,
            lineHeight: 1.5,
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid #0369a1',
            background: 'rgba(12, 74, 110, 0.35)'
          }}
        >
          <strong style={{ color: '#e0f2fe' }}>Un solo monitor:</strong> después de elegir la pantalla, minimizá
          Studio Live desde la barra de tareas para que no tape el tutorial. La captura y la grabación siguen activas.
        </p>
        <p
          style={{
            fontSize: 11,
            color: '#fcd34d',
            marginBottom: 14,
            lineHeight: 1.5,
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid #854d0e',
            background: 'rgba(120, 53, 15, 0.25)'
          }}
        >
          <strong style={{ color: '#fde68a' }}>YouTube o vídeo en el navegador:</strong> elegí la{' '}
          <strong>pantalla completa</strong> (monitor), no la ventana del navegador. En ventana el vídeo suele
          quedar quieto por la aceleración de hardware de Chrome/Edge.
        </p>

        {loading ? <p style={{ fontSize: 13, color: '#64748b' }}>Buscando fuentes…</p> : null}
        {err ? <p style={{ fontSize: 13, color: '#fca5a5', marginBottom: 12 }}>{err}</p> : null}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 10
          }}
        >
          {sources.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(s.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                padding: 0,
                borderRadius: 8,
                border: '1px solid #475569',
                background: '#020617',
                cursor: 'pointer',
                overflow: 'hidden',
                textAlign: 'left'
              }}
            >
              <img
                src={s.thumbnailDataUrl}
                alt=""
                style={{ width: '100%', aspectRatio: '16/10', objectFit: 'cover', background: '#000' }}
              />
              <span
                style={{
                  padding: '8px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#e2e8f0',
                  lineHeight: 1.35,
                  wordBreak: 'break-word',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4
                }}
              >
                <span
                  style={{
                    alignSelf: 'flex-start',
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: s.kind === 'screen' ? '#6ee7b7' : '#94a3b8',
                    background: s.kind === 'screen' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(100, 116, 139, 0.2)',
                    padding: '2px 6px',
                    borderRadius: 4
                  }}
                >
                  {s.kind === 'screen' ? 'Pantalla · recomendado' : 'Ventana'}
                </span>
                {s.name}
              </span>
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" onClick={onClose} style={{ ...btnNeutral, fontWeight: 600 }}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
