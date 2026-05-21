import { useCallback, useEffect, useRef, useState } from 'react'

import {
  clampCrop,
  clientToFullVideoNormalized,
  cropToDisplayRect,
  getVideoLetterboxForElement,
  type CamCrop
} from './programCrop'
import { useProgramCropGestures } from './useProgramCropGestures'

export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move'

type Props = {
  canvas: HTMLCanvasElement | null
  video: HTMLVideoElement | null
  stream?: MediaStream
  crop: CamCrop
  rotateDeg?: number
  onCropChange: (next: CamCrop) => void
}

type LetterboxCss = { left: number; top: number; width: number; height: number }

function letterboxToCss(canvas: HTMLCanvasElement, lb: { x: number; y: number; w: number; h: number }): LetterboxCss {
  const br = canvas.getBoundingClientRect()
  const sx = br.width / canvas.width
  const sy = br.height / canvas.height
  return {
    left: lb.x * sx,
    top: lb.y * sy,
    width: lb.w * sx,
    height: lb.h * sy
  }
}

const HANDLE_CURSORS: Record<CropHandle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  sw: 'nesw-resize',
  move: 'move'
}

export function ProgramCropOverlay({
  canvas,
  video,
  stream,
  crop,
  rotateDeg = 0,
  onCropChange
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [lbCss, setLbCss] = useState<LetterboxCss | null>(null)
  const dragRef = useRef<{
    handle: CropHandle
    startCrop: CamCrop
    startNx: number
    startNy: number
  } | null>(null)

  const { onOverlayWheel } = useProgramCropGestures({
    overlayRef,
    canvas,
    video,
    stream,
    crop,
    rotateDeg,
    lbCss,
    onCropChange
  })

  const measure = useCallback(() => {
    if (!canvas || !video?.videoWidth) {
      setLbCss(null)
      return
    }
    const lb = getVideoLetterboxForElement(canvas, video, rotateDeg, stream)
    if (!lb) {
      setLbCss(null)
      return
    }
    setLbCss(letterboxToCss(canvas, lb))
  }, [canvas, video, rotateDeg, stream])

  useEffect(() => {
    measure()
    if (!canvas) return
    const ro = new ResizeObserver(measure)
    ro.observe(canvas)
    window.addEventListener('resize', measure)
    const id = window.setInterval(measure, 400)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
      window.clearInterval(id)
    }
  }, [canvas, video, stream, measure, crop, rotateDeg])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || !canvas || !video) return
      const ptr = clientToFullVideoNormalized(e.clientX, e.clientY, canvas, video, rotateDeg, stream)
      if (!ptr) return
      const dnx = ptr.nx - drag.startNx
      const dny = ptr.ny - drag.startNy
      const s = drag.startCrop
      let next: CamCrop = { ...s }

      if (drag.handle === 'move') {
        const w = s.right - s.left
        const h = s.bottom - s.top
        let left = s.left + dnx
        let top = s.top + dny
        left = Math.max(0, Math.min(1 - w, left))
        top = Math.max(0, Math.min(1 - h, top))
        next = { left, top, right: left + w, bottom: top + h }
      } else {
        const h = drag.handle
        if (h === 'w' || h === 'nw' || h === 'sw') next.left = s.left + dnx
        if (h === 'e' || h === 'ne' || h === 'se') next.right = s.right + dnx
        if (h === 'n' || h === 'nw' || h === 'ne') next.top = s.top + dny
        if (h === 's' || h === 'sw' || h === 'se') next.bottom = s.bottom + dny
      }
      onCropChange(clampCrop(next))
    }

    const onUp = () => {
      dragRef.current = null
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [canvas, video, stream, rotateDeg, onCropChange])

  const startDrag = (handle: CropHandle) => (e: React.PointerEvent) => {
    if (!canvas || !video) return
    e.preventDefault()
    e.stopPropagation()
    const ptr = clientToFullVideoNormalized(e.clientX, e.clientY, canvas, video, rotateDeg, stream)
    if (!ptr) return
    dragRef.current = { handle, startCrop: clampCrop(crop), startNx: ptr.nx, startNy: ptr.ny }
  }

  if (!lbCss) return null

  const disp = cropToDisplayRect(crop, rotateDeg)
  const boxLeft = disp.left * lbCss.width
  const boxTop = disp.top * lbCss.height
  const boxW = (disp.right - disp.left) * lbCss.width
  const boxH = (disp.bottom - disp.top) * lbCss.height

  const handleSize = 10
  const handles: { id: CropHandle; left: number; top: number }[] = [
    { id: 'nw', left: 0, top: 0 },
    { id: 'n', left: 0.5, top: 0 },
    { id: 'ne', left: 1, top: 0 },
    { id: 'e', left: 1, top: 0.5 },
    { id: 'se', left: 1, top: 1 },
    { id: 's', left: 0.5, top: 1 },
    { id: 'sw', left: 0, top: 1 },
    { id: 'w', left: 0, top: 0.5 }
  ]

  return (
    <div
      ref={overlayRef}
      aria-hidden
      title="Pellizco y mover a la vez (sin soltar); también arrastrá bordes del marco"
      onWheel={onOverlayWheel}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 3,
        pointerEvents: 'auto',
        touchAction: 'none'
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: lbCss.left,
          top: lbCss.top,
          width: lbCss.width,
          height: lbCss.height
        }}
      >
        <div
          onPointerDown={startDrag('move')}
          style={{
            position: 'absolute',
            left: boxLeft,
            top: boxTop,
            width: boxW,
            height: boxH,
            border: '2px solid #38bdf8',
            boxSizing: 'border-box',
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
            cursor: 'move'
          }}
        />
        {handles.map((h) => (
          <div
            key={h.id}
            onPointerDown={startDrag(h.id)}
            style={{
              position: 'absolute',
              left: boxLeft + h.left * boxW - handleSize / 2,
              top: boxTop + h.top * boxH - handleSize / 2,
              width: handleSize,
              height: handleSize,
              borderRadius: 2,
              background: '#38bdf8',
              border: '1px solid #0c4a6e',
              cursor: HANDLE_CURSORS[h.id],
              zIndex: 1
            }}
          />
        ))}
      </div>
    </div>
  )
}