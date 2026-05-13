import { useCallback, useEffect, useRef, useState } from 'react'

import { AnalyserPeakMeter } from './AnalyserPeakMeter'
import { AudioLevelMeter } from './AudioLevelMeter'

const POS_STORAGE = 'studioLive.pcAudioPanel.v2'
const GAIN_STORAGE = 'studioLive.pcAudio.gainPercent'
const COLLAPSED_STORAGE = 'studioLive.pcAudioPanel.collapsed'

type PanelPos = { x?: number; y?: number }

function readStoredPos(): PanelPos {
  try {
    const raw = localStorage.getItem(POS_STORAGE)
    if (!raw) return {}
    const o = JSON.parse(raw) as unknown
    if (!o || typeof o !== 'object') return {}
    return o as PanelPos
  } catch {
    return {}
  }
}

function writeStoredPos(p: PanelPos) {
  try {
    localStorage.setItem(POS_STORAGE, JSON.stringify(p))
  } catch {
    /* vacío */
  }
}

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE) === '1'
  } catch {
    return false
  }
}

function writeStoredCollapsed(v: boolean) {
  try {
    localStorage.setItem(COLLAPSED_STORAGE, v ? '1' : '0')
  } catch {
    /* vacío */
  }
}

export function readStoredPcAudioGainPercent(): number {
  try {
    const raw = localStorage.getItem(GAIN_STORAGE)
    if (raw == null) return 100
    const n = Number(raw)
    if (!Number.isFinite(n)) return 100
    return Math.min(200, Math.max(0, Math.round(n)))
  } catch {
    return 100
  }
}

export function writeStoredPcAudioGainPercent(n: number) {
  try {
    localStorage.setItem(GAIN_STORAGE, String(Math.min(200, Math.max(0, Math.round(n)))))
  } catch {
    /* vacío */
  }
}

type Props = {
  open: boolean
  onClose: () => void
  disabled: boolean
  audioInputs: MediaDeviceInfo[]
  selectedDeviceId: string
  onDeviceChange: (deviceId: string) => void
  onActivate: () => void
  audioNote: string | null
  rawStream: MediaStream | null
  analyser: AnalyserNode | null
  gainPercent: number
  onGainPercentChange: (n: number) => void
}

