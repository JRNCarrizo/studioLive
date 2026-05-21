import { getVideoFrameSize } from './videoFrameSize'
import type { SlotRect } from './programScenes'

/** Zoom 1×–4× + centro normalizado del encuadre (0..1; 0.5 = centro). */
export type CamFraming = { zoom: number; offsetX: number; offsetY: number }

export const FRAMING_NEUTRAL: CamFraming = { zoom: 1, offsetX: 0.5, offsetY: 0.5 }

/** Suavizado del encuadre interpolado (~70–100 ms a 60 Hz). */
export const FRAMING_LERP_K = 0.18

export function clampFraming(f: CamFraming): CamFraming {
  return {
    zoom: Math.max(1, Math.min(4, f.zoom)),
    offsetX: Math.max(0, Math.min(1, f.offsetX)),
    offsetY: Math.max(0, Math.min(1, f.offsetY))
  }
}

export function lerpFraming(a: CamFraming, b: CamFraming, k: number): CamFraming {
  const lerp = (x: number, y: number) => x + (y - x) * k
  return {
    zoom: lerp(a.zoom, b.zoom, k),
    offsetX: lerp(a.offsetX, b.offsetX, k),
    offsetY: lerp(a.offsetY, b.offsetY, k)
  }
}

/**
 * Dibuja el vídeo en un slot del canvas con encuadre virtual (zoom + pan).
 * `framing` debe ser el valor ya interpolado (current).
 */
export function drawFramedVideoInRect(
  ctx: CanvasRenderingContext2D,
  v: HTMLVideoElement,
  rect: SlotRect,
  framing: CamFraming,
  alpha = 1
): void {
  if (v.readyState < 1) return
  const vw = v.videoWidth
  const vh = v.videoHeight
  if (!vw || !vh) return

  const fit = Math.min(rect.w / vw, rect.h / vh)
  const dw = vw * fit
  const dh = vh * fit
  const ox = rect.x + (rect.w - dw) / 2
  const oy = rect.y + (rect.h - dh) / 2
  const z = Math.max(1, Math.min(4, framing.zoom))
  const srcW = vw / z
  const srcH = vh / z
  const halfW = srcW / 2
  const halfH = srcH / 2
  const cx = Math.min(vw - halfW, Math.max(halfW, framing.offsetX * vw))
  const cy = Math.min(vh - halfH, Math.max(halfH, framing.offsetY * vh))
  const sx = cx - halfW
  const sy = cy - halfH

  const prevAlpha = ctx.globalAlpha
  try {
    ctx.globalAlpha = alpha * prevAlpha
    ctx.drawImage(v, sx, sy, srcW, srcH, ox, oy, dw, dh)
  } catch {
    /* fotograma aún no decodificado */
  } finally {
    ctx.globalAlpha = prevAlpha
  }
}

/**
 * Convierte coordenadas del puntero sobre el canvas en posición normalizada (0..1) del frame.
 * Devuelve null si el punto cae en las bandas negras (letterbox).
 */
export function pointerToFrameNormalized(params: {
  clientX: number
  clientY: number
  canvas: HTMLCanvasElement
  video: HTMLVideoElement
  framing: CamFraming
  stream?: MediaStream
  frameVw?: number
  frameVh?: number
}): { nx: number; ny: number } | null {
  const { clientX, clientY, canvas, video, framing, stream } = params
  const vw = params.frameVw ?? getVideoFrameSize(video, stream).vw
  const vh = params.frameVh ?? getVideoFrameSize(video, stream).vh
  if (!vw || !vh) return null

  const rect = canvas.getBoundingClientRect()
  const cssX = clientX - rect.left
  const cssY = clientY - rect.top
  const cw = canvas.width
  const ch = canvas.height
  const px = (cssX / rect.width) * cw
  const py = (cssY / rect.height) * ch
  const fit = Math.min(cw / vw, ch / vh)
  const dw = vw * fit
  const dh = vh * fit
  const ox = (cw - dw) / 2
  const oy = (ch - dh) / 2
  if (px < ox || px > ox + dw || py < oy || py > oy + dh) return null

  const z = Math.max(1, Math.min(4, framing.zoom))
  const u = (px - ox) / dw
  const w = (py - oy) / dh
  const srcW01 = 1 / z
  const srcH01 = 1 / z
  const halfW01 = srcW01 / 2
  const halfH01 = srcH01 / 2
  const cxN = Math.min(1 - halfW01, Math.max(halfW01, framing.offsetX))
  const cyN = Math.min(1 - halfH01, Math.max(halfH01, framing.offsetY))
  const sx01 = cxN - halfW01
  const sy01 = cyN - halfH01
  return { nx: sx01 + u * srcW01, ny: sy01 + w * srcH01 }
}

/** Zoom con rueda anclado al cursor (misma lógica que Fusión por archivos). */
export function wheelZoomFraming(params: {
  clientX: number
  clientY: number
  deltaY: number
  canvas: HTMLCanvasElement
  video: HTMLVideoElement
  cur: CamFraming
}): CamFraming {
  const { clientX, clientY, deltaY, canvas, video, cur } = params
  const factor = Math.exp(-deltaY * 0.00075)
  const maxStep = 1.055
  const clamped = Math.max(1 / maxStep, Math.min(maxStep, factor))
  const newZoom = Math.max(1, Math.min(4, cur.zoom * clamped))
  if (newZoom === cur.zoom) return cur

  const ptr = pointerToFrameNormalized({
    clientX,
    clientY,
    canvas,
    video,
    framing: cur
  })
  if (!ptr) return clampFraming({ ...cur, zoom: newZoom })

  const vw = video.videoWidth
  const vh = video.videoHeight
  const cw = canvas.width
  const ch = canvas.height
  const rect = canvas.getBoundingClientRect()
  const cssX = clientX - rect.left
  const cssY = clientY - rect.top
  const px = (cssX / rect.width) * cw
  const py = (cssY / rect.height) * ch
  const fit = Math.min(cw / vw, ch / vh)
  const dw = vw * fit
  const dh = vh * fit
  const ox = (cw - dw) / 2
  const oy = (ch - dh) / 2
  const u = Math.min(1, Math.max(0, (px - ox) / dw))
  const w = Math.min(1, Math.max(0, (py - oy) / dh))
  const newOffsetX = ptr.nx - u / newZoom + 0.5 / newZoom
  const newOffsetY = ptr.ny - w / newZoom + 0.5 / newZoom
  return clampFraming({ zoom: newZoom, offsetX: newOffsetX, offsetY: newOffsetY })
}

/** Desplazamiento por arrastre en píxeles CSS del puntero. */
export function panFramingByCssDelta(params: {
  dx: number
  dy: number
  canvas: HTMLCanvasElement
  video: HTMLVideoElement
  cur: CamFraming
  stream?: MediaStream
}): CamFraming {
  const { dx, dy, canvas, video, cur, stream } = params
  const { vw, vh } = getVideoFrameSize(video, stream)
  if (!vw || !vh) return cur
  const rect = canvas.getBoundingClientRect()
  const cw = canvas.width
  const ch = canvas.height
  const fit = Math.min(cw / vw, ch / vh)
  const dw = vw * fit
  const dh = vh * fit
  const cssDxRatio = dx / (rect.width * (dw / cw))
  const cssDyRatio = dy / (rect.height * (dh / ch))
  const z = Math.max(1, Math.min(4, cur.zoom))
  return clampFraming({
    ...cur,
    offsetX: cur.offsetX + cssDxRatio / z,
    offsetY: cur.offsetY + cssDyRatio / z
  })
}
