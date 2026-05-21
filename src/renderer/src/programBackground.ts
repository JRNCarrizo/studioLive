import { CROP_FULL, drawCroppedFramedVideoInRect } from './programCrop'
import { FRAMING_NEUTRAL } from './programFraming'
import type { SlotRect } from './programScenes'
import { getVideoFrameSize } from './videoFrameSize'

export type ProgramBackgroundMode = 'color' | 'image' | 'camera'
export type ProgramBackgroundImageFit = 'cover' | 'contain'

export type ProgramBackground = {
  mode: ProgramBackgroundMode
  /** #RRGGBB */
  color: string
  imageUrl: string | null
  imageFit: ProgramBackgroundImageFit
  cameraId: string | null
}

export const DEFAULT_PROGRAM_BACKGROUND: ProgramBackground = {
  mode: 'color',
  color: '#000000',
  imageUrl: null,
  imageFit: 'cover',
  cameraId: null
}

const STORAGE_KEY = 'studioLive.programBackground.v1'

const imageCache = new Map<string, HTMLImageElement>()
const imageLoading = new Map<string, Promise<HTMLImageElement | null>>()
const imageListeners = new Set<() => void>()

function notifyImageLoaded(): void {
  for (const fn of imageListeners) fn()
}

export function onProgramBackgroundImageLoaded(listener: () => void): () => void {
  imageListeners.add(listener)
  return () => imageListeners.delete(listener)
}

function normalizeHexColor(raw: string): string {
  const t = raw.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return t
  if (/^#[0-9a-fA-F]{3}$/.test(t)) {
    const r = t[1]!
    const g = t[2]!
    const b = t[3]!
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return '#000000'
}

export function parseProgramBackground(raw: unknown): ProgramBackground {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PROGRAM_BACKGROUND }
  const o = raw as Record<string, unknown>
  const mode =
    o.mode === 'image' || o.mode === 'camera' || o.mode === 'color' ? o.mode : 'color'
  const color = typeof o.color === 'string' ? normalizeHexColor(o.color) : '#000000'
  const imageUrl = typeof o.imageUrl === 'string' && o.imageUrl.length > 0 ? o.imageUrl : null
  const imageFit = o.imageFit === 'contain' ? 'contain' : 'cover'
  const cameraId = typeof o.cameraId === 'string' && o.cameraId.length > 0 ? o.cameraId : null
  return { mode, color, imageUrl, imageFit, cameraId }
}

export function loadProgramBackground(): ProgramBackground {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PROGRAM_BACKGROUND }
    return parseProgramBackground(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_PROGRAM_BACKGROUND }
  }
}

export function saveProgramBackground(bg: ProgramBackground): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bg))
  } catch {
    /* quota / private mode */
  }
}

function getLoadedBackgroundImage(url: string): HTMLImageElement | null {
  const img = imageCache.get(url)
  if (!img || !img.complete || img.naturalWidth < 1) return null
  return img
}

/** Carga (o reutiliza) la imagen de fondo; data: URLs y studio-webm://. */
export function loadProgramBackgroundImage(url: string): Promise<HTMLImageElement | null> {
  const ready = getLoadedBackgroundImage(url)
  if (ready) return Promise.resolve(ready)

  const pending = imageLoading.get(url)
  if (pending) return pending

  const promise = (async (): Promise<HTMLImageElement | null> => {
    let src = url
    if (url.startsWith('studio-webm://')) {
      try {
        const res = await fetch(url)
        if (!res.ok) return null
        const blob = await res.blob()
        src = URL.createObjectURL(blob)
      } catch {
        return null
      }
    }

    return new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image()
      img.decoding = 'async'
      if (!src.startsWith('data:') && !src.startsWith('blob:')) img.crossOrigin = 'anonymous'
      img.onload = () => {
        if (src.startsWith('blob:')) URL.revokeObjectURL(src)
        imageCache.set(url, img)
        imageLoading.delete(url)
        notifyImageLoaded()
        resolve(img)
      }
      img.onerror = () => {
        if (src.startsWith('blob:')) URL.revokeObjectURL(src)
        imageLoading.delete(url)
        imageCache.delete(url)
        resolve(null)
      }
      img.src = src
    })
  })()
  imageLoading.set(url, promise)
  return promise
}

