import { useCallback, useEffect, useRef, useState } from 'react'

import {
  clientToCanvasNormalized,
  getLayout,
  hitTestLayoutSlotIndex,
  isLayoutCornerHandle,
  isLayoutEdgeCropHandle,
  layoutEditorRules,
  normalizedSlotPixelAspect,
  normalizedToSlotRects,
  transformLayoutSlotGeometry,
  translateNormalizedSlotRect,
  unionNormalizedSlotRects,
  type LayoutEdgeCropHandle,
  type LayoutId,
  type LayoutSlotHandle,
  type NormalizedSlotRect,
  type ProgramOrientation,
  type SlotRect
} from './programScenes'

type Props = {
  canvas: HTMLCanvasElement | null
  layoutId: LayoutId
  orientation: ProgramOrientation
  geometry: NormalizedSlotRect[]
  geometryCeiling: NormalizedSlotRect[]
  selectedSlotIndex: number
  slotCameraIds: (string | null)[]
  resolveAlias: (id: string) => string
  onSelectSlot: (index: number) => void
  onGeometryChange: (next: NormalizedSlotRect[]) => void
  onSlotCeilingChange?: (slotIndex: number, ceiling: NormalizedSlotRect) => void
  /** Al mover el recuadro, el techo (vídeo) debe ir con el marco. */
  onSlotCeilingTranslate?: (slotIndex: number, ceiling: NormalizedSlotRect) => void
  /** Último borde usado para recortar (anclaje del vídeo). null = limpiar. */
  onSlotEdgeCropHandle?: (slotIndex: number, handle: LayoutEdgeCropHandle | null) => void
  onSlotCropReset?: (slotIndex: number) => void
  onResetLayout: () => void
}

const HANDLE_CURSORS: Record<LayoutSlotHandle, string> = {
  move: 'move',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  sw: 'nesw-resize'
}

const CORNER_HANDLES: LayoutSlotHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const CORNERS_ONLY: LayoutSlotHandle[] = ['nw', 'ne', 'se', 'sw']

function pickHandle(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  rect: SlotRect,
  selected: boolean,
  cornerResizeOnly: boolean
): LayoutSlotHandle | null {
  if (!selected) return null
  const br = canvas.getBoundingClientRect()
  const sx = br.width / canvas.width
  const sy = br.height / canvas.height
  const left = br.left + rect.x * sx
  const top = br.top + rect.y * sy
  const w = rect.w * sx
  const h = rect.h * sy
  const x = clientX - left
  const y = clientY - top
  const corner = 16
  const edge = 10
  const onN = y >= -edge && y <= edge
  const onS = y >= h - edge && y <= h + edge
  const onW = x >= -edge && x <= edge
  const onE = x >= w - edge && x <= w + edge
  const nearNW = x <= corner && y <= corner
  const nearNE = x >= w - corner && y <= corner
  const nearSW = x <= corner && y >= h - corner
  const nearSE = x >= w - corner && y >= h - corner
  if (nearNW) return 'nw'
  if (nearNE) return 'ne'
  if (nearSW) return 'sw'
  if (nearSE) return 'se'
  if (!cornerResizeOnly) {
    if (onN && !nearNW && !nearNE) return 'n'
    if (onS && !nearSW && !nearSE) return 's'
    if (onW && !nearNW && !nearSW) return 'w'
    if (onE && !nearNE && !nearSE) return 'e'
  }
  if (x >= 0 && x <= w && y >= 0 && y <= h) return 'move'
  return null
}

function layoutEditorHint(layoutId: LayoutId): string {
  if (layoutId === 'sideBySide2') {
    return '2×: esquinas = marco con proporción · lados (celeste) = recortar el panel · centro = mover'
  }
  if (layoutId === 'pip') {
    return 'PIP: arrastrá o redimensioná el inserto · asigná cámara con la miniatura'
  }
  return 'Tocá un recuadro · arrastrá o redimensioná · asigná cámara con la miniatura'
}

function handleAnchor(id: LayoutSlotHandle): { lx: number; ly: number } {
  switch (id) {
    case 'nw':
      return { lx: 0, ly: 0 }
    case 'n':
      return { lx: 0.5, ly: 0 }
    case 'ne':
      return { lx: 1, ly: 0 }
    case 'e':
      return { lx: 1, ly: 0.5 }
    case 'se':
      return { lx: 1, ly: 1 }
    case 's':
      return { lx: 0.5, ly: 1 }
    case 'sw':
      return { lx: 0, ly: 1 }
    case 'w':
    default:
      return { lx: 0, ly: 0.5 }
  }
}

