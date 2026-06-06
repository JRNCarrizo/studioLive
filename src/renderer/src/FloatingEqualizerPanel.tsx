import { useCallback, useEffect, useRef, useState } from 'react'

import {
  EQ_BAND_COUNT,
  EQ_PRESETS,
  FUSION_EQ_BANDS,
  type EqGains,
  type FusionAudioGraph
} from './useFusionAudioGraph'
import { GLYPH } from './uiGlyphs'

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

/** Escala similar al panel flotante de movimiento (~200px de ancho). */
const CURVE_W = 176
const CURVE_H = 58

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

/** Botón en el riel del programa (abre el panel flotante de EQ). */
export function FusionEqTrigger({
  active,
  disabled,
  processing,
  onClick
}: {
  active?: boolean
  disabled?: boolean
  /** Alguna banda con ganancia y sin bypass. */
  processing?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={[
        'fusion-rail-trigger',
        'fusion-eq-trigger',
        active ? 'fusion-rail-trigger--on' : '',
        processing ? 'fusion-eq-trigger--processing' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled}
      onClick={onClick}
      title={
        disabled
          ? 'Cargá audio-*.webm en la sesión para ecualizar la mezcla.'
          : 'Ecualizador del audio de la mezcla (afecta la grabación).'
      }
      aria-label="Abrir ecualizador"
      aria-pressed={active}
    >
      <span className="fusion-rail-trigger__icon" aria-hidden>
        {GLYPH.eq}
      </span>
      <span className="fusion-rail-trigger__label">EQ</span>
    </button>
  )
}

export function FloatingEqualizerPanel({ open, onClose, graph, fusionRecording }: Props) {
  const storedPos = useRef(readPos())
  const [pos, setPos] = useState(() => {
    const s = storedPos.current
    if (typeof s.x === 'number' && typeof s.y === 'number') return { x: s.x, y: s.y }
    return { x: Math.max(12, window.innerWidth - 220), y: 96 }
  })
  const [collapsed, setCollapsed] = useState(() => readCollapsed())
  const dragRef = useRef<{ dx: number; dy: number; active: boolean } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const curveCanvasRef = useRef<HTMLCanvasElement>(null)

  const clampPos = useCallback((x: number, y: number) => {
    const pad = 8
    const el = rootRef.current
    const w = el?.offsetWidth ?? 200
    const h = el?.offsetHeight ?? 280
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

  const chromeBtn = {
    border: '1px solid #334155',
    background: '#1e293b',
    color: '#cbd5e1',
    borderRadius: 6,
    padding: '2px 7px',
    cursor: 'pointer',
    fontSize: 11,
    lineHeight: 1
  } as const

  if (collapsed) {
    return (
      <div
        ref={rootRef}
        className="fusion-float-eq fusion-float-eq--collapsed"
        role="dialog"
        aria-label="EQ fusión (minimizado)"
        style={{ left: pos.x, top: pos.y }}
      >
        <div className="fusion-float-eq__chrome" onMouseDown={startDrag}>
          <button
            type="button"
            className="fusion-float-eq__chrome-btn"
            onClick={toggleCollapsed}
            aria-label="Expandir"
            title="Expandir"
          >
            ▾
          </button>
          <span className="fusion-float-eq__title">
            {GLYPH.eq} EQ
          </span>
          {eqActive ? (
            <span className="fusion-float-eq__badge">ACT</span>
          ) : graph.bypass ? (
            <span className="fusion-float-eq__badge" style={{ color: '#64748b' }}>
              BYP
            </span>
          ) : null}
          <button type="button" style={chromeBtn} onClick={onClose} aria-label="Cerrar" title="Cerrar">
            {GLYPH.close}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className="fusion-float-eq"
      role="dialog"
      aria-label="EQ fusión"
      style={{ left: pos.x, top: pos.y }}
    >
      <div className="fusion-float-eq__chrome" onMouseDown={startDrag}>
        <span className="fusion-float-eq__title">
          {GLYPH.eq} EQ
          {eqActive ? <span className="fusion-float-eq__badge">activo</span> : null}
        </span>
        <div className="fusion-float-eq__chrome-actions">
          <button type="button" style={chromeBtn} onClick={toggleCollapsed} title="Minimizar" aria-label="Minimizar">
            −
          </button>
          <button
            type="button"
            style={chromeBtn}
            onClick={onClose}
            title="Cerrar (Esc)"
            aria-label="Cerrar"
          >
            {GLYPH.close}
          </button>
        </div>
      </div>

      <div className="fusion-float-eq__body">
        <p className="fusion-float-eq__hint">
          5 bandas · se <strong>graba</strong> en la mezcla y se escucha al reproducir.
          {fusionRecording ? (
            <span className="fusion-float-eq__hint-rec"> Grabando: cambios en vivo.</span>
          ) : null}
        </p>

        <div className="fusion-float-eq__toolbar">
          <label htmlFor="eq-preset" className="fusion-float-eq__preset-label">
            Preset
          </label>
          <select
            id="eq-preset"
            className="fusion-float-eq__preset-select"
            onChange={(ev) => {
              const p = EQ_PRESETS.find((x) => x.id === ev.target.value)
              if (p) graph.applyPreset(p.gains)
              ev.currentTarget.value = ''
            }}
            defaultValue=""
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
          <label className="fusion-float-eq__bypass">
            <input
              type="checkbox"
              checked={graph.bypass}
              onChange={(ev) => graph.setBypass(ev.target.checked)}
            />
            Bypass
          </label>
        </div>

        <div className="fusion-float-eq__curve-wrap">
          <canvas ref={curveCanvasRef} className="fusion-float-eq__curve" />
        </div>

        <div className="fusion-float-eq__bands">
          {FUSION_EQ_BANDS.map((band, i) => {
            const v = graph.gains[i] ?? 0
            return (
              <div key={band.label} className="fusion-float-eq__band">
                <span className="fusion-float-eq__band-label">{band.label}</span>
                <input
                  type="range"
                  className="fusion-float-eq__slider"
                  min={-12}
                  max={12}
                  step={0.5}
                  value={v}
                  disabled={graph.bypass}
                  onChange={(ev) => graph.setBandGain(i, Number(ev.target.value))}
                  onDoubleClick={() => graph.setBandGain(i, 0)}
                  title="Doble clic = 0 dB"
                />
                <span
                  className={
                    'fusion-float-eq__band-db' + (Math.abs(v) > 0.05 ? ' fusion-float-eq__band-db--active' : '')
                  }
                >
                  {v > 0 ? '+' : ''}
                  {v.toFixed(1)}
                </span>
              </div>
            )
          })}
        </div>

        <button
          type="button"
          className="fusion-float-eq__reset"
          onClick={() => graph.applyPreset([0, 0, 0, 0, 0] as EqGains)}
        >
          Reset (plano)
        </button>
      </div>
    </div>
  )
}