export function FloatingPcAudioPanel({
  open,
  onClose,
  disabled,
  audioInputs,
  selectedDeviceId,
  onDeviceChange,
  onActivate,
  audioNote,
  rawStream,
  analyser,
  gainPercent,
  onGainPercentChange
}: Props) {
  const storedPos = useRef(readStoredPos())
  const [pos, setPos] = useState(() => {
    const s = storedPos.current
    if (typeof s.x === 'number' && typeof s.y === 'number') return { x: s.x, y: s.y }
    return { x: 24, y: 96 }
  })
  const dragRef = useRef<{ dx: number; dy: number; active: boolean } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [clipping, setClipping] = useState(false)
  const [collapsed, setCollapsed] = useState(() => readStoredCollapsed())

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const n = !c
      writeStoredCollapsed(n)
      return n
    })
  }

  const clampPos = useCallback((x: number, y: number) => {
    const pad = 8
    const el = rootRef.current
    const w = el?.offsetWidth ?? 320
    const h = el?.offsetHeight ?? 240
    const maxX = Math.max(pad, window.innerWidth - w - pad)
    const maxY = Math.max(pad, window.innerHeight - h - pad)
    return {
      x: Math.min(maxX, Math.max(pad, x)),
      y: Math.min(maxY, Math.max(pad, y))
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d?.active) return
      const next = clampPos(e.clientX - d.dx, e.clientY - d.dy)
      setPos(next)
    }
    const onUp = () => {
      const d = dragRef.current
      if (!d?.active) return
      dragRef.current = null
      setPos((p) => {
        writeStoredPos({ x: p.x, y: p.y })
        return p
      })
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [clampPos, onClose, open])

  const startDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button,select,input,option,a,label')) return
    dragRef.current = { active: true, dx: e.clientX - pos.x, dy: e.clientY - pos.y }
  }

  if (!open) return null

  const hasLiveTrack = Boolean(rawStream?.getAudioTracks().some((t) => t.readyState === 'live'))
  const gainLabel = `${gainPercent}%`
  const approxDb =
    gainPercent <= 0 ? '−∞' : `${(20 * Math.log10(gainPercent / 100)).toFixed(1)} dB`

  if (collapsed) {
    return (
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="false"
        aria-label="Audio de PC (minimizado)"
        style={{
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          zIndex: 65,
          width: 220,
          maxWidth: 'calc(100vw - 24px)',
          borderRadius: 12,
          border: clipping ? '1px solid #f87171' : '1px solid #334155',
          background: '#0b1220',
          boxShadow: '0 10px 28px rgba(0,0,0,0.5)',
          color: '#e2e8f0',
          fontSize: 12,
          overflow: 'hidden'
        }}
      >
        <div
          onMouseDown={startDrag}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 8px 6px 10px',
            background: '#0f172a',
            cursor: 'grab',
            userSelect: 'none'
          }}
        >
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Expandir"
            title="Expandir"
            style={{
              border: 'none',
              background: 'transparent',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
              padding: 2
            }}
          >
            ▾
          </button>
          <span style={{ fontSize: 11, fontWeight: 700, flex: 1 }}>Audio PC</span>
          {clipping ? (
            <span style={{ fontSize: 9, fontWeight: 800, color: '#fecaca' }}>CLIP</span>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            title="Cerrar"
            style={{
              border: '1px solid #334155',
              background: '#1e293b',
              color: '#cbd5e1',
              borderRadius: 6,
              padding: '2px 7px',
              cursor: 'pointer',
              fontSize: 11,
              lineHeight: 1
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: '4px 10px 8px' }}>
          {analyser && hasLiveTrack ? (
            <AnalyserPeakMeter analyser={analyser} height={8} showClipZone={false} onClipChange={setClipping} />
          ) : hasLiveTrack && rawStream ? (
            <div style={{ transform: 'scaleY(0.55)', transformOrigin: 'top' }}>
              <AudioLevelMeter stream={rawStream} />
            </div>
          ) : (
            <div style={{ fontSize: 10, color: '#64748b', padding: '4px 0' }}>Sin entrada</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="false"
      aria-label="Audio de PC"
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 65,
        width: 340,
        maxWidth: 'calc(100vw - 24px)',
        borderRadius: 12,
        border: clipping ? '1px solid #f87171' : '1px solid #334155',
        background: '#0b1220',
        boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
        color: '#e2e8f0',
        fontSize: 12
      }}
    >
      <div
        onMouseDown={startDrag}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '10px 12px',
          background: '#0f172a',
          borderBottom: '1px solid #1e293b',
          cursor: 'grab',
          userSelect: 'none'
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 13 }}>Audio de PC · nivel y ganancia</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Minimizar"
            title="Minimizar a píldora con medidor"
            style={{
              border: '1px solid #334155',
              background: '#1e293b',
              color: '#cbd5e1',
              borderRadius: 6,
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: 11
            }}
          >
            Minimizar
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            title="Cerrar (Esc)"
            style={{
              border: '1px solid #334155',
              background: '#1e293b',
              color: '#cbd5e1',
              borderRadius: 6,
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: 13,
              lineHeight: 1
            }}
          >
            ✕
          </button>
        </div>
      </div>

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.45 }}>
          Elegí entrada y ajustá <strong style={{ color: '#cbd5e1' }}>ganancia hacia la grabación</strong>. El medidor
          es post-fader: si ves <strong style={{ color: '#fecaca' }}>CLIP</strong>, bajá ganancia o la mezcla de la
          interfaz antes de grabar.
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <select
            value={selectedDeviceId}
            disabled={disabled}
            onChange={(ev) => onDeviceChange(ev.target.value)}
            style={{
              flex: '1 1 180px',
              minWidth: 160,
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid #334155',
              background: '#0f172a',
              color: '#e2e8f0'
            }}
          >
            <option value="">Predeterminado de Windows</option>
            {audioInputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Entrada ${d.deviceId.slice(0, 8)}…`}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={disabled}
            onClick={onActivate}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #334155',
              background: '#14532d',
              color: '#dcfce7',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontWeight: 600
            }}
          >
            {hasLiveTrack ? 'Reactivar audio' : 'Activar audio'}
          </button>
        </div>

        {audioNote ? <div style={{ fontSize: 11, color: '#fca5a5' }}>{audioNote}</div> : null}

        {hasLiveTrack ? (
          <>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>Nivel (después de ganancia)</span>
                {clipping ? (
                  <span style={{ fontSize: 10, fontWeight: 800, color: '#fecaca' }}>
                    CLIP — bajá ganancia o mezcla
                  </span>
                ) : null}
              </div>
              {analyser ? (
                <AnalyserPeakMeter analyser={analyser} onClipChange={setClipping} />
              ) : rawStream ? (
                <AudioLevelMeter stream={rawStream} />
              ) : null}
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>Ganancia hacia grabación</span>
                <span style={{ fontSize: 11, color: '#86efac', fontVariantNumeric: 'tabular-nums' }}>
                  {gainLabel} (~{approxDb})
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={200}
                step={1}
                disabled={disabled}
                value={gainPercent}
                onChange={(ev) => {
                  const v = Number(ev.target.value)
                  onGainPercentChange(v)
                  writeStoredPcAudioGainPercent(v)
                }}
                style={{ width: '100%', accentColor: '#38bdf8' }}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 4,
                  fontSize: 10,
                  color: '#475569'
                }}
              >
                <span>0% silencio</span>
                <span>100% unidad</span>
                <span>200% máx.</span>
              </div>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 11, color: '#64748b' }}>
            Tocá <strong style={{ color: '#cbd5e1' }}>Activar audio</strong> para empezar a usar la interfaz / micrófono
            de Windows. Esto es opcional: las cámaras del celular funcionan sin esto.
          </div>
        )}
      </div>
    </div>
  )
}
