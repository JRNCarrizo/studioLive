/** Ajustes de imagen por cámara (-100…100; 0 = neutro). */
export type CamColorAdjust = {
  brightness: number
  contrast: number
  saturation: number
  /** Más alto = más cálido (ámbar); más bajo = más frío (azul). */
  temperature: number
}

export const COLOR_ADJUST_NEUTRAL: CamColorAdjust = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0
}

const MIN = -100
const MAX = 100

export function clampColorAdjust(a: CamColorAdjust): CamColorAdjust {
  const clamp = (n: number) => Math.max(MIN, Math.min(MAX, n))
  return {
    brightness: clamp(a.brightness),
    contrast: clamp(a.contrast),
    saturation: clamp(a.saturation),
    temperature: clamp(a.temperature)
  }
}

export function colorAdjustIsNeutral(a: CamColorAdjust): boolean {
  return (
    a.brightness === 0 &&
    a.contrast === 0 &&
    a.saturation === 0 &&
    a.temperature === 0
  )
}

/** Cadena CSS para `CanvasRenderingContext2D.filter`. */
export function colorAdjustToCanvasFilter(a: CamColorAdjust): string {
  if (colorAdjustIsNeutral(a)) return 'none'

  const brightness = 1 + a.brightness / 100
  const contrast = 1 + a.contrast / 100
  const saturate = Math.max(0, 1 + a.saturation / 100)

  const parts = [
    `brightness(${brightness.toFixed(3)})`,
    `contrast(${contrast.toFixed(3)})`,
    `saturate(${saturate.toFixed(3)})`
  ]

  const temp = a.temperature
  if (temp > 0) {
    const t = temp / 100
    parts.push(`sepia(${(t * 0.32).toFixed(3)})`)
    parts.push(`hue-rotate(${(t * -10).toFixed(1)}deg)`)
  } else if (temp < 0) {
    const t = -temp / 100
    parts.push(`hue-rotate(${(t * 18).toFixed(1)}deg)`)
    parts.push(`saturate(${(saturate * (1 - t * 0.08)).toFixed(3)})`)
  }

  return parts.join(' ')
}

export const COLOR_ADJUST_SLIDERS: Array<{
  key: keyof CamColorAdjust
  label: string
  title: string
}> = [
  {
    key: 'brightness',
    label: 'Brillo',
    title: 'Aclara u oscurece la imagen de esta cámara.'
  },
  {
    key: 'contrast',
    label: 'Contraste',
    title: 'Separa más o menos luces y sombras.'
  },
  {
    key: 'saturation',
    label: 'Saturación',
    title: 'Intensidad del color; a la izquierda tiende a escala de grises.'
  },
  {
    key: 'temperature',
    label: 'Temperatura',
    title: 'Frío (azul) ↔ cálido (ámbar).'
  }
]
