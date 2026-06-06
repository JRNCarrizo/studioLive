import { useCallback, useState } from 'react'

import {
  loadCameraMotionProgram,
  MAX_MOTIONS_PER_CAMERA,
  saveCameraMotionProgram,
  type CameraMotionProgramMap
} from './cameraMotionProgramStorage'
import { resolveMotionPresetDisplay } from './motionPresetMeta'

export function useCameraMotionProgram() {
  const [programs, setPrograms] = useState<CameraMotionProgramMap>(() => loadCameraMotionProgram())
  const [revision, setRevision] = useState(0)

  const bump = useCallback(() => setRevision((n) => n + 1), [])

  const getPresetIds = useCallback(
    (cameraId: string): string[] => programs[cameraId] ?? [],
    [programs]
  )

  const addPreset = useCallback(
    (cameraId: string, presetId: string): boolean => {
      if (!resolveMotionPresetDisplay(presetId)) return false
      let added = false
      setPrograms((prev) => {
        const list = [...(prev[cameraId] ?? [])]
        if (list.length >= MAX_MOTIONS_PER_CAMERA) return prev
        if (list.includes(presetId)) return prev
        list.push(presetId)
        added = true
        const next = { ...prev, [cameraId]: list }
        saveCameraMotionProgram(next)
        return next
      })
      if (added) bump()
      return added
    },
    [bump]
  )

  const removePresetAt = useCallback(
    (cameraId: string, index: number) => {
      setPrograms((prev) => {
        const list = [...(prev[cameraId] ?? [])]
        if (index < 0 || index >= list.length) return prev
        list.splice(index, 1)
        const next = { ...prev }
        if (list.length) next[cameraId] = list
        else delete next[cameraId]
        saveCameraMotionProgram(next)
        return next
      })
      bump()
    },
    [bump]
  )

  const clearCamera = useCallback(
    (cameraId: string) => {
      setPrograms((prev) => {
        if (!prev[cameraId]) return prev
        const next = { ...prev }
        delete next[cameraId]
        saveCameraMotionProgram(next)
        return next
      })
      bump()
    },
    [bump]
  )

  const removeCamera = useCallback(
    (cameraId: string) => {
      clearCamera(cameraId)
    },
    [clearCamera]
  )

  return {
    revision,
    getPresetIds,
    addPreset,
    removePresetAt,
    clearCamera,
    removeCamera
  }
}
