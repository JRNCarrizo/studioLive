import { getCustomFramingMotionPreset } from './framingMotionPresetsStorage'
import {
  getBuiltinFramingMotionPreset,
  isMotionSequencePresetId,
  type FramingMotionPreset
} from './programFramingPresets'

export type MotionPresetChipVariant = 'gesture' | 'sequence' | 'custom'

export type MotionPresetDisplay = {
  id: string
  label: string
  title: string
  chipLetter: string
  chipVariant: MotionPresetChipVariant
}

export function motionChipLetter(label: string): string {
  const normalized = label.replace(/\u00a0/g, ' ').trim()
  const m = normalized.match(/[\p{L}\p{N}]/u)
  return m ? m[0].toUpperCase() : '?'
}

export function motionPresetChipVariant(presetId: string): MotionPresetChipVariant {
  if (getCustomFramingMotionPreset(presetId)) return 'custom'
  if (isMotionSequencePresetId(presetId)) return 'sequence'
  return 'gesture'
}

export function motionPresetChipClassName(variant: MotionPresetChipVariant): string {
  return `fusion-motion-chip--${variant}`
}

export function resolveMotionPresetDisplay(presetId: string): MotionPresetDisplay | null {
  const custom = getCustomFramingMotionPreset(presetId)
  const preset: FramingMotionPreset | undefined =
    custom ?? getBuiltinFramingMotionPreset(presetId)
  if (!preset) return null
  const chipVariant = motionPresetChipVariant(presetId)
  return {
    id: preset.id,
    label: preset.label,
    title: preset.title,
    chipLetter: motionChipLetter(preset.label),
    chipVariant
  }
}
