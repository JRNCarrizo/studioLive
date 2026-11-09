import { useEffect, useRef } from 'react'
import { drawSegmentMeter } from './ledMeter'

/** VU aproximado (RMS) sobre el stream tal cual llega. */
export function AudioLevelMeter({ stream }: { stream: MediaStream }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const decayRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !stream.getAudioTracks().length) return

    decayRef.current = 0

    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return

    const audioCtx = new AC()
    const src = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.55
    src.connect(analyser)

    const buf = new Uint8Array(analyser.fftSize)
    let raf = 0

    const draw = () => {
      void audioCtx.resume()
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) {
        const x = (buf[i]! - 128) / 128
        sum += x * x
      }
      const rms = Math.sqrt(sum / buf.length)
      const instant = Math.min(1, rms * 4.2)
      decayRef.current = Math.max(instant, decayRef.current * 0.94)

      const ctx = canvas.getContext('2d')
      const dpr = window.devicePixelRatio || 1
      const cssW = canvas.clientWidth || 320
      const cssH = 18
      canvas.width = Math.floor(cssW * dpr)
      canvas.height = Math.floor(cssH * dpr)
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        drawSegmentMeter(ctx, cssW, cssH, decayRef.current, decayRef.current)
      }

      raf = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      cancelAnimationFrame(raf)
      src.disconnect()
      analyser.disconnect()
      void audioCtx.close()
    }
  }, [stream])

  return (
    <canvas ref={canvasRef} className="vu-meter" style={{ maxWidth: 420 }} />
  )
}
