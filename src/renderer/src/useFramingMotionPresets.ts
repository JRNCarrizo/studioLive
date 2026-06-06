import { useCallback, useMemo, useState } from 'react'

import type { CamFraming } from './programFraming'
import {
  deleteCustomFramingMotionPreset,
  listCustomFramingMotionPresets,
  renameCustomFramingMotionPreset,
  saveCustomFramingMotionFromCurrent,
  type CustomFramingMotionPreset
} from './framingMotionPresetsStorage'
import {
  BUILTIN_FRAMING_MOTION_PRESETS,
  BUILTIN_MOTION_SEQUENCE_PRESETS,
  BUILTIN_MOTION_SIMPLE_PRESETS,
  type FramingMotionPreset
} from './programFramingPresets'

export function useFramingMotionPresets() {
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((t) => t + 1), [])

  const customPresets = useMemo(() => listCustomFramingMotionPresets(), [tick])
  const builtinPresets = BUILTIN_FRAMING_MOTION_PRESETS
  const builtinSimplePresets = BUILTIN_MOTION_SIMPLE_PRESETS
  const builtinSequencePresets = BUILTIN_MOTION_SEQUENCE_PRESETS

  const saveFromCurrent = useCallback(
    (name: string, current: CamFraming, framingNeutral: CamFraming) => {
      const p = saveCustomFramingMotionFromCurrent(name, current, framingNeutral)
      refresh()
      return p
    },
    [refresh]
  )

  const rename = useCallback(
    (id: string, name: string) => {
      const ok = renameCustomFramingMotionPreset(id, name)
      if (ok) refresh()
      return ok
    },
    [refresh]
  )

  const remove = useCallback(
    (id: string) => {
      deleteCustomFramingMotionPreset(id)
      refresh()
    },
    [refresh]
  )

  const getPreset = useCallback(
    (id: string): FramingMotionPreset | CustomFramingMotionPreset | undefined => {
      return customPresets.find((p) => p.id === id) ?? builtinPresets.find((p) => p.id === id)
    },
    [customPresets, builtinPresets]
  )

  return {
    builtinPresets,
    builtinSimplePresets,
    builtinSequencePresets,
    customPresets,
    saveFromCurrent,
    rename,
    remove,
    getPreset,
    refresh
  }
}