export function preloadProgramBackgroundImage(url: string): void {
  void loadProgramBackgroundImage(url)
}

function drawImageInCanvas(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cw: number,
  ch: number,
  fit: ProgramBackgroundImageFit
): void {
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  if (!iw || !ih) return
  const scale = fit === 'cover' ? Math.max(cw / iw, ch / ih) : Math.min(cw / iw, ch / ih)
  const dw = iw * scale
  const dh = ih * scale
  const dx = (cw - dw) / 2
  const dy = (ch - dh) / 2
  ctx.drawImage(img, dx, dy, dw, dh)
}

export type DrawProgramBackgroundOptions = {
  ctx: CanvasRenderingContext2D
  cw: number
  ch: number
  background: ProgramBackground
  getVideo?: (cameraId: string) => HTMLVideoElement | undefined
  getStream?: (cameraId: string) => MediaStream | undefined
  getRotateDeg?: (cameraId: string) => number
}

/** Limpia el frame (opaco). Evita “fantasmas” al mover slots con fondo vídeo/imagen. */
export function resetProgramCanvas(ctx: CanvasRenderingContext2D, cw: number, ch: number): void {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, cw, ch)
  ctx.restore()
}

/** Pinta el fondo del programa (debajo de los slots). */
export function drawProgramBackground(opts: DrawProgramBackgroundOptions): void {
  const { ctx, cw, ch, background, getVideo, getStream, getRotateDeg } = opts
  const fallback = normalizeHexColor(background.color)

  if (background.mode === 'color') {
    ctx.fillStyle = fallback
    ctx.fillRect(0, 0, cw, ch)
    return
  }

  if (background.mode === 'image') {
    const url = background.imageUrl
    if (!url) {
      ctx.fillStyle = fallback
      ctx.fillRect(0, 0, cw, ch)
      return
    }
    const img = getLoadedBackgroundImage(url)
    if (!img) {
      preloadProgramBackgroundImage(url)
      ctx.fillStyle = fallback
      ctx.fillRect(0, 0, cw, ch)
      return
    }
    ctx.fillStyle = fallback
    ctx.fillRect(0, 0, cw, ch)
    try {
      drawImageInCanvas(ctx, img, cw, ch, background.imageFit)
    } catch {
      ctx.fillStyle = fallback
      ctx.fillRect(0, 0, cw, ch)
    }
    return
  }

  if (background.mode === 'camera' && background.cameraId && getVideo) {
    const v = getVideo(background.cameraId)
    if (!v || v.readyState < 1) {
      ctx.fillStyle = fallback
      ctx.fillRect(0, 0, cw, ch)
      return
    }
    const stream = getStream?.(background.cameraId)
    const { vw, vh } = getVideoFrameSize(v, stream)
    if (!vw || !vh) {
      ctx.fillStyle = fallback
      ctx.fillRect(0, 0, cw, ch)
      return
    }
    const rect: SlotRect = { x: 0, y: 0, w: cw, h: ch }
    const rot = getRotateDeg?.(background.cameraId) ?? 0
    try {
      drawCroppedFramedVideoInRect(
        ctx,
        v,
        rect,
        CROP_FULL,
        FRAMING_NEUTRAL,
        rot,
        1,
        'cover',
        undefined,
        vw,
        vh
      )
    } catch {
      ctx.fillStyle = fallback
      ctx.fillRect(0, 0, cw, ch)
    }
    return
  }

  ctx.fillStyle = fallback
  ctx.fillRect(0, 0, cw, ch)
}

export const PROGRAM_BACKGROUND_COLOR_PRESETS: { label: string; color: string }[] = [
  { label: 'Negro', color: '#000000' },
  { label: 'Croma', color: '#00b140' },
  { label: 'Gris', color: '#1e293b' }
]
