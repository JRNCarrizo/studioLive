import { type CamFraming, FRAMING_NEUTRAL } from './programFraming'

export type FramingMotionStep = {
  durationMs: number
  framing: CamFraming
}

export type FramingMotionPreset = {
  id: string
  label: string
  title: string
  steps: FramingMotionStep[]
}

/** Gestos cortos (un paso o pan simple). */
export const BUILTIN_MOTION_SIMPLE_PRESETS: FramingMotionPreset[] = [
  {
    id: 'acercar',
    label: 'Acercar',
    title: 'Zoom suave al centro (~2,2 s)',
    steps: [{ durationMs: 2200, framing: { zoom: 1.65, offsetX: 0.5, offsetY: 0.5 } }]
  },
  {
    id: 'alejar',
    label: 'Alejar',
    title: 'Plano general 1× centrado (~2,4 s) — no es tu neutro de pestaña',
    steps: [{ durationMs: 2400, framing: { ...FRAMING_NEUTRAL } }]
  },
  {
    id: 'pan-derecha',
    label: 'Pan\u00a0→',
    title: 'Acercar y desplazar a la derecha (~4,4 s)',
    steps: [
      { durationMs: 2000, framing: { zoom: 1.45, offsetX: 0.5, offsetY: 0.5 } },
      { durationMs: 2400, framing: { zoom: 1.45, offsetX: 0.68, offsetY: 0.5 } }
    ]
  },
  {
    id: 'pan-izquierda',
    label: 'Pan\u00a0←',
    title: 'Acercar y desplazar a la izquierda (~4,4 s)',
    steps: [
      { durationMs: 2000, framing: { zoom: 1.45, offsetX: 0.5, offsetY: 0.5 } },
      { durationMs: 2400, framing: { zoom: 1.45, offsetX: 0.32, offsetY: 0.5 } }
    ]
  },
  {
    id: 'pan-arriba',
    label: 'Pan\u00a0↑',
    title: 'Acercar y subir el encuadre (~4 s)',
    steps: [
      { durationMs: 1800, framing: { zoom: 1.4, offsetX: 0.5, offsetY: 0.5 } },
      { durationMs: 2200, framing: { zoom: 1.4, offsetX: 0.5, offsetY: 0.36 } }
    ]
  },
  {
    id: 'pan-abajo',
    label: 'Pan\u00a0↓',
    title: 'Acercar y bajar el encuadre (~4 s)',
    steps: [
      { durationMs: 1800, framing: { zoom: 1.4, offsetX: 0.5, offsetY: 0.5 } },
      { durationMs: 2200, framing: { zoom: 1.4, offsetX: 0.5, offsetY: 0.64 } }
    ]
  },
  {
    id: 'reveal',
    label: 'Abrir',
    title: 'Plano cerrado → plano general (~4,2 s)',
    steps: [
      { durationMs: 1200, framing: { zoom: 2.1, offsetX: 0.5, offsetY: 0.5 } },
      { durationMs: 3000, framing: { ...FRAMING_NEUTRAL } }
    ]
  },
  {
    id: 'detalle',
    label: 'Detalle',
    title: 'Plano detalle moderado (~1,8 s)',
    steps: [{ durationMs: 1800, framing: { zoom: 1.55, offsetX: 0.5, offsetY: 0.48 } }]
  },
  {
    id: 'sostener',
    label: 'Sostener',
    title: 'Detalle, pausa y vuelta al neutro (~5,5 s)',
    steps: [
      { durationMs: 1400, framing: { zoom: 1.62, offsetX: 0.5, offsetY: 0.5 } },
      { durationMs: 2200, framing: { zoom: 1.62, offsetX: 0.5, offsetY: 0.5 } },
      { durationMs: 1900, framing: { ...FRAMING_NEUTRAL } }
    ]
  },
  {
    id: 'neutro',
    label: 'Neutro',
    title: 'Vuelve al neutro de esta cámara/pestaña (~1,6 s)',
    steps: [{ durationMs: 1600, framing: { ...FRAMING_NEUTRAL } }]
  }
]

/**
 * Secuencias dinámicas: zoom en un costado → recorrido al otro → neutro de la pestaña.
 * Los offsets son respecto al neutro de autoría; velocidad/intensidad los escalan al reproducir.
 */
