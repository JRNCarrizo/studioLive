import { useEffect, useState } from 'react'

import type { DisplaySourceOption } from './displayCapture'
import { YOUTUBE_CAPTURE_CHECKLIST } from './youtubeCaptureHelp'
import { btnNeutral } from './workspaceChrome'

type Props = {
  open: boolean
  onClose: () => void
  onPick: (sourceId: string) => void
  excludeFromCaptureSupported?: boolean
  excludeFromCapture?: boolean
  onExcludeFromCaptureChange?: (enabled: boolean) => void
}

export function DisplayCapturePicker({
  open,
  onClose,
  onPick,
  excludeFromCaptureSupported = false,
  excludeFromCapture = false,
  onExcludeFromCaptureChange
}: Props) {
  const [sources, setSources] = useState<DisplaySourceOption[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  /** Por defecto solo monitores: las ventanas de navegador suelen quedar congeladas con YouTube. */
  const [showWindows, setShowWindows] = useState(false)

  const canExcludeFromCapture =
    excludeFromCaptureSupported ||
    Boolean(
      onExcludeFromCaptureChange &&
        window.studio?.setExcludeFromCapture &&
        typeof navigator !== 'undefined' &&
        /Windows|Mac/i.test(navigator.userAgent)
    )

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
        {canExcludeFromCapture ? (
          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              marginBottom: 12,
              padding: '10px 12px',
              borderRadius: 8,
              border: excludeFromCapture ? '1px solid #0d9488' : '1px solid #334155',
              background: excludeFromCapture ? 'rgba(19, 78, 74, 0.45)' : 'rgba(15, 23, 42, 0.8)',
              cursor: 'pointer',
              fontSize: 12,
              lineHeight: 1.45,
              color: '#e2e8f0'
            }}
          >
            <input
              type="checkbox"
              checked={excludeFromCapture}
              onChange={(e) => onExcludeFromCaptureChange?.(e.target.checked)}
              style={{ marginTop: 3, flexShrink: 0, accentColor: '#14b8a6' }}
            />
            <span>
              <strong style={{ color: excludeFromCapture ? '#99f6e4' : '#cbd5e1' }}>
                Ocultar Studio Live en la captura
              </strong>
              <span style={{ display: 'block', marginTop: 4, color: '#94a3b8', fontSize: 11 }}>
                Recomendado al grabar el monitor: vos seguís viendo y controlando la app, pero no sale en la
                grabación. Desmarcá solo si querés que Studio Live aparezca en la captura.
              </span>
            </span>
          </label>
        ) : null}
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
          <strong style={{ color: '#fde68a' }}>YouTube / streaming:</strong> usá «Solo pantallas» (monitor). «Ocultar
          en captura» no arregla el congelado — es límite del navegador.
        </p>
        <ol
          style={{
            fontSize: 11,
            color: '#cbd5e1',
            margin: '0 0 14px',
            paddingLeft: 20,
            lineHeight: 1.55
          }}
        >
          {YOUTUBE_CAPTURE_CHECKLIST.map((line) => (
            <li key={line} style={{ marginBottom: 4 }}>
              {line}
            </li>
          ))}
        </ol>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setShowWindows(false)}
            style={{
              ...btnNeutral,
              fontWeight: !showWindows ? 700 : 500,
              border: !showWindows ? '2px solid #10b981' : '1px solid #334155',
              background: !showWindows ? '#064e3b' : '#0f172a',
              color: !showWindows ? '#a7f3d0' : '#94a3b8'
            }}
          >
            Solo pantallas
          </button>
          <button
            type="button"
            onClick={() => setShowWindows(true)}
            style={{
              ...btnNeutral,
              fontWeight: showWindows ? 700 : 500,
              border: showWindows ? '2px solid #f59e0b' : '1px solid #334155',
              background: showWindows ? '#78350f' : '#0f172a',
              color: showWindows ? '#fde68a' : '#94a3b8'
            }}
          >
            Mostrar ventanas (YouTube suele fallar)
          </button>
        </div>

        {loading ? <p style={{ fontSize: 13, color: '#64748b' }}>Buscando fuentes…</p> : null}
        {err ? <p style={{ fontSize: 13, color: '#fca5a5', marginBottom: 12 }}>{err}</p> : null}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 10
          }}
        >
          {sources
            .filter((s) => showWindows || s.kind === 'screen')
            .map((s) => (
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
