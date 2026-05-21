import type { CamFraming } from './programFraming'
import { clampFraming } from './programFraming'
import {
  clampNormalizedSlotRect,
  type NormalizedSlotRect,
  type SlotRect,
  type VideoRectAlign,
  VIDEO_ALIGN_CENTER
} from './programScenes'
import { getVideoFrameSize } from './videoFrameSize'
import {
  displaySizeForVideo,
  isSidewaysRotation,
  normalizeRotateDeg
} from './videoRotation'

/** Recorte del frame fuente (0..1). Fuera del rectángulo no entra al programa. */
export type CamCrop = { left: number; top: number; right: number; bottom: number }

export const CROP_FULL: CamCrop = { left: 0, top: 0, right: 1, bottom: 1 }

/** Mínimo ~8 % del ancho/alto del frame para que el recorte siga siendo usable. */
export const CROP_MIN_SPAN = 0.08

/** Rueda / trackpad: menor k = zoom más lento (exp(-deltaY * k)). */
export const PROGRAM_WHEEL_ZOOM_K = 0.00075

/** Tope por evento wheel (~5,5 % por tick) para evitar saltos en trackpads sensibles. */
export const PROGRAM_WHEEL_ZOOM_MAX_STEP = 1.055

/** Pellizco dos dedos: fracción del cambio de escala aplicada por frame. */
export const PROGRAM_PINCH_ZOOM_DAMP = 0.38

export function wheelDeltaToZoomFactor(deltaY: number, deltaMode = 0): number {
  let dy = deltaY
  if (deltaMode === 1) dy *= 18
  else if (deltaMode === 2) dy *= 320
  let factor = Math.exp(-dy * PROGRAM_WHEEL_ZOOM_K)
  const max = PROGRAM_WHEEL_ZOOM_MAX_STEP
  const min = 1 / max
  return Math.max(min, Math.min(max, factor))
}

export function dampPinchScaleFactor(scaleFactor: number): number {
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) return 1
  const d = PROGRAM_PINCH_ZOOM_DAMP
  const damped = 1 + (scaleFactor - 1) * d
  const max = 1 + (PROGRAM_WHEEL_ZOOM_MAX_STEP - 1) * 2.5
  const min = 1 / max
  return Math.max(min, Math.min(max, damped))
}

export function clampCrop(c: CamCrop): CamCrop {
  let { left, top, right, bottom } = c
  left = Math.max(0, Math.min(1, left))
  top = Math.max(0, Math.min(1, top))
  right = Math.max(0, Math.min(1, right))
  bottom = Math.max(0, Math.min(1, bottom))
  if (right - left < CROP_MIN_SPAN) {
    const mid = (left + right) / 2
    left = Math.max(0, mid - CROP_MIN_SPAN / 2)
    right = Math.min(1, left + CROP_MIN_SPAN)
    left = Math.max(0, right - CROP_MIN_SPAN)
  }
  if (bottom - top < CROP_MIN_SPAN) {
    const mid = (top + bottom) / 2
    top = Math.max(0, mid - CROP_MIN_SPAN / 2)
    bottom = Math.min(1, top + CROP_MIN_SPAN)
    top = Math.max(0, bottom - CROP_MIN_SPAN)
  }
  return { left, top, right, bottom }
}

export function cropIsFull(c: CamCrop): boolean {
  const x = clampCrop(c)
  return (
    x.left <= 1e-4 &&
    x.top <= 1e-4 &&
    x.right >= 1 - 1e-4 &&
    x.bottom >= 1 - 1e-4
  )
}

/**
 * Recorte del vídeo al arrastrar el centro de un lado del marco del slot (layout 2×).
 * El recuadro en pantalla no se achica: se recorta qué parte del frame entra.
 */
