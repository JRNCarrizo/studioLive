import { useEffect, useRef } from 'react'

type Props = {
  analyser: AnalyserNode
  height?: number
  /** Si true, dibuja marca de “cerca de clip” digital post-ganancia. */
  showClipZone?: boolean
  onClipChange?: (clipping: boolean) => void
}

function useLatestRef<T>(v: T | undefined) {
  const r = useRef(v)
  r.current = v
  return r
}

/**
 * Medidor post-ganancia: RMS suavizado + pico instantáneo (para ver saturación antes del codificador).
 */
export function AnalyserPeakMeter({ analyser, height = 14, showClipZone = true, onClipChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const decayRef = useRef(0)
  const peakHoldRef = useRef(0)
  const peakHoldTRef = useRef(0)
  const clipCbRef = useLatestRef(onClipChange)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const floatBuf = new Float32Array(analyser.fftSize)
    let raf = 0
    let lastClip = false

    const draw = () => {
      analyser.getFloatTimeDomainData(floatBuf)
      let sum = 0
      let pk = 0
      for (let i = 0; i < floatBuf.length; i++) {
        const v = floatBuf[i]!
        const a = Math.abs(v)
        if (a > pk) pk = a
        sum += v * v
      }
      const rms = Math.sqrt(sum / floatBuf.length)
      const instant = Math.min(1, rms * 3.8)
      decayRef.current = Math.max(instant, decayRef.current * 0.92)

      const now = performance.now()
      if (pk >= peakHoldRef.current) {
        peakHoldRef.current = pk
        peakHoldTRef.current = now
      } else if (now - peakHoldTRef.current > 900) {
        peakHoldRef.current *= 0.9
        peakHoldTRef.current = now
      }

      const clipping = pk >= 0.98
      if (clipping !== lastClip) {
        lastClip = clipping
        clipCbRef.current?.(clipping)
      }

      const ctx = canvas.getContext('2d')
      const dpr = window.devicePixelRatio || 1
      const cssW = canvas.clientWidth || 280
      const cssH = height
      canvas.width = Math.floor(cssW * dpr)
      canvas.height = Math.floor(cssH * dpr)
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.fillStyle = '#1e293b'
        ctx.fillRect(0, 0, cssW, cssH)
        if (showClipZone) {
          const clipX0 = cssW * 0.92
          ctx.fillStyle = 'rgba(127, 29, 29, 0.35)'
          ctx.fillRect(clipX0, 0, cssW - clipX0, cssH)
        }
        const wFill = cssW * decayRef.current
        const grd = ctx.createLinearGradient(0, 0, cssW, 0)
        grd.addColorStop(0, '#22c55e')
        grd.addColorStop(0.68, '#eab308')
        grd.addColorStop(0.9, '#f97316')
        grd.addColorStop(1, '#ef4444')
        ctx.fillStyle = grd
        ctx.fillRect(0, 0, wFill, cssH)
        const wPeak = cssW * Math.min(1, peakHoldRef.current)
        ctx.fillStyle = clipping ? '#fecaca' : '#e2e8f0'
        ctx.fillRect(Math.max(0, wPeak - 2), 0, 2, cssH)
      }

      raf = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      cancelAnimationFrame(raf)
      clipCbRef.current?.(false)
    }
  }, [analyser, height, showClipZone])

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height,
        display: 'block',
        borderRadius: 6,
        border: '1px solid #334155'
      }}
    />
  )
}
