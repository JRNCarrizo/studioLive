export type FusionTimelineSegment = {
  startSec: number
  endSec: number
  cameraId: string
}

export const FUSION_CAMERA_PALETTE = [
  'hsl(204 72% 46%)',
  'hsl(36 88% 48%)',
  'hsl(142 58% 40%)',
  'hsl(278 58% 54%)',
  'hsl(168 55% 42%)',
  'hsl(12 78% 52%)',
  'hsl(48 85% 46%)',
  'hsl(310 62% 52%)'
] as const

export function fusionCameraColorMap(cameraIds: Iterable<string>): Map<string, string> {
  const sorted = [...new Set(cameraIds)].sort((a, b) => a.localeCompare(b))
  const map = new Map<string, string>()
  sorted.forEach((id, i) => {
    map.set(id, FUSION_CAMERA_PALETTE[i % FUSION_CAMERA_PALETTE.length]!)
  })
  return map
}

export function fusionSegmentColor(map: Map<string, string>, cameraId: string): string {
  const fromPalette = map.get(cameraId)
  if (fromPalette) return fromPalette
  let h = 0
  for (let i = 0; i < cameraId.length; i++) {
    h = (Math.imul(h, 31) + cameraId.charCodeAt(i)) >>> 0
  }
  return `hsl(${h % 360} 58% 42%)`
}

/** Qué cámara iba al programa en el tiempo `t` según el plan ya cerrado. */
export function cameraAtFusionTime(
  t: number,
  segments: readonly FusionTimelineSegment[]
): string | null {
  if (!segments.length) return null
  const sorted = [...segments].sort((a, b) => a.startSec - b.startSec)
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!
    const last = i === sorted.length - 1
    if (last) {
      if (t >= s.startSec && t <= s.endSec + 1e-3) return s.cameraId
    } else if (t >= s.startSec && t < s.endSec) {
      return s.cameraId
    }
  }
  return null
}

export function fmtPlanTime(s: number): string {
  if (!Number.isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}