export function cropFromSlotEdgeDrag(
  start: CamCrop,
  ceiling: CamCrop,
  handle: 'n' | 's' | 'e' | 'w',
  duCanvas: number,
  dvCanvas: number,
  slotNorm: Pick<NormalizedSlotRect, 'w' | 'h'>,
  rotateDeg: number
): CamCrop {
  const ceil = clampCrop(ceiling)
  const du = duCanvas / Math.max(1e-6, slotNorm.w)
  const dv = dvCanvas / Math.max(1e-6, slotNorm.h)
  const d = cropToDisplayRect(start, rotateDeg)
  const cd = cropToDisplayRect(ceil, rotateDeg)
  let { left, top, right, bottom } = d

  switch (handle) {
    case 'e':
      right = d.right + du
      break
    case 'w':
      left = d.left + du
      break
    case 's':
      bottom = d.bottom + dv
      break
    case 'n':
      top = d.top + dv
      break
  }

  const minSpan = CROP_MIN_SPAN
  right = Math.min(cd.right, Math.max(right, left + minSpan))
  left = Math.max(cd.left, Math.min(left, right - minSpan))
  bottom = Math.min(cd.bottom, Math.max(bottom, top + minSpan))
  top = Math.max(cd.top, Math.min(top, bottom - minSpan))

  return clampCrop(displayRectToCrop({ left, top, right, bottom }, rotateDeg))
}

export type VideoLetterbox = { x: number; y: number; w: number; h: number }

/** UV en pantalla (0..1) → coords normalizadas del frame fuente (sin rotar). */
export function displayUvToSourceNormalized(
  u: number,
  v: number,
  rotateDeg: number
): { nx: number; ny: number } {
  const deg = normalizeRotateDeg(rotateDeg)
  if (deg === 90) return { nx: v, ny: 1 - u }
  if (deg === 180) return { nx: 1 - u, ny: 1 - v }
  if (deg === 270) return { nx: 1 - v, ny: u }
  return { nx: u, ny: v }
}

/** Frame fuente (0..1) → UV sobre el vídeo ya rotado en pantalla. */
export function sourceNormalizedToDisplayUv(
  nx: number,
  ny: number,
  rotateDeg: number
): { u: number; v: number } {
  const deg = normalizeRotateDeg(rotateDeg)
  if (deg === 90) return { u: 1 - ny, v: nx }
  if (deg === 180) return { u: 1 - nx, v: 1 - ny }
  if (deg === 270) return { u: ny, v: 1 - nx }
  return { u: nx, v: ny }
}

/** Rectángulo de recorte en coords de overlay (0..1 dentro del letterbox). */
export function cropToDisplayRect(
  crop: CamCrop,
  rotateDeg: number
): { left: number; top: number; right: number; bottom: number } {
  const c = clampCrop(crop)
  const pts = [
    sourceNormalizedToDisplayUv(c.left, c.top, rotateDeg),
    sourceNormalizedToDisplayUv(c.right, c.top, rotateDeg),
    sourceNormalizedToDisplayUv(c.right, c.bottom, rotateDeg),
    sourceNormalizedToDisplayUv(c.left, c.bottom, rotateDeg)
  ]
  let left = 1
  let top = 1
  let right = 0
  let bottom = 0
  for (const p of pts) {
    left = Math.min(left, p.u)
    top = Math.min(top, p.v)
    right = Math.max(right, p.u)
    bottom = Math.max(bottom, p.v)
  }
  return { left, top, right, bottom }
}

/** Rectángulo en UV del letterbox (0..1) → recorte en coords del frame fuente. */
export function displayRectToCrop(
  disp: { left: number; top: number; right: number; bottom: number },
  rotateDeg: number
): CamCrop {
  const pts = [
    displayUvToSourceNormalized(disp.left, disp.top, rotateDeg),
    displayUvToSourceNormalized(disp.right, disp.top, rotateDeg),
    displayUvToSourceNormalized(disp.right, disp.bottom, rotateDeg),
    displayUvToSourceNormalized(disp.left, disp.bottom, rotateDeg)
  ]
  let left = 1
  let top = 1
  let right = 0
  let bottom = 0
  for (const p of pts) {
    left = Math.min(left, p.nx)
    top = Math.min(top, p.ny)
    right = Math.max(right, p.nx)
    bottom = Math.max(bottom, p.ny)
  }
  return clampCrop({ left, top, right, bottom })
}

