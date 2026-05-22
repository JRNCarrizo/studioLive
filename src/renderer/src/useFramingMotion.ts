import { useCallback, useMemo, useRef, useState } from 'react'

import { startFramingMotion, tickFramingMotion, type ActiveFramingMotion } from './framingMotion'
import {
  resolveMotionPreset,
  type FramingMotionApplyOptions
} from './framingMotionPresetApply'
import { getCustomFramingMotionPreset } from './framingMotionPresetsStorage'
import type { CamFraming } from './programFraming'
import { getBuiltinFramingMotionPreset, type FramingMotionPreset } from './programFramingPresets'

export function useFramingMotion() {
  const motionRef = useRef<ActiveFramingMotion | null>(null)
  const [motionLabel, setMotionLabel] = useState<string | null>(null)

  const cancelMotion = useCallback(() => {
    motionRef.current = null
    setMotionLabel(null)
  }, [])

  const playPreset = useCallback(
    (
      cameraId: string,
      preset: FramingMotionPreset,
      getTarget: () => CamFraming,
      setTarget: (cameraId: string, framing: CamFraming) => void,
      applyOptions: FramingMotionApplyOptions
    ) => {
      if (preset.steps.length === 0) return
      const custom = getCustomFramingMotionPreset(preset.id)
      const resolved = resolveMotionPreset(preset, {
        ...applyOptions,
        neutralAtSave: custom?.neutralAtSave
      })
      const from = getTarget()
      motionRef.current = startFramingMotion(cameraId, resolved, from)
      setTarget(cameraId, from)
      setMotionLabel(resolved.label)
    },
    []
  )

  const playPresetById = useCallback(
    (
      cameraId: string,
      presetId: string,
      getTarget: () => CamFraming,
      setTarget: (cameraId: string, framing: CamFraming) => void,
      applyOptions: FramingMotionApplyOptions
    ) => {
      const custom = getCustomFramingMotionPreset(presetId)
      const raw = custom ?? getBuiltinFramingMotionPreset(presetId)
      if (!raw) return
      playPreset(cameraId, raw, getTarget, setTarget, applyOptions)
    },
    [playPreset]
  )

  const tickMotion = useCallback((setTarget: (cameraId: string, framing: CamFraming) => void) => {
    const active = motionRef.current
    if (!active) return
    const { motion, framing } = tickFramingMotion(active, performance.now())
    setTarget(active.cameraId, framing)
    if (!motion) {
      motionRef.current = null
      setMotionLabel(null)
    } else {
      motionRef.current = motion
    }
  }, [])

  const isPlaying = motionLabel != null

  return useMemo(
    () => ({
      motionLabel,
      isPlaying,
      playPreset,
      playPresetById,
      cancelMotion,
      tickMotion
    }),
    [motionLabel, isPlaying, playPreset, playPresetById, cancelMotion, tickMotion]
  )
}