export function ProgramLayoutEditorOverlay({
  canvas,
  layoutId,
  orientation,
  geometry,
  geometryCeiling,
  selectedSlotIndex,
  slotCameraIds,
  resolveAlias,
  onSelectSlot,
  onGeometryChange,
  onSlotCeilingChange,
  onSlotCeilingTranslate,
  onSlotEdgeCropHandle,
  onSlotCropReset,
  onResetLayout
}: Props) {
  const [canvasRects, setCanvasRects] = useState<SlotRect[]>([])
  const dragRef = useRef<{
    handle: LayoutSlotHandle
    slotIndex: number
    startGeom: NormalizedSlotRect[]
    ceilingGeom: NormalizedSlotRect[]
    startU: number
    startV: number
    aspect: number
  } | null>(null)
  const lastGeomRef = useRef<NormalizedSlotRect[] | null>(null)

  const layout = getLayout(layoutId)
  const slotLabels = layout.slotLabels(orientation)
  const editorRules = layoutEditorRules(layoutId)
  const visibleHandles = editorRules.edgeCrop
    ? CORNER_HANDLES
    : editorRules.cornerResizeOnly
      ? CORNERS_ONLY
      : CORNER_HANDLES

  const measure = useCallback(() => {
    if (!canvas) {
      setCanvasRects([])
      return
    }
    setCanvasRects(normalizedToSlotRects(geometry, canvas.width, canvas.height))
  }, [canvas, geometry])

  useEffect(() => {
    measure()
    if (!canvas) return
    const ro = new ResizeObserver(measure)
    ro.observe(canvas)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [canvas, measure])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || !canvas) return
      const ptr = clientToCanvasNormalized(e.clientX, e.clientY, canvas)
      const du = ptr.u - drag.startU
      const dv = ptr.v - drag.startV

      const next = transformLayoutSlotGeometry(
        layoutId,
        drag.startGeom,
        drag.slotIndex,
        drag.handle,
        du,
        dv,
        canvas.width,
        canvas.height,
        drag.aspect,
        drag.ceilingGeom
      )
      onGeometryChange(next)
      lastGeomRef.current = next
      if (drag.handle === 'move' && onSlotCeilingTranslate) {
        const startC = drag.ceilingGeom[drag.slotIndex] ?? drag.startGeom[drag.slotIndex]
        if (startC) {
          onSlotCeilingTranslate(drag.slotIndex, translateNormalizedSlotRect(startC, du, dv))
        }
      }
      if (editorRules.edgeCrop && isLayoutEdgeCropHandle(drag.handle)) {
        onSlotEdgeCropHandle?.(drag.slotIndex, drag.handle)
      }
    }

    const onUp = () => {
      const drag = dragRef.current
      if (
        drag &&
        editorRules.edgeCrop &&
        isLayoutCornerHandle(drag.handle) &&
        onSlotCeilingChange &&
        lastGeomRef.current
      ) {
        const slot = lastGeomRef.current[drag.slotIndex]!
        const ceiling = drag.ceilingGeom[drag.slotIndex] ?? slot
        onSlotCeilingChange(drag.slotIndex, unionNormalizedSlotRects(ceiling, slot))
      }
      dragRef.current = null
      lastGeomRef.current = null
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [
    canvas,
    layoutId,
    editorRules.edgeCrop,
    onGeometryChange,
    onSlotCeilingChange,
    onSlotCeilingTranslate,
    onSlotEdgeCropHandle
  ])

  const onOverlayPointerDown = (e: React.PointerEvent) => {
    if (!canvas || canvasRects.length === 0) return
    e.preventDefault()
    e.stopPropagation()

    const selectedRect = canvasRects[selectedSlotIndex]
    const handleOnSelected =
      selectedRect != null
        ? pickHandle(
            e.clientX,
            e.clientY,
            canvas,
            selectedRect,
            true,
            editorRules.cornerResizeOnly
          )
        : null

    let slotIndex: number
    if (handleOnSelected != null) {
      slotIndex = selectedSlotIndex
    } else {
      const hit = hitTestLayoutSlotIndex(e.clientX, e.clientY, canvas, canvasRects)
      if (hit == null) return
      slotIndex = hit
      onSelectSlot(hit)
    }

    const handle =
      handleOnSelected ??
      pickHandle(e.clientX, e.clientY, canvas, canvasRects[slotIndex]!, true, editorRules.cornerResizeOnly) ??
      'move'
    const ptr = clientToCanvasNormalized(e.clientX, e.clientY, canvas)
    const startSlot = geometry[slotIndex]!
    if (editorRules.edgeCrop && isLayoutEdgeCropHandle(handle)) {
      onSlotEdgeCropHandle?.(slotIndex, handle)
    } else if (onSlotEdgeCropHandle) {
      onSlotEdgeCropHandle(slotIndex, null)
    }
    dragRef.current = {
      handle,
      slotIndex,
      startGeom: geometry.map((g) => ({ ...g })),
      ceilingGeom: geometryCeiling.map((g) => ({ ...g })),
      startU: ptr.u,
      startV: ptr.v,
      aspect: normalizedSlotPixelAspect(startSlot, canvas.width, canvas.height)
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  if (!canvas || canvasRects.length === 0) return null

  const handleSize = 9

  return (
    <div
      aria-hidden
      onPointerDown={onOverlayPointerDown}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        pointerEvents: 'auto',
        touchAction: 'none'
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 6,
          padding: '4px 10px',
          borderRadius: 8,
          background: 'rgba(2, 6, 23, 0.88)',
          border: '1px solid #334155',
          color: '#cbd5e1',
          fontSize: 10,
          lineHeight: 1.35,
          textAlign: 'center',
          maxWidth: '92%',
          pointerEvents: 'none'
        }}
      >
        {layoutEditorHint(layoutId)}
      </div>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onResetLayout()
        }}
        style={{
          position: 'absolute',
          bottom: 8,
          right: 8,
          zIndex: 6,
          padding: '3px 8px',
          borderRadius: 6,
          border: '1px solid #334155',
          background: '#0f172a',
          color: '#94a3b8',
          fontSize: 10,
          cursor: 'pointer'
        }}
      >
        Reset layout
      </button>
      {canvasRects.map((rect, i) => {
        const br = canvas.getBoundingClientRect()
        const sx = br.width / canvas.width
        const sy = br.height / canvas.height
        const left = rect.x * sx
        const top = rect.y * sy
        const width = rect.w * sx
        const height = rect.h * sy
        const selected = i === selectedSlotIndex
        const camId = slotCameraIds[i]
        const label = slotLabels[i] ?? `Slot ${i + 1}`
        const camLabel = camId ? resolveAlias(camId) : 'Sin cámara'

        return (
          <div
            key={`slot-${i}`}
            style={{
              position: 'absolute',
              left,
              top,
              width,
              height,
              boxSizing: 'border-box',
              border: selected ? '2px solid #a855f7' : '1px dashed rgba(148, 163, 184, 0.65)',
              boxShadow: selected ? '0 0 0 1px rgba(168, 85, 247, 0.35)' : undefined,
              background: selected ? 'rgba(168, 85, 247, 0.08)' : 'rgba(15, 23, 42, 0.12)',
              pointerEvents: 'none'
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 2,
                left: 4,
                right: 4,
                fontSize: 9,
                fontWeight: 700,
                color: selected ? '#e9d5ff' : '#94a3b8',
                textShadow: '0 1px 2px #000',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                pointerEvents: 'none'
              }}
            >
              {label} · {camLabel}
            </div>
            {selected
              ? visibleHandles.map((id) => {
                  const h = handleAnchor(id)
                  const edgeCrop = editorRules.edgeCrop && (id === 'n' || id === 's' || id === 'e' || id === 'w')
                  return (
                    <div
                      key={id}
                      style={{
                        position: 'absolute',
                        left: h.lx * width - handleSize / 2,
                        top: h.ly * height - handleSize / 2,
                        width: handleSize,
                        height: handleSize,
                        borderRadius: edgeCrop ? 999 : 2,
                        background: edgeCrop ? '#38bdf8' : '#a855f7',
                        border: edgeCrop ? '1px solid #0c4a6e' : '1px solid #581c87',
                        pointerEvents: 'none',
                        cursor: HANDLE_CURSORS[id]
                      }}
                    />
                  )
                })
              : null}
          </div>
        )
      })}
    </div>
  )
}



