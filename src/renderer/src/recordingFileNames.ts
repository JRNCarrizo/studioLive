export type ParsedRecordingName =
  | { kind: 'cam'; cameraId: string; session: number }
  | { kind: 'audio'; session: number }

/**
 * Salida de «Grabar fusión» en el paso 2: `fusion-{sesión}-{timestamp}.webm`.
 * No es una pista ISO del paso 1; no se puede usar como entrada del mismo paso fusión.
 */
export function isFusionExportFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  if (!lower.endsWith('.webm')) return false
  const base = fileName.slice(0, -'.webm'.length)
  return /^fusion-\d+-\d+$/.test(base)
}

/** Convención ISO en App: `cam-{id}-{session}.webm`, `audio-{session}.webm`. */
export function parseRecordingFileName(fileName: string): ParsedRecordingName | null {
  const lower = fileName.toLowerCase()
  if (!lower.endsWith('.webm')) return null
  const base = fileName.slice(0, -'.webm'.length)
  const audio = /^audio-(\d+)$/.exec(base)
  if (audio) return { kind: 'audio', session: Number(audio[1]) }
  if (!base.startsWith('cam-')) return null
  const tail = base.slice('cam-'.length)
  const m = /^(.+)-(\d+)$/.exec(tail)
  if (!m) return null
  return { kind: 'cam', cameraId: m[1], session: Number(m[2]) }
}
