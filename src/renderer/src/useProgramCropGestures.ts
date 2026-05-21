import { useCallback, useEffect, useRef, type RefObject } from 'react'

import {
  applyCropPinchPanStep,
  applyCropWheelGesture,
  clampCrop,
  type CamCrop
} from './programCrop'

const PINCH_SESSION_MS = 200

type LetterboxCss = { width: number; height: number }

type TwoFingerSnap = { dist: number; midX: number; midY: number }

function twoFingerFromPointers(pointers: Map<number, { x: number; y: number }>): TwoFingerSnap | null {
  if (pointers.size !== 2) return null
  const pts = [...pointers.values()]
  const a = pts[0]!
  const b = pts[1]!
  return {
    dist: Math.hypot(b.x - a.x, b.y - a.y),
    midX: (a.x + b.x) / 2,
    midY: (a.y + b.y) / 2
  }
}

export type ProgramCropGesturesOpts = {
  overlayRef: RefObject<HTMLDivElement | null>
  canvas: HTMLCanvasElement | null
  video: HTMLVideoElement | null
  stream?: MediaStream
  crop: CamCrop
  rotateDeg: number
  lbCss: LetterboxCss | null
  onCropChange: (next: CamCrop) => void
}

export function useProgramCropGestures({
  overlayRef,
  canvas,
  video,
  stream,
  crop,
  rotateDeg,
  lbCss,
  onCropChange
}: ProgramCropGesturesOpts) {
  const pinchSessionRef = useRef(false)
  const pinchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const twoFingerRef = useRef<TwoFingerSnap | null>(null)

  const bumpPinchSession = useCallback(() => {
    pinchSessionRef.current = true
    if (pinchTimerRef.current) clearTimeout(pinchTimerRef.current)
    pinchTimerRef.current = setTimeout(() => {
      pinchSessionRef.current = false
    }, PINCH_SESSION_MS)
  }, [])

  const applyCropIfChanged = useCallback(
    (next: CamCrop) => {
      const a = clampCrop(crop)
      const b = clampCrop(next)
      if (
        Math.abs(a.left - b.left) < 1e-6 &&
        Math.abs(a.top - b.top) < 1e-6 &&
        Math.abs(a.right - b.right) < 1e-6 &&
        Math.abs(a.bottom - b.bottom) < 1e-6
      ) {
        return
      }
      onCropChange(b)
    },
    [crop, onCropChange]
  )

  const handleCropWheelEvent = useCallback(
    (e: {
      clientX: number
      clientY: number
      deltaX: number
      deltaY: number
      ctrlKey: boolean
      metaKey: boolean
    }) => {
      if (!canvas || !video || !lbCss) return

      const pinch = e.ctrlKey || e.metaKey
      if (pinch || pinchSessionRef.current) bumpPinchSession()

      const next = applyCropWheelGesture({
        crop,
        rotateDeg,
        clientX: e.clientX,
        clientY: e.clientY,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        lbWidth: lbCss.width,
        lbHeight: lbCss.height,
        canvas,
        video,
        stream
      })
      applyCropIfChanged(next)
    },
    [applyCropIfChanged, bumpPinchSession, canvas, crop, lbCss, rotateDeg, stream, video]
  )

  const onOverlayWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      handleCropWheelEvent(e)
    },
    [handleCropWheelEvent]
  )

  useEffect(() => {
    const el = overlayRef.current
    if (!el || !canvas || !video || !lbCss) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      handleCropWheelEvent(e)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointersRef.current.size === 2) {
        twoFingerRef.current = twoFingerFromPointers(pointersRef.current)
        bumpPinchSession()
        e.preventDefault()
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const map = pointersRef.current
      if (!map.has(e.pointerId)) return
      map.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (map.size !== 2) return

      const prev = twoFingerRef.current
      const curSnap = twoFingerFromPointers(map)
      if (!prev || !curSnap) return

      const scaleFactor = curSnap.dist / Math.max(1, prev.dist)
      const panDxCss = curSnap.midX - prev.midX
      const panDyCss = curSnap.midY - prev.midY

      const next = applyCropPinchPanStep({
        crop,
        rotateDeg,
        clientX: curSnap.midX,
        clientY: curSnap.midY,
        scaleFactor,
        panDxCss,
        panDyCss,
        lbWidth: lbCss.width,
        lbHeight: lbCss.height,
        canvas,
        video,
        stream
      })
      applyCropIfChanged(next)
      twoFingerRef.current = curSnap
      bumpPinchSession()
      e.preventDefault()
    }

    const releasePointer = (e: PointerEvent) => {
      pointersRef.current.delete(e.pointerId)
      try {
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      if (pointersRef.current.size < 2) twoFingerRef.current = null
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', releasePointer)
    el.addEventListener('pointercancel', releasePointer)

    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', releasePointer)
      el.removeEventListener('pointercancel', releasePointer)
      pointersRef.current.clear()
      twoFingerRef.current = null
      if (pinchTimerRef.current) clearTimeout(pinchTimerRef.current)
    }
  }, [
    applyCropIfChanged,
    bumpPinchSession,
    canvas,
    crop,
    handleCropWheelEvent,
    lbCss,
    overlayRef,
    rotateDeg,
    stream,
    video
  ])

  return { onOverlayWheel }
}
