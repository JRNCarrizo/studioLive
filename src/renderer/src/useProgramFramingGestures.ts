import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react'

import {
  applyProgramPinchPanStepWithCrop,
  applyProgramWheelWithCrop,
  CROP_FULL,
  dampPinchScaleFactor,
  type CamCrop
} from './programCrop'
import type { CamFraming } from './programFraming'
import { FRAMING_NEUTRAL } from './programFraming'

const PINCH_SESSION_MS = 200

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

export type ProgramFramingGesturesOpts = {
  enabled: boolean
  cameraId: string | null
  canvasRef: RefObject<HTMLCanvasElement | null>
  getVideo: (cameraId: string) => HTMLVideoElement | undefined
  getCrop: (cameraId: string) => CamCrop
  getFraming: (cameraId: string) => CamFraming
  applyFraming: (cameraId: string, next: CamFraming) => void
  rotateDeg: number
  stream?: MediaStream
  neutralFraming?: CamFraming
  programDragRef?: MutableRefObject<{ startX: number; startY: number; moved: boolean } | null>
}

export function useProgramFramingGestures({
  enabled,
  cameraId,
  canvasRef,
  getVideo,
  getCrop,
  getFraming,
  applyFraming,
  rotateDeg,
  stream,
  neutralFraming = FRAMING_NEUTRAL,
  programDragRef
}: ProgramFramingGesturesOpts) {
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

  const applyGestureFraming = useCallback(
    (next: CamFraming) => {
      if (!cameraId) return
      const cur = getFraming(cameraId)
      if (
        Math.abs(next.zoom - cur.zoom) < 1e-6 &&
        Math.abs(next.offsetX - cur.offsetX) < 1e-6 &&
        Math.abs(next.offsetY - cur.offsetY) < 1e-6
      ) {
        return
      }
      applyFraming(cameraId, next)
    },
    [applyFraming, cameraId, getFraming]
  )

  const handleProgramWheelEvent = useCallback(
    (e: {
      clientX: number
      clientY: number
      deltaX: number
      deltaY: number
      ctrlKey: boolean
      metaKey: boolean
    }) => {
      if (!enabled || !cameraId) return
      const canvas = canvasRef.current
      const v = getVideo(cameraId)
      if (!canvas || !v) return

      const pinch = e.ctrlKey || e.metaKey
      if (pinch || pinchSessionRef.current) bumpPinchSession()

      const crop = getCrop(cameraId) ?? CROP_FULL
      const cur = getFraming(cameraId) ?? neutralFraming
      const next = applyProgramWheelWithCrop({
        clientX: e.clientX,
        clientY: e.clientY,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        pinchSessionActive: pinchSessionRef.current,
        canvas,
        video: v,
        crop,
        cur,
        rotateDeg,
        stream
      })
      applyGestureFraming(next)
    },
    [
      applyGestureFraming,
      bumpPinchSession,
      cameraId,
      canvasRef,
      enabled,
      getCrop,
      getFraming,
      getVideo,
      neutralFraming,
      rotateDeg,
      stream
    ]
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !enabled || !cameraId) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      handleProgramWheelEvent(e)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (!enabled || !cameraId) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointersRef.current.size === 2) {
        if (programDragRef) programDragRef.current = null
        twoFingerRef.current = twoFingerFromPointers(pointersRef.current)
        bumpPinchSession()
        e.preventDefault()
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!enabled || !cameraId) return
      const map = pointersRef.current
      if (!map.has(e.pointerId)) return
      map.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (map.size !== 2) return

      const prev = twoFingerRef.current
      const curSnap = twoFingerFromPointers(map)
      if (!prev || !curSnap) return

      const v = getVideo(cameraId)
      if (!v) return
      const crop = getCrop(cameraId) ?? CROP_FULL
      const framing = getFraming(cameraId) ?? neutralFraming
      const rawScale = curSnap.dist / Math.max(1, prev.dist)
      const scaleFactor = dampPinchScaleFactor(rawScale)
      const panDx = curSnap.midX - prev.midX
      const panDy = curSnap.midY - prev.midY

      const next = applyProgramPinchPanStepWithCrop({
        clientX: curSnap.midX,
        clientY: curSnap.midY,
        scaleFactor,
        panDx,
        panDy,
        canvas,
        video: v,
        crop,
        cur: framing,
        rotateDeg,
        stream
      })
      applyGestureFraming(next)
      twoFingerRef.current = curSnap
      bumpPinchSession()
      e.preventDefault()
    }

    const releasePointer = (e: PointerEvent) => {
      pointersRef.current.delete(e.pointerId)
      try {
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      if (pointersRef.current.size < 2) twoFingerRef.current = null
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', releasePointer)
    canvas.addEventListener('pointercancel', releasePointer)

    return () => {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', releasePointer)
      canvas.removeEventListener('pointercancel', releasePointer)
      pointersRef.current.clear()
      twoFingerRef.current = null
      if (pinchTimerRef.current) clearTimeout(pinchTimerRef.current)
    }
  }, [
    applyGestureFraming,
    bumpPinchSession,
    cameraId,
    canvasRef,
    enabled,
    getCrop,
    getFraming,
    getVideo,
    handleProgramWheelEvent,
    neutralFraming,
    programDragRef,
    rotateDeg,
    stream
  ])

}
