import { useCallback, useEffect, useState } from 'react'

import {
  loadFramingMotionSettings,
  saveFramingMotionSettings,
  type FramingMotionSettings
} from './framingMotionPresetsStorage'

export function useFramingMotionSettings() {
  const [settings, setSettings] = useState<FramingMotionSettings>(() => loadFramingMotionSettings())

  useEffect(() => {
    saveFramingMotionSettings(settings)
  }, [settings])

  const setSpeed = useCallback((speed: number) => {
    setSettings((s) => ({ ...s, speed }))
  }, [])

  const setIntensity = useCallback((intensity: number) => {
    setSettings((s) => ({ ...s, intensity }))
  }, [])

  return { settings, setSpeed, setIntensity }
}
