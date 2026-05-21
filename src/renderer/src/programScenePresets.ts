import type { ProgramBackground } from './programBackground'
import { getLayout, type LayoutAssignments, type LayoutId, type ProgramOrientation } from './programScenes'

export type ScenePreset = {
  id: string
  name: string
  programLayoutId: LayoutId
  layoutAssignments: LayoutAssignments
  programOrientation: ProgramOrientation
  programCrossfadeMs: number
  background: ProgramBackground
  createdAt: number
}

const STORAGE_KEY = 'studioLive.scenePresets.v1'

const BUILTIN: ScenePreset[] = [
  {
    id: 'builtin-single',
    name: 'Solo cámara',
    programLayoutId: 'single',
    layoutAssignments: { single: [null] },
    programOrientation: 'landscape',
    programCrossfadeMs: 420,
    background: { mode: 'color', color: '#000000', imageUrl: null, imageFit: 'cover', cameraId: null },
    createdAt: 0
  },
  {
    id: 'builtin-pip',
    name: 'Pantalla + cara (PIP)',
    programLayoutId: 'pip',
    layoutAssignments: { pip: [null, null] },
    programOrientation: 'landscape',
    programCrossfadeMs: 420,
    background: { mode: 'color', color: '#000000', imageUrl: null, imageFit: 'cover', cameraId: null },
    createdAt: 0
  },
  {
    id: 'builtin-2x2',
    name: 'Cuadrícula 2×2',
    programLayoutId: 'grid2x2',
    layoutAssignments: { grid2x2: [null, null, null, null] },
    programOrientation: 'landscape',
    programCrossfadeMs: 420,
    background: { mode: 'color', color: '#000000', imageUrl: null, imageFit: 'cover', cameraId: null },
    createdAt: 0
  }
]

function loadCustom(): ScenePreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((p): p is ScenePreset => Boolean(p && typeof p === 'object' && typeof (p as ScenePreset).name === 'string'))
  } catch {
    return []
  }
}

function saveCustom(list: ScenePreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* quota */
  }
}

export function listScenePresets(): ScenePreset[] {
  return [...BUILTIN, ...loadCustom()]
}

export function saveScenePresetFromCurrent(
  name: string,
  snapshot: Omit<ScenePreset, 'id' | 'name' | 'createdAt'>
): ScenePreset {
  const preset: ScenePreset = {
    ...snapshot,
    id: `custom-${Date.now()}`,
    name: name.trim() || 'Escena',
    createdAt: Date.now()
  }
  const custom = loadCustom()
  custom.push(preset)
  saveCustom(custom)
  return preset
}

export function deleteScenePreset(id: string): void {
  if (id.startsWith('builtin-')) return
  saveCustom(loadCustom().filter((p) => p.id !== id))
}

/** Rellena slots null con cámaras disponibles (misma lógica que al mandar layout al aire). */
export function resolvePresetSlots(
  preset: ScenePreset,
  cameraIds: string[]
): { layoutId: LayoutId; slots: (string | null)[] } {
  const layoutId = preset.programLayoutId
  const saved = preset.layoutAssignments[layoutId] ?? []
  const slots: (string | null)[] = []
  const used = new Set<string>()
  const slotCount = getLayout(layoutId).slotsCount

  for (let i = 0; i < slotCount; i++) {
    const want = saved[i] ?? null
    if (want && cameraIds.includes(want) && !used.has(want)) {
      slots.push(want)
      used.add(want)
      continue
    }
    const pick = cameraIds.find((cid) => !used.has(cid)) ?? null
    if (pick) used.add(pick)
    slots.push(pick)
  }
  return { layoutId, slots }
}
