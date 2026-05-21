import { useCallback, useEffect, useRef, useState } from 'react'

import {
  DEFAULT_PROGRAM_BACKGROUND,
  loadProgramBackground,
  loadProgramBackgroundImage,
  onProgramBackgroundImageLoaded,
  saveProgramBackground,
  type ProgramBackground
} from './programBackground'

export function useProgramBackground() {
  const [background, setBackgroundState] = useState<ProgramBackground>(() => loadProgramBackground())
  const [imageReadyTick, setImageReadyTick] = useState(0)
  const backgroundRef = useRef(background)

  useEffect(() => {
    backgroundRef.current = background
    saveProgramBackground(background)
  }, [background])

  useEffect(() => {
    return onProgramBackgroundImageLoaded(() => setImageReadyTick((t) => t + 1))
  }, [])

  useEffect(() => {
    if (background.mode === 'image' && background.imageUrl) {
      void loadProgramBackgroundImage(background.imageUrl)
    }
  }, [background.mode, background.imageUrl])

  const setBackground = useCallback((next: ProgramBackground) => {
    setBackgroundState(next)
    backgroundRef.current = next
    saveProgramBackground(next)
    if (next.mode === 'image' && next.imageUrl) {
      void loadProgramBackgroundImage(next.imageUrl)
    }
  }, [])

  const patchBackground = useCallback((patch: Partial<ProgramBackground>) => {
    setBackgroundState((prev) => {
      const next = { ...prev, ...patch }
      backgroundRef.current = next
      saveProgramBackground(next)
      if (next.mode === 'image' && next.imageUrl) {
        void loadProgramBackgroundImage(next.imageUrl)
      }
      return next
    })
  }, [])

  const resetBackground = useCallback(() => {
    const next = { ...DEFAULT_PROGRAM_BACKGROUND }
    setBackgroundState(next)
    backgroundRef.current = next
    saveProgramBackground(next)
  }, [])

  return { background, backgroundRef, setBackground, patchBackground, resetBackground, imageReadyTick }
}
