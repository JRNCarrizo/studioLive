import { useCallback, useMemo, useRef, useState } from 'react'

import { startFramingMotion, tickFramingMotion, type ActiveFramingMotion } from './framingMotion'
import {
  resolveMotionPreset,
  type FramingMotionApplyOptions
} from './framingMotionPresetApply'
import { getCustomFramingMotionPreset } from './framingMotionPresetsStorage'
import type { CamFraming } from './programFraming'
import { getBuiltinFramingMotionPreset, type FramingMotionPreset } from './programFramingPresets'

type MotionQueue = {
  cameraId: string
  presetIds: string[]
  nextIndex: number
  getTarget: () => CamFraming
  setTarget: (cameraId: string, framing: CamFraming) => void
  applyOptions: FramingMotionApplyOptions
  framingNeutral: CamFraming
}

export function useFramingMotion() {
  const motionRef = useRef<ActiveFramingMotion | null>(null)
  const queueRef = useRef<MotionQueue | null>(null)
  const [motionLabel, setMotionLabel] = useState<string | null>(null)

  const cancelMotion = useCallback(() => {
    motionRef.current = null
    queueRef.current = null
    setMotionLabel(null)
  }, [])

  const cancelEnterProgram = useCallback(() => {
    queueRef.current = null
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

  const playNextInQueue = useCallback(() => {
    const q = queueRef.current
    if (!q) return
    while (q.nextIndex < q.presetIds.length) {
      const presetId = q.presetIds[q.nextIndex]!
      q.nextIndex += 1
      const custom = getCustomFramingMotionPreset(presetId)
      const raw = custom ?? getBuiltinFramingMotionPreset(presetId)
      if (raw && raw.steps.length > 0) {
        playPreset(q.cameraId, raw, q.getTarget, q.setTarget, q.applyOptions)
        return
      }
    }
    queueRef.current = null
  }, [playPreset])

  const startEnterProgram = useCallback(
    (
      cameraId: string,
      presetIds: string[],
      getTarget: () => CamFraming,
      setTarget: (cameraId: string, framing: CamFraming) => void,
      applyOptions: FramingMotionApplyOptions,
      framingNeutral: CamFraming
    ) => {
      const ids = presetIds.filter((id) => getBuiltinFramingMotionPreset(id) || getCustomFramingMotionPreset(id))
      if (!ids.length) return
      motionRef.current = null
      setMotionLabel(null)
      const neutral = { ...framingNeutral }
      setTarget(cameraId, neutral)
      queueRef.current = {
        cameraId,
        presetIds: ids,
        nextIndex: 0,
        getTarget,
        setTarget,
        applyOptions,
        framingNeutral: neutral
      }
      playNextInQueue()
    },
    [playNextInQueue]
  )

  const tickMotion = useCallback((setTarget: (cameraId: string, framing: CamFraming) => void) => {
    const active = motionRef.current
    if (!active) return
    const { motion, framing } = tickFramingMotion(active, performance.now())
    setTarget(active.cameraId, framing)
    if (!motion) {
      motionRef.current = null
      setMotionLabel(null)
      if (queueRef.current) playNextInQueue()
    } else {
      motionRef.current = motion
    }
  }, [playNextInQueue])

  const isPlaying = motionLabel != null

  return useMemo(
    () => ({
      motionLabel,
      isPlaying,
      playPreset,
      playPresetById,
      cancelMotion,
      cancelEnterProgram,
      startEnterProgram,
      tickMotion
    }),
    [
      motionLabel,
      isPlaying,
      playPreset,
      playPresetById,
      cancelMotion,
      cancelEnterProgram,
      startEnterProgram,
      tickMotion
    ]
  )
}
