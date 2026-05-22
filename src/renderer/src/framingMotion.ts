import { clampFraming, type CamFraming } from './programFraming'
import type { FramingMotionPreset, FramingMotionStep } from './programFramingPresets'

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function lerpFramingLinear(a: CamFraming, b: CamFraming, t: number): CamFraming {
  const k = Math.max(0, Math.min(1, t))
  return clampFraming({
    zoom: a.zoom + (b.zoom - a.zoom) * k,
    offsetX: a.offsetX + (b.offsetX - a.offsetX) * k,
    offsetY: a.offsetY + (b.offsetY - a.offsetY) * k
  })
}

export type ActiveFramingMotion = {
  cameraId: string
  presetId: string
  label: string
  steps: FramingMotionStep[]
  stepIndex: number
  stepStartMs: number
  fromFraming: CamFraming
}

export function startFramingMotion(
  cameraId: string,
  preset: FramingMotionPreset,
  fromFraming: CamFraming
): ActiveFramingMotion {
  return {
    cameraId,
    presetId: preset.id,
    label: preset.label,
    steps: preset.steps,
    stepIndex: 0,
    stepStartMs: performance.now(),
    fromFraming: clampFraming(fromFraming)
  }
}

export function tickFramingMotion(
  motion: ActiveFramingMotion,
  nowMs: number
): { motion: ActiveFramingMotion | null; framing: CamFraming } {
  const step = motion.steps[motion.stepIndex]
  if (!step) {
    return { motion: null, framing: motion.fromFraming }
  }

  const elapsed = nowMs - motion.stepStartMs
  const rawT = step.durationMs > 0 ? Math.min(1, elapsed / step.durationMs) : 1
  const framing = lerpFramingLinear(motion.fromFraming, step.framing, easeInOutCubic(rawT))

  if (rawT >= 1) {
    const nextIndex = motion.stepIndex + 1
    if (nextIndex >= motion.steps.length) {
      return { motion: null, framing: clampFraming(step.framing) }
    }
    return {
      motion: {
        ...motion,
        stepIndex: nextIndex,
        stepStartMs: nowMs,
        fromFraming: clampFraming(step.framing)
      },
      framing
    }
  }

  return { motion, framing }
}
