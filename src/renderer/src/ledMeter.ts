/** Dibuja un vúmetro de segmentos, como en un canal de consola. */
export function drawSegmentMeter(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  level: number,
  peak = level
): void {
  const segments = Math.max(16, Math.floor(width / 8))
  const gap = 2
  const segW = (width - gap * (segments - 1)) / segments
  const lit = Math.round(Math.max(0, Math.min(1, level)) * segments)
  const peakIndex = Math.round(Math.max(0, Math.min(1, peak)) * segments) - 1

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#070605'
  ctx.fillRect(0, 0, width, height)

  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1)
    const color = t < 0.62 ? '#3dff7a' : t < 0.84 ? '#ffe14a' : '#ff3b30'
    const on = i < lit
    const isPeak = i === peakIndex
    ctx.shadowBlur = on || isPeak ? 8 : 0
    ctx.shadowColor = color
    ctx.fillStyle = on || isPeak ? color : '#1a1612'
    const x = i * (segW + gap)
    ctx.fillRect(x, 1, segW, height - 2)
  }
  ctx.shadowBlur = 0
}
