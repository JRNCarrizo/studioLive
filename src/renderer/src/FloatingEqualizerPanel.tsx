import { useCallback, useEffect, useRef, useState } from 'react'

import {
  EQ_BAND_COUNT,
  EQ_PRESETS,
  FUSION_EQ_BANDS,
  type EqGains,
  type FusionAudioGraph
} from './useFusionAudioGraph'

const POS_STORAGE = 'studioLive.fusionEqPanel.pos.v1'
const COLLAPSED_STORAGE = 'studioLive.fusionEqPanel.collapsed.v1'

type PanelPos = { x?: number; y?: number }

function readPos(): PanelPos {
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

function writePos(p: PanelPos) {
  try {
    localStorage.setItem(POS_STORAGE, JSON.stringify(p))
  } catch {
    /* vacío */
  }
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(v: boolean) {
  try {
    localStorage.setItem(COLLAPSED_STORAGE, v ? '1' : '0')
  } catch {
    /* vacío */
  }
}

type Props = {
  open: boolean
  onClose: () => void
  graph: FusionAudioGraph
  /** Aviso al usuario: el EQ se va a aplicar a la grabación de fusión que se inicie a continuación. */
  fusionRecording: boolean
}

const CURVE_W = 320
const CURVE_H = 110

/** Frecuencias de muestreo para la curva: log-escala 20 Hz – 20 kHz. */
const CURVE_FREQS = (() => {
  const arr = new Float32Array(CURVE_W)
  for (let i = 0; i < CURVE_W; i++) {
    const t = i / (CURVE_W - 1)
    arr[i] = 20 * Math.pow(20000 / 20, t)
  }
  return arr
})()

function drawCurve(
  ctx: CanvasRenderingContext2D,
  filters: BiquadFilterNode[],
  bypass: boolean
) {
  ctx.fillStyle = '#0b1220'
  ctx.fillRect(0, 0, CURVE_W, CURVE_H)

  // Grilla
  ctx.strokeStyle = 'rgba(51, 65, 85, 0.6)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (const f of [50, 100, 250, 500, 1000, 2500, 5000, 10000]) {
    const x = (Math.log10(f / 20) / Math.log10(20000 / 20)) * CURVE_W
    ctx.moveTo(x, 0)
    ctx.lineTo(x, CURVE_H)
  }
  ctx.stroke()
  // Línea 0 dB
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.6)'
  ctx.beginPath()
  ctx.moveTo(0, CURVE_H / 2)
  ctx.lineTo(CURVE_W, CURVE_H / 2)
  ctx.stroke()

  if (!filters.length) return

  const mag = new Float32Array(CURVE_W)
  const phase = new Float32Array(CURVE_W)
  const tmp = new Float32Array(CURVE_W)
  // Producto de respuestas magnitudes (en lineal) — equivalente a sumar dB.
  for (let i = 0; i < CURVE_W; i++) mag[i] = 1

  if (!bypass) {
    for (const f of filters) {
      f.getFrequencyResponse(CURVE_FREQS, tmp, phase)
      for (let i = 0; i < CURVE_W; i++) mag[i] *= tmp[i]!
    }
  }

  ctx.lineWidth = 2
  ctx.strokeStyle = bypass ? '#475569' : '#7dd3fc'
  ctx.beginPath()
  /** Rango visual ±12 dB ocupa toda la altura. */
  for (let i = 0; i < CURVE_W; i++) {
    const db = 20 * Math.log10(Math.max(1e-6, mag[i]!))
    const y = CURVE_H / 2 - (db / 12) * (CURVE_H / 2 - 4)
    if (i === 0) ctx.moveTo(i, y)
    else ctx.lineTo(i, y)
  }
  ctx.stroke()
}

