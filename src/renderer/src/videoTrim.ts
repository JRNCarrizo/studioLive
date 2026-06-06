/** Rango de exportación en segundos (inicio inclusive, fin en el reloj del archivo). */
export type VideoTrimRange = {
  startSec: number
  endSec: number
}

export const MIN_EXPORT_DURATION_SEC = 0.5
const EDGE_EPS_SEC = 0.05

export function formatMediaTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const s = Math.floor(sec)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

export function normalizeTrimRange(
  durationSec: number,
  trimInSec: number,
  trimOutSec: number
): {
  startSec: number
  endSec: number
  exportDurationSec: number
  isFullRange: boolean
} {
  if (!Number.isFinite(durationSec) || durationSec <= MIN_EXPORT_DURATION_SEC) {
    return { startSec: 0, endSec: durationSec || 0, exportDurationSec: durationSec || 0, isFullRange: true }
  }
  let start = Math.max(0, Math.min(trimInSec, durationSec - MIN_EXPORT_DURATION_SEC))
  let end = Math.max(start + MIN_EXPORT_DURATION_SEC, Math.min(trimOutSec, durationSec))
  const isFullRange = start <= EDGE_EPS_SEC && end >= durationSec - EDGE_EPS_SEC
  return {
    startSec: start,
    endSec: end,
    exportDurationSec: end - start,
    isFullRange
  }
}

export function trimRangeForExport(
  durationSec: number,
  trimInSec: number,
  trimOutSec: number
): VideoTrimRange | undefined {
  const n = normalizeTrimRange(durationSec, trimInSec, trimOutSec)
  if (n.isFullRange || n.exportDurationSec < MIN_EXPORT_DURATION_SEC) return undefined
  return { startSec: n.startSec, endSec: n.endSec }
}