/** UV 0..1 dentro del vídeo visible en pantalla (letterbox del canvas). */
export function clientToDisplayUv(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  rotateDeg = 0,
  stream?: MediaStream
): { u: number; v: number } | null {
  const lb = getVideoLetterboxForElement(canvas, video, rotateDeg, stream)
  if (!lb) return null
  const br = canvas.getBoundingClientRect()
  const px = ((clientX - br.left) / br.width) * canvas.width
  const py = ((clientY - br.top) / br.height) * canvas.height
  if (px < lb.x || px > lb.x + lb.w || py < lb.y || py > lb.y + lb.h) return null
  return { u: (px - lb.x) / lb.w, v: (py - lb.y) / lb.h }
}

/** Mueve el recorte en pantalla (dos dedos en trackpad = scroll sin Ctrl). */
export function panCropInDisplayUv(
  crop: CamCrop,
  rotateDeg: number,
  deltaU: number,
  deltaV: number
): CamCrop {
  const d = cropToDisplayRect(crop, rotateDeg)
  const w = d.right - d.left
  const h = d.bottom - d.top
  let left = d.left + deltaU
  let top = d.top + deltaV
  left = Math.max(0, Math.min(1 - w, left))
  top = Math.max(0, Math.min(1 - h, top))
  return displayRectToCrop({ left, top, right: left + w, bottom: top + h }, rotateDeg)
}

/** Escala el marco en pantalla (pellizco en trackpad = rueda + Ctrl). scale > 1 agranda el recorte. */
export function scaleCropInDisplayUv(
  crop: CamCrop,
  rotateDeg: number,
  scale: number,
  anchorU?: number,
  anchorV?: number
): CamCrop {
  const d = cropToDisplayRect(crop, rotateDeg)
  const w = Math.max(CROP_MIN_SPAN, d.right - d.left)
  const h = Math.max(CROP_MIN_SPAN, d.bottom - d.top)
  const cx = anchorU ?? (d.left + d.right) / 2
  const cy = anchorV ?? (d.top + d.bottom) / 2
  let nw = Math.min(1, w * scale)
  let nh = Math.min(1, h * scale)
  nw = Math.max(CROP_MIN_SPAN, nw)
  nh = Math.max(CROP_MIN_SPAN, nh)
  let left = cx - nw / 2
  let top = cy - nh / 2
  if (left < 0) left = 0
  if (top < 0) top = 0
  if (left + nw > 1) left = 1 - nw
  if (top + nh > 1) top = 1 - nh
  return displayRectToCrop({ left, top, right: left + nw, bottom: top + nh }, rotateDeg)
}

type CropWheelGestureParams = {
  crop: CamCrop
  rotateDeg: number
  clientX: number
  clientY: number
  deltaX: number
  deltaY: number
  ctrlKey: boolean
  metaKey?: boolean
  lbWidth: number
  lbHeight: number
  canvas: HTMLCanvasElement
  video: HTMLVideoElement
  stream?: MediaStream
}

/** Trackpad en editor de recorte: pellizco + pan simultáneo; sesión mantiene pan sin soltar. */
export function applyCropWheelGesture(params: CropWheelGestureParams): CamCrop {
  const {
    crop,
    rotateDeg,
    clientX,
    clientY,
    deltaX,
    deltaY,
    ctrlKey,
    metaKey,
    lbWidth,
    lbHeight,
    canvas,
    video,
    stream
  } = params
  const pinch = ctrlKey || metaKey
  let next = crop

  if (pinch && Math.abs(deltaY) > 1e-6) {
    const anchor = clientToDisplayUv(clientX, clientY, canvas, video, rotateDeg, stream)
    const factor = Math.exp(-deltaY * 0.004)
    next = scaleCropInDisplayUv(next, rotateDeg, factor, anchor?.u, anchor?.v)
  }

  if (pinch) {
    if (Math.abs(deltaX) > 1e-6 && lbWidth > 0) {
      next = panCropInDisplayUv(next, rotateDeg, deltaX / lbWidth, 0)
    }
  } else if (lbWidth > 0 && lbHeight > 0) {
    const deltaU = deltaX / lbWidth
    const deltaV = deltaY / lbHeight
    if (Math.abs(deltaU) > 1e-6 || Math.abs(deltaV) > 1e-6) {
      next = panCropInDisplayUv(next, rotateDeg, deltaU, deltaV)
    }
  }

  return next
}

