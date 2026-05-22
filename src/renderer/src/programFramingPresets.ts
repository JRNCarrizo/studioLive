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



/** Presets integrados (autoría respecto a FRAMING_NEUTRAL; se adaptan al neutro vivo al reproducir). */

export const BUILTIN_FRAMING_MOTION_PRESETS: FramingMotionPreset[] = [

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

    label: 'Pan →',

    title: 'Acercar y desplazar a la derecha (~4,4 s)',

    steps: [

      { durationMs: 2000, framing: { zoom: 1.45, offsetX: 0.5, offsetY: 0.5 } },

      { durationMs: 2400, framing: { zoom: 1.45, offsetX: 0.68, offsetY: 0.5 } }

    ]

  },

  {

    id: 'pan-izquierda',

    label: 'Pan ←',

    title: 'Acercar y desplazar a la izquierda (~4,4 s)',

    steps: [

      { durationMs: 2000, framing: { zoom: 1.45, offsetX: 0.5, offsetY: 0.5 } },

      { durationMs: 2400, framing: { zoom: 1.45, offsetX: 0.32, offsetY: 0.5 } }

    ]

  },

  {

    id: 'pan-arriba',

    label: 'Pan ↑',

    title: 'Acercar y subir el encuadre (~4 s)',

    steps: [

      { durationMs: 1800, framing: { zoom: 1.4, offsetX: 0.5, offsetY: 0.5 } },

      { durationMs: 2200, framing: { zoom: 1.4, offsetX: 0.5, offsetY: 0.36 } }

    ]

  },

  {

    id: 'pan-abajo',

    label: 'Pan ↓',

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



const builtinById = new Map(BUILTIN_FRAMING_MOTION_PRESETS.map((p) => [p.id, p]))



/** @deprecated Usar BUILTIN_FRAMING_MOTION_PRESETS */

export const FRAMING_MOTION_PRESETS = BUILTIN_FRAMING_MOTION_PRESETS



export function getBuiltinFramingMotionPreset(id: string): FramingMotionPreset | undefined {

  return builtinById.get(id)

}

export function getFramingMotionPreset(id: string): FramingMotionPreset | undefined {

  return getBuiltinFramingMotionPreset(id)

}