export const BUILTIN_MOTION_SEQUENCE_PRESETS: FramingMotionPreset[] = [
  {
    id: 'seq-barrido-der',
    label: 'Barrido\u00a0→',
    title:
      'Zoom al costado izquierdo, recorre hasta la derecha con el mismo zoom y vuelve al neutro (~7,2 s)',
    steps: [
      { durationMs: 2000, framing: { zoom: 1.52, offsetX: 0.34, offsetY: 0.5 } },
      { durationMs: 3200, framing: { zoom: 1.52, offsetX: 0.66, offsetY: 0.5 } },
      { durationMs: 2000, framing: { ...FRAMING_NEUTRAL } }
    ]
  },
  {
    id: 'seq-barrido-izq',
    label: 'Barrido\u00a0←',
    title:
      'Zoom al costado derecho, recorre hasta la izquierda con el mismo zoom y vuelve al neutro (~7,2 s)',
    steps: [
      { durationMs: 2000, framing: { zoom: 1.52, offsetX: 0.66, offsetY: 0.5 } },
      { durationMs: 3200, framing: { zoom: 1.52, offsetX: 0.34, offsetY: 0.5 } },
      { durationMs: 2000, framing: { ...FRAMING_NEUTRAL } }
    ]
  },
  {
    id: 'seq-recorrido',
    label: 'Recorrido',
    title: 'Acercar al centro, barrido izquierda → derecha y vuelta al neutro (~9,5 s)',
    steps: [
      { durationMs: 1600, framing: { zoom: 1.42, offsetX: 0.5, offsetY: 0.5 } },
      { durationMs: 2200, framing: { zoom: 1.5, offsetX: 0.32, offsetY: 0.5 } },
      { durationMs: 2600, framing: { zoom: 1.5, offsetX: 0.68, offsetY: 0.5 } },
      { durationMs: 2100, framing: { ...FRAMING_NEUTRAL } }
    ]
  },
  {
    id: 'seq-barrido-v',
    label: 'Barrido\u00a0↕',
    title: 'Zoom arriba, recorre hacia abajo con el mismo zoom y vuelve al neutro (~7 s)',
    steps: [
      { durationMs: 1900, framing: { zoom: 1.48, offsetX: 0.5, offsetY: 0.36 } },
      { durationMs: 3100, framing: { zoom: 1.48, offsetX: 0.5, offsetY: 0.64 } },
      { durationMs: 2000, framing: { ...FRAMING_NEUTRAL } }
    ]
  },
  {
    id: 'seq-impulso',
    label: 'Impulso',
    title: 'Detalle rápido al centro y vuelta al neutro (~2,8 s)',
    steps: [
      { durationMs: 1100, framing: { zoom: 1.72, offsetX: 0.5, offsetY: 0.5 } },
      { durationMs: 1700, framing: { ...FRAMING_NEUTRAL } }
    ]
  },
  {
    id: 'seq-onda',
    label: 'Onda',
    title: 'Detalle con pausa, barrido suave izquierda → derecha y neutro (~8,5 s)',
    steps: [
      { durationMs: 1300, framing: { zoom: 1.58, offsetX: 0.5, offsetY: 0.5 } },
      { durationMs: 900, framing: { zoom: 1.58, offsetX: 0.5, offsetY: 0.5 } },
      { durationMs: 2300, framing: { zoom: 1.46, offsetX: 0.36, offsetY: 0.5 } },
      { durationMs: 2400, framing: { zoom: 1.46, offsetX: 0.64, offsetY: 0.5 } },
      { durationMs: 1900, framing: { ...FRAMING_NEUTRAL } }
    ]
  }
]

/** Presets integrados (autoría respecto a FRAMING_NEUTRAL; se adaptan al neutro vivo al reproducir). */
export const BUILTIN_FRAMING_MOTION_PRESETS: FramingMotionPreset[] = [
  ...BUILTIN_MOTION_SIMPLE_PRESETS,
  ...BUILTIN_MOTION_SEQUENCE_PRESETS
]

export function isMotionSequencePresetId(id: string): boolean {
  return id.startsWith('seq-')
}

const builtinById = new Map(BUILTIN_FRAMING_MOTION_PRESETS.map((p) => [p.id, p]))

/** @deprecated Usar BUILTIN_FRAMING_MOTION_PRESETS */
export const FRAMING_MOTION_PRESETS = BUILTIN_FRAMING_MOTION_PRESETS

export function getBuiltinFramingMotionPreset(id: string): FramingMotionPreset | undefined {
  return builtinById.get(id)
}

export function getFramingMotionPreset(id: string): FramingMotionPreset | undefined {
  return getBuiltinFramingMotionPreset(id)
}