/** Un paso de pellizco + pan con dos dedos sobre el marco de recorte. */
export function applyCropPinchPanStep(params: {
  crop: CamCrop
  rotateDeg: number
  clientX: number
  clientY: number
  scaleFactor: number
  panDxCss: number
  panDyCss: number
  lbWidth: number
  lbHeight: number
  canvas: HTMLCanvasElement
  video: HTMLVideoElement
  stream?: MediaStream
}): CamCrop {
  const {
    crop,
    rotateDeg,
    clientX,
    clientY,
    scaleFactor,
    panDxCss,
    panDyCss,
    lbWidth,
    lbHeight,
    canvas,
    video,
    stream
  } = params
  let next = crop

  if (Math.abs(scaleFactor - 1) > 1e-5) {
    const anchor = clientToDisplayUv(clientX, clientY, canvas, video, rotateDeg, stream)
    next = scaleCropInDisplayUv(next, rotateDeg, scaleFactor, anchor?.u, anchor?.v)
  }

  if (lbWidth > 0 && lbHeight > 0 && (Math.abs(panDxCss) > 1e-6 || Math.abs(panDyCss) > 1e-6)) {
    next = panCropInDisplayUv(next, rotateDeg, panDxCss / lbWidth, panDyCss / lbHeight)
  }

  return next
}

/** Letterbox del vídeo visible (con rotación manual) dentro del canvas (coords internas). */
export function getVideoLetterboxInCanvas(
  canvas: HTMLCanvasElement,
  frameVw: number,
  frameVh: number,
  rotateDeg = 0
): VideoLetterbox | null {
  if (!frameVw || !frameVh) return null
  const { w: dispW, h: dispH } = displaySizeForVideo(frameVw, frameVh, rotateDeg)
  const cw = canvas.width
  const ch = canvas.height
  const fit = Math.min(cw / dispW, ch / dispH)
  const dw = dispW * fit
  const dh = dispH * fit
  return { x: (cw - dw) / 2, y: (ch - dh) / 2, w: dw, h: dh }
}

export function getVideoLetterboxForElement(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  rotateDeg = 0,
  stream?: MediaStream
): VideoLetterbox | null {
  const { vw, vh } = getVideoFrameSize(video, stream)
  return getVideoLetterboxInCanvas(canvas, vw, vh, rotateDeg)
}

/** Posición 0..1 sobre el frame fuente (null = bandas negras). */
export function clientToFullVideoNormalized(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  rotateDeg = 0,
  stream?: MediaStream
): { nx: number; ny: number } | null {
  const lb = getVideoLetterboxForElement(canvas, video, rotateDeg, stream)
  if (!lb) return null
  const br = canvas.getBoundingClientRect()
  const px = ((clientX - br.left) / br.width) * canvas.width
  const py = ((clientY - br.top) / br.height) * canvas.height
  if (px < lb.x || px > lb.x + lb.w || py < lb.y || py > lb.y + lb.h) return null
  const u = (px - lb.x) / lb.w
  const v = (py - lb.y) / lb.h
  return displayUvToSourceNormalized(u, v, rotateDeg)
}

