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

/** ISO: `cam-{id}-{session}.webm|.mp4`, `audio-{session}.webm|.wav`. */
export function parseRecordingFileName(fileName: string): ParsedRecordingName | null {
  const match = /^(.*)\.(webm|mp4|wav)$/i.exec(fileName)
  if (!match) return null
  const base = match[1]
  const ext = match[2].toLowerCase()
  const audio = /^audio-(\d+)$/.exec(base)
  if (audio) {
    if (ext !== 'webm' && ext !== 'wav') return null
    return { kind: 'audio', session: Number(audio[1]) }
  }
  if (ext === 'wav' || !base.startsWith('cam-')) return null
  const tail = base.slice('cam-'.length)
  const cam = /^(.+)-(\d+)$/.exec(tail)
  if (!cam) return null
  return { kind: 'cam', cameraId: cam[1], session: Number(cam[2]) }
}

export function isoExtensionForMime(mime: string): 'webm' | 'mp4' | 'wav' {
  const lower = mime.toLowerCase()
  if (lower.includes('wav')) return 'wav'
  if (lower.includes('mp4')) return 'mp4'
  return 'webm'
}

export function isoOutputFileName(recKey: string, session: number, mime: string, audioKey: string): string {
  const ext = isoExtensionForMime(mime)
  if (recKey === audioKey) return `audio-${session}.${ext}`
  return `cam-${recKey}-${session}.${ext}`
}
