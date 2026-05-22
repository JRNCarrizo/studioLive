import { clampFraming, FRAMING_NEUTRAL, type CamFraming } from './programFraming'
import type { FramingMotionPreset, FramingMotionStep } from './programFramingPresets'

/** Referencia de autoría de presets integrados (centro 0.5, zoom 1×). */
export const MOTION_TEMPLATE_NEUTRAL: CamFraming = { ...FRAMING_NEUTRAL }

export type FramingMotionApplyOptions = {
  /** 1 = duración por defecto; &gt;1 más lento; &lt;1 más rápido. */
  speed: number
  /** 1 = zoom/pan del preset; &lt;1 suave; &gt;1 más marcado. */
  intensity: number
  /** Neutro de la cámara / pestaña (p. ej. LIVE_FRAMING_NEUTRAL). */
  framingNeutral: CamFraming
  /** Neutro al guardar un preset propio (solo custom). */
  neutralAtSave?: CamFraming
}

function clampSpeed(s: number): number {
  return Math.max(0.35, Math.min(2.5, s))
}

function clampIntensity(i: number): number {
  return Math.max(0.4, Math.min(1.8, i))
}

function scaleFramingFromReference(
  target: CamFraming,
  refNeutral: CamFraming,
  liveNeutral: CamFraming,
  intensity: number
): CamFraming {
  const k = clampIntensity(intensity)
  return clampFraming({
    zoom: liveNeutral.zoom + (target.zoom - refNeutral.zoom) * k,
    offsetX: liveNeutral.offsetX + (target.offsetX - refNeutral.offsetX) * k,
    offsetY: liveNeutral.offsetY + (target.offsetY - refNeutral.offsetY) * k
  })
}

function resolveStepFraming(
  step: FramingMotionStep,
  presetId: string,
  opts: FramingMotionApplyOptions
): CamFraming {
  if (presetId === 'neutro') {
    return clampFraming(opts.framingNeutral)
  }
  /** Plano general absoluto (1×, centro), no el neutro calibrado de la pestaña. */
  if (presetId === 'alejar') {
    const k = clampIntensity(opts.intensity)
    const t = { ...MOTION_TEMPLATE_NEUTRAL }
    const ref = MOTION_TEMPLATE_NEUTRAL
    return clampFraming({
      zoom: ref.zoom + (t.zoom - ref.zoom) * k,
      offsetX: ref.offsetX + (t.offsetX - ref.offsetX) * k,
      offsetY: ref.offsetY + (t.offsetY - ref.offsetY) * k
    })
  }
  const ref = opts.neutralAtSave ?? MOTION_TEMPLATE_NEUTRAL
  return scaleFramingFromReference(step.framing, ref, opts.framingNeutral, opts.intensity)
}

/** Aplica velocidad, intensidad y neutro vivo a un preset antes de reproducirlo. */
export function resolveMotionPreset(
  preset: FramingMotionPreset,
  opts: FramingMotionApplyOptions
): FramingMotionPreset {
  const speed = clampSpeed(opts.speed)
  return {
    ...preset,
    steps: preset.steps.map((step) => ({
      durationMs: Math.max(120, Math.round(step.durationMs * speed)),
      framing: resolveStepFraming(step, preset.id, opts)
    }))
  }
}