/** Posición 0..1 dentro del área recortada (para zoom/pan). */
export function clientToCropNormalized(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  crop: CamCrop,
  framing: CamFraming,
  rotateDeg = 0,
  stream?: MediaStream
): { nx: number; ny: number } | null {
  const full = clientToFullVideoNormalized(clientX, clientY, canvas, video, rotateDeg, stream)
  if (!full) return null
  const c = clampCrop(crop)
  const spanW = c.right - c.left
  const spanH = c.bottom - c.top
  if (spanW < 1e-6 || spanH < 1e-6) return null

  const z = Math.max(1, Math.min(4, framing.zoom))
  const srcW01 = 1 / z
  const srcH01 = 1 / z
  const halfW01 = srcW01 / 2
  const halfH01 = srcH01 / 2
  const cxN = Math.min(1 - halfW01, Math.max(halfW01, framing.offsetX))
  const cyN = Math.min(1 - halfH01, Math.max(halfH01, framing.offsetY))
  const sx01 = cxN - halfW01
  const sy01 = cyN - halfH01

  const u = (full.nx - c.left) / spanW
  const w = (full.ny - c.top) / spanH
  return { nx: sx01 + u * srcW01, ny: sy01 + w * srcH01 }
}

/**
 * Dibuja recorte + zoom/pan: primero define qué zona del frame entra; el zoom mueve dentro de esa zona.
 */
export type VideoRectFit = 'contain' | 'cover'

function videoRectOrigin(
  rect: SlotRect,
  dw: number,
  dh: number,
  align: VideoRectAlign
): { ox: number; oy: number } {
  const ox =
    align.x === 'left'
      ? rect.x
      : align.x === 'right'
        ? rect.x + rect.w - dw
        : rect.x + (rect.w - dw) / 2
  const oy =
    align.y === 'top'
      ? rect.y
      : align.y === 'bottom'
        ? rect.y + rect.h - dh
        : rect.y + (rect.h - dh) / 2
  return { ox, oy }
}

export function drawCroppedFramedVideoInRect(
  ctx: CanvasRenderingContext2D,
  v: HTMLVideoElement,
  rect: SlotRect,
  crop: CamCrop,
  framing: CamFraming,
  rotateDeg = 0,
  alpha = 1,
  fit: VideoRectFit = 'contain',
  align: VideoRectAlign = VIDEO_ALIGN_CENTER,
  /** En layout 2×: escala cover según el techo (tamaño máximo), recorte visual por el clip del rect actual. */
  coverScaleRect?: SlotRect | null,
  frameVw?: number,
  frameVh?: number
): void {
  if (v.readyState < 1) return
  const vw = frameVw ?? v.videoWidth
  const vh = frameVh ?? v.videoHeight
  if (!vw || !vh) return

  const c = clampCrop(crop)
  const cLeft = c.left * vw
  const cTop = c.top * vh
  const cW = (c.right - c.left) * vw
  const cH = (c.bottom - c.top) * vh
  if (cW < 1 || cH < 1) return

  const deg = normalizeRotateDeg(rotateDeg)
  const sideways = isSidewaysRotation(deg)
  const effW = sideways ? cH : cW
  const effH = sideways ? cW : cH

  const scaleRect = fit === 'cover' && coverScaleRect ? coverScaleRect : rect
  const scale =
    fit === 'cover'
      ? Math.max(scaleRect.w / effW, scaleRect.h / effH)
      : Math.min(rect.w / effW, rect.h / effH)
  const dw = effW * scale
  const dh = effH * scale
  const layoutCover = fit === 'cover' && coverScaleRect != null
  const { ox, oy } = layoutCover
    ? videoRectOrigin(coverScaleRect, dw, dh, align)
    : videoRectOrigin(rect, dw, dh, fit === 'cover' ? align : VIDEO_ALIGN_CENTER)

  const z = Math.max(1, Math.min(4, framing.zoom))
  const srcW = cW / z
  const srcH = cH / z
  const halfW = srcW / 2
  const halfH = srcH / 2
  const cx = Math.min(cLeft + cW - halfW, Math.max(cLeft + halfW, cLeft + framing.offsetX * cW))
  const cy = Math.min(cTop + cH - halfH, Math.max(cTop + halfH, cTop + framing.offsetY * cH))
  const sx = cx - halfW
  const sy = cy - halfH

  const prevAlpha = ctx.globalAlpha
  try {
    ctx.globalAlpha = alpha * prevAlpha
    if (deg === 0) {
      ctx.drawImage(v, sx, sy, srcW, srcH, ox, oy, dw, dh)
    } else {
      ctx.save()
      ctx.translate(ox + dw / 2, oy + dh / 2)
      ctx.rotate((deg * Math.PI) / 180)
      if (sideways) {
        ctx.drawImage(v, sx, sy, srcW, srcH, -dh / 2, -dw / 2, dh, dw)
      } else {
        ctx.drawImage(v, sx, sy, srcW, srcH, -dw / 2, -dh / 2, dw, dh)
      }
      ctx.restore()
    }
  } catch {
    /* fotograma aún no decodificado */
  } finally {
    ctx.globalAlpha = prevAlpha
  }
}

