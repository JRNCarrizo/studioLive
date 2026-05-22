import type { CamFraming } from './programFraming'
import type { FramingMotionPreset, FramingMotionStep } from './programFramingPresets'

const CUSTOM_KEY = 'studioLive.framingMotion.custom.v1'
const SETTINGS_KEY = 'studioLive.framingMotion.settings.v1'

export type CustomFramingMotionPreset = FramingMotionPreset & {
  neutralAtSave: CamFraming
  createdAt: number
}

export type FramingMotionSettings = {
  speed: number
  intensity: number
}

const DEFAULT_SETTINGS: FramingMotionSettings = { speed: 1, intensity: 1 }

function loadCustomRaw(): CustomFramingMotionPreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((p): p is CustomFramingMotionPreset => {
      if (!p || typeof p !== 'object') return false
      const o = p as CustomFramingMotionPreset
      return (
        typeof o.id === 'string' &&
        typeof o.name === 'string' &&
        Array.isArray(o.steps) &&
        o.steps.length > 0 &&
        o.neutralAtSave != null
      )
    })
  } catch {
    return []
  }
}

function saveCustomRaw(list: CustomFramingMotionPreset[]): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list))
  } catch {
    /* quota */
  }
}

export function loadFramingMotionSettings(): FramingMotionSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const o = JSON.parse(raw) as Partial<FramingMotionSettings>
    return {
      speed: typeof o.speed === 'number' && o.speed > 0 ? o.speed : DEFAULT_SETTINGS.speed,
      intensity: typeof o.intensity === 'number' && o.intensity > 0 ? o.intensity : DEFAULT_SETTINGS.intensity
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveFramingMotionSettings(s: FramingMotionSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* vacío */
  }
}

export function listCustomFramingMotionPresets(): CustomFramingMotionPreset[] {
  return loadCustomRaw()
}

export function getCustomFramingMotionPreset(id: string): CustomFramingMotionPreset | undefined {
  return loadCustomRaw().find((p) => p.id === id)
}

export function saveCustomFramingMotionFromCurrent(
  name: string,
  currentFraming: CamFraming,
  framingNeutral: CamFraming,
  durationMs = 2200
): CustomFramingMotionPreset {
  const trimmed = name.trim()
  const label = trimmed || 'Mi movimiento'
  const steps: FramingMotionStep[] = [
    { durationMs: Math.max(400, Math.round(durationMs)), framing: { ...currentFraming } }
  ]
  const preset: CustomFramingMotionPreset = {
    id: `motion-custom-${Date.now()}`,
    name: label,
    label,
    title: `Ir al encuadre guardado (~${(durationMs / 1000).toFixed(1)} s)`,
    steps,
    neutralAtSave: { ...framingNeutral },
    createdAt: Date.now()
  }
  const list = loadCustomRaw()
  list.push(preset)
  saveCustomRaw(list)
  return preset
}

export function renameCustomFramingMotionPreset(id: string, name: string): boolean {
  const list = loadCustomRaw()
  const i = list.findIndex((p) => p.id === id)
  if (i < 0) return false
  const label = name.trim() || list[i]!.label
  list[i] = { ...list[i]!, name: label, label }
  saveCustomRaw(list)
  return true
}

export function deleteCustomFramingMotionPreset(id: string): void {
  saveCustomRaw(loadCustomRaw().filter((p) => p.id !== id))
}
