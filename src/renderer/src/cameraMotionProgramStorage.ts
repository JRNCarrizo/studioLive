const STORAGE_KEY = 'studioLive.cameraMotionProgram.v1'

export const MAX_MOTIONS_PER_CAMERA = 4

/** presetId en orden de ejecución al entrar la cámara al aire. */
export type CameraMotionProgramMap = Record<string, string[]>

export function loadCameraMotionProgram(): CameraMotionProgramMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: CameraMotionProgramMap = {}
    for (const [camId, list] of Object.entries(parsed)) {
      if (!Array.isArray(list)) continue
      const ids = list.filter((x): x is string => typeof x === 'string').slice(0, MAX_MOTIONS_PER_CAMERA)
      if (ids.length) out[camId] = ids
    }
    return out
  } catch {
    return {}
  }
}

export function saveCameraMotionProgram(map: CameraMotionProgramMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* quota */
  }
}