export function scaleZoomFramingWithCrop(params: {
  clientX: number
  clientY: number
  factor: number
  canvas: HTMLCanvasElement
  video: HTMLVideoElement
  crop: CamCrop
  cur: CamFraming
  rotateDeg?: number
  stream?: MediaStream
}): CamFraming {
  const { clientX, clientY, factor, canvas, video, crop, cur, rotateDeg = 0, stream } = params
  const { vw, vh } = getVideoFrameSize(video, stream)
  const newZoom = Math.max(1, Math.min(4, cur.zoom * factor))
  if (Math.abs(newZoom - cur.zoom) < 1e-6) return cur

  const ptr = clientToCropNormalized(clientX, clientY, canvas, video, crop, cur, rotateDeg, stream)
  if (!ptr) return clampFraming({ ...cur, zoom: newZoom })

  const c = clampCrop(crop)
  const spanW = c.right - c.left
  const spanH = c.bottom - c.top
  const lb = getVideoLetterboxInCanvas(canvas, vw, vh, rotateDeg)
  if (!lb) return clampFraming({ ...cur, zoom: newZoom })
  const br = canvas.getBoundingClientRect()
  const px = ((clientX - br.left) / br.width) * canvas.width
  const py = ((clientY - br.top) / br.height) * canvas.height
  const dispU = (px - lb.x) / lb.w
  const dispV = (py - lb.y) / lb.h
  const src = displayUvToSourceNormalized(dispU, dispV, rotateDeg)
  const u = (src.nx - c.left) / spanW
  const w = (src.ny - c.top) / spanH
  const newOffsetX = ptr.nx - u / newZoom + 0.5 / newZoom
  const newOffsetY = ptr.ny - w / newZoom + 0.5 / newZoom
  return clampFraming({ zoom: newZoom, offsetX: newOffsetX, offsetY: newOffsetY })
}

export function wheelZoomFramingWithCrop(params: {
  clientX: number
  clientY: number
  deltaY: number
  deltaMode?: number
  canvas: HTMLCanvasElement
  video: HTMLVideoElement
  crop: CamCrop
  cur: CamFraming
  rotateDeg?: number
  stream?: MediaStream
}): CamFraming {
  const { clientX, clientY, deltaY, deltaMode = 0, canvas, video, crop, cur, rotateDeg = 0, stream } = params
  const factor = wheelDeltaToZoomFactor(deltaY, deltaMode)
  return scaleZoomFramingWithCrop({
    clientX,
    clientY,
    factor,
    canvas,
    video,
    crop,
    cur,
    rotateDeg,
    stream
  })
}

type FramingGestureBase = {
  canvas: HTMLCanvasElement
  video: HTMLVideoElement
  crop: CamCrop
  cur: CamFraming
  rotateDeg?: number
  stream?: MediaStream
}

