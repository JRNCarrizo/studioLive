import { useEffect, useRef } from 'react'

const BARS = 24

/** Analizador de bandas, al estilo de un RTA de rack. */
export function SpectrumMeter({ analyser }: { analyser: AnalyserNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const bins = new Uint8Array(analyser.frequencyBinCount)
    let raf = 0

    const draw = () => {
      analyser.getByteFrequencyData(bins)
      const ctx = canvas.getContext('2d')
      const dpr = window.devicePixelRatio || 1
      const cssW = canvas.clientWidth || 300
      const cssH = 72
      canvas.width = Math.floor(cssW * dpr)
      canvas.height = Math.floor(cssH * dpr)
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.fillStyle = '#070605'
        ctx.fillRect(0, 0, cssW, cssH)
        const group = Math.max(1, Math.floor(bins.length / BARS))
        const gap = 2
        const barW = (cssW - gap * (BARS - 1)) / BARS
        for (let i = 0; i < BARS; i++) {
          let sum = 0
          const start = i * group
          for (let j = 0; j < group; j++) sum += bins[start + j] ?? 0
          const mag = sum / group / 255
          const h = Math.max(2, mag * cssH)
          const t = i / (BARS - 1)
          ctx.fillStyle = t < 0.55 ? '#3dff7a' : t < 0.8 ? '#ffe14a' : '#ff5a4a'
          ctx.shadowBlur = mag > 0.08 ? 8 : 0
          ctx.shadowColor = ctx.fillStyle
          ctx.fillRect(i * (barW + gap), cssH - h, barW, h)
        }
        ctx.shadowBlur = 0
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [analyser])

  return <canvas ref={canvasRef} className="spectrum-meter" aria-hidden />
}