export function FloatingEqualizerPanel({ open, onClose, graph, fusionRecording }: Props) {
  const storedPos = useRef(readPos())
  const [pos, setPos] = useState(() => {
    const s = storedPos.current
    if (typeof s.x === 'number' && typeof s.y === 'number') return { x: s.x, y: s.y }
    return { x: window.innerWidth - 400, y: 120 }
  })
  const [collapsed, setCollapsed] = useState(() => readCollapsed())
  const dragRef = useRef<{ dx: number; dy: number; active: boolean } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const curveCanvasRef = useRef<HTMLCanvasElement>(null)

  const clampPos = useCallback((x: number, y: number) => {
    const pad = 8
    const el = rootRef.current
    const w = el?.offsetWidth ?? 360
    const h = el?.offsetHeight ?? 320
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
      setPos(clampPos(e.clientX - d.dx, e.clientY - d.dy))
    }
    const onUp = () => {
      const d = dragRef.current
      if (!d?.active) return
      dragRef.current = null
      setPos((p) => {
        writePos({ x: p.x, y: p.y })
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

  /** Dibuja la curva de respuesta (la combina de los 5 biquads). Redibuja en RAF. */
  useEffect(() => {
    if (!open || collapsed) return
    const canvas = curveCanvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = CURVE_W * dpr
    canvas.height = CURVE_H * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    let raf = 0
    const tick = () => {
      drawCurve(ctx, graph.filters, graph.bypass)
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [open, collapsed, graph.filters, graph.bypass, graph.gains])

  const startDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button,select,input,option,a,label')) return
    dragRef.current = { active: true, dx: e.clientX - pos.x, dy: e.clientY - pos.y }
  }

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const n = !c
      writeCollapsed(n)
      return n
    })
  }

  const hasGain = graph.gains.some((g) => Math.abs(g) > 0.05)
  const eqActive = hasGain && !graph.bypass

  if (!open) return null

  if (collapsed) {
    return (
      <div
        ref={rootRef}
        role="dialog"
        aria-label="EQ fusión (minimizado)"
        style={{
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          zIndex: 65,
          width: 200,
          borderRadius: 12,
          border: '1px solid #334155',
          background: '#0b1220',
          color: '#e2e8f0',
          fontSize: 12,
          overflow: 'hidden',
          boxShadow: '0 10px 28px rgba(0,0,0,0.5)'
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
          <span style={{ fontSize: 11, fontWeight: 700, flex: 1 }}>EQ</span>
          {eqActive ? (
            <span style={{ fontSize: 9, fontWeight: 800, color: '#7dd3fc' }}>ACT</span>
          ) : graph.bypass ? (
            <span style={{ fontSize: 9, fontWeight: 800, color: '#64748b' }}>BYP</span>
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
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="EQ fusión"
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 65,
        width: 360,
        maxWidth: 'calc(100vw - 24px)',
        borderRadius: 12,
        border: '1px solid #334155',
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
        <span style={{ fontWeight: 700, fontSize: 13 }}>
          Ecualizador · audio de fusión {eqActive ? <span style={{ color: '#7dd3fc' }}>· activo</span> : null}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={toggleCollapsed}
            title="Minimizar"
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
          5 bandas paramétricas. La curva se aplica al audio y se <strong style={{ color: '#cbd5e1' }}>graba</strong>{' '}
          al exportar la fusión. Se escucha también mientras reproducís.
          {fusionRecording ? (
            <span style={{ display: 'block', marginTop: 4, color: '#fcd34d' }}>
              Grabación en curso: los cambios ya están entrando al WebM.
            </span>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <label htmlFor="eq-preset" style={{ fontSize: 11, color: '#94a3b8' }}>
            Preset:
          </label>
          <select
            id="eq-preset"
            onChange={(ev) => {
              const p = EQ_PRESETS.find((x) => x.id === ev.target.value)
              if (p) graph.applyPreset(p.gains)
              ev.currentTarget.value = ''
            }}
            defaultValue=""
            style={{
              padding: '4px 8px',
              borderRadius: 6,
              border: '1px solid #334155',
              background: '#0f172a',
              color: '#e2e8f0',
              fontSize: 12
            }}
          >
            <option value="" disabled>
              Elegir preset…
            </option>
            {EQ_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <span style={{ flex: 1 }} />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#94a3b8' }}>
            <input
              type="checkbox"
              checked={graph.bypass}
              onChange={(ev) => graph.setBypass(ev.target.checked)}
            />
            Bypass
          </label>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            padding: 6,
            borderRadius: 8,
            border: '1px solid #1e293b',
            background: '#020617'
          }}
        >
          <canvas
            ref={curveCanvasRef}
            style={{
              width: CURVE_W,
              height: CURVE_H,
              display: 'block'
            }}
          />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${EQ_BAND_COUNT}, 1fr)`,
            gap: 6
          }}
        >
          {FUSION_EQ_BANDS.map((band, i) => {
            const v = graph.gains[i] ?? 0
            return (
              <div
                key={band.label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  padding: 4
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    color: '#64748b',
                    fontVariantNumeric: 'tabular-nums'
                  }}
                >
                  {band.label}
                </span>
                <input
                  type="range"
                  min={-12}
                  max={12}
                  step={0.5}
                  value={v}
                  disabled={graph.bypass}
                  onChange={(ev) => graph.setBandGain(i, Number(ev.target.value))}
                  onDoubleClick={() => graph.setBandGain(i, 0)}
                  title="Doble clic = 0 dB"
                  style={{
                    writingMode: 'vertical-lr' as never,
                    appearance: 'slider-vertical' as never,
                    width: 20,
                    height: 90,
                    accentColor: '#7dd3fc'
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    color: Math.abs(v) > 0.05 ? '#7dd3fc' : '#64748b',
                    fontVariantNumeric: 'tabular-nums'
                  }}
                >
                  {v > 0 ? '+' : ''}
                  {v.toFixed(1)} dB
                </span>
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={() => graph.applyPreset([0, 0, 0, 0, 0] as EqGains)}
            style={{
              flex: 1,
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid #334155',
              background: '#0f172a',
              color: '#cbd5e1',
              cursor: 'pointer',
              fontSize: 11
            }}
          >
            Reset (plano)
          </button>
        </div>
      </div>
    </div>
  )
}