/** Un paso de pellizco + pan (dos dedos): zoom al centro y desplazamiento en el mismo movimiento. */
export function applyProgramPinchPanStepWithCrop(
  params: FramingGestureBase & {
    clientX: number
    clientY: number
    scaleFactor: number
    panDx: number
    panDy: number
  }
): CamFraming {
  const { clientX, clientY, scaleFactor, panDx, panDy, canvas, video, crop, cur, rotateDeg, stream } =
    params
  let next = cur
  if (Math.abs(scaleFactor - 1) > 1e-5) {
    next = scaleZoomFramingWithCrop({
      clientX,
      clientY,
      factor: scaleFactor,
      canvas,
      video,
      crop,
      cur: next,
      rotateDeg,
      stream
    })
  }
  if (Math.abs(panDx) > 1e-6 || Math.abs(panDy) > 1e-6) {
    next = panFramingByCssDeltaWithCrop({
      dx: panDx,
      dy: panDy,
      canvas,
      video,
      crop,
      cur: next,
      rotateDeg,
      stream
    })
  }
  return next
}

/**
 * Trackpad: pellizco (Ctrl/meta) = zoom; pan horizontal en el mismo evento;
 * durante la sesión de pellizco también acepta scroll sin Ctrl (pan completo).
 */
export function applyProgramWheelWithCrop(
  params: FramingGestureBase & {
    clientX: number
    clientY: number
    deltaX: number
    deltaY: number
    deltaMode?: number
    ctrlKey: boolean
    metaKey?: boolean
    pinchSessionActive: boolean
  }
): CamFraming {
  const {
    clientX,
    clientY,
    deltaX,
    deltaY,
    deltaMode = 0,
    ctrlKey,
    metaKey,
    pinchSessionActive,
    canvas,
    video,
    crop,
    cur,
    rotateDeg,
    stream
  } = params
  const pinch = ctrlKey || metaKey
  let next = cur

  if (pinch && Math.abs(deltaY) > 1e-6) {
    next = wheelZoomFramingWithCrop({
      clientX,
      clientY,
      deltaY,
      deltaMode,
      canvas,
      video,
      crop,
      cur: next,
      rotateDeg,
      stream
    })
  }

  if (pinch) {
    if (Math.abs(deltaX) > 1e-6) {
      next = panFramingByCssDeltaWithCrop({
        dx: deltaX,
        dy: 0,
        canvas,
        video,
        crop,
        cur: next,
        rotateDeg,
        stream
      })
    }
  } else if (pinchSessionActive) {
    if (Math.abs(deltaX) > 1e-6 || Math.abs(deltaY) > 1e-6) {
      next = panFramingByCssDeltaWithCrop({
        dx: deltaX,
        dy: deltaY,
        canvas,
        video,
        crop,
        cur: next,
        rotateDeg,
        stream
      })
    }
  } else if (Math.abs(deltaX) > 1e-6 || Math.abs(deltaY) > 1e-6) {
    next = panFramingByCssDeltaWithCrop({
      dx: deltaX,
      dy: deltaY,
      canvas,
      video,
      crop,
      cur: next,
      rotateDeg,
      stream
    })
  }

  return next
}

export function panFramingByCssDeltaWithCrop(params: {
  dx: number
  dy: number
  canvas: HTMLCanvasElement
  video: HTMLVideoElement
  crop: CamCrop
  cur: CamFraming
  rotateDeg?: number
  stream?: MediaStream
}): CamFraming {
  const { dx, dy, canvas, video, crop, cur, rotateDeg = 0, stream } = params
  const { vw, vh } = getVideoFrameSize(video, stream)
  if (!vw || !vh) return cur
  const c = clampCrop(crop)
  const cW = (c.right - c.left) * vw
  const cH = (c.bottom - c.top) * vh
  const { w: effW, h: effH } = displaySizeForVideo(cW, cH, rotateDeg)
  const rect = canvas.getBoundingClientRect()
  const cw = canvas.width
  const ch = canvas.height
  const fit = Math.min(cw / effW, ch / effH)
  const dw = effW * fit
  const dh = effH * fit
  const cssDxRatio = dx / (rect.width * (dw / cw))
  const cssDyRatio = dy / (rect.height * (dh / ch))
  const z = Math.max(1, Math.min(4, cur.zoom))
  return clampFraming({
    ...cur,
    offsetX: cur.offsetX + cssDxRatio / z,
    offsetY: cur.offsetY + cssDyRatio / z
  })
}
