import { useCallback, useEffect, useRef, useState } from 'react'

export function useFloatingPanelPosition(
  storageKey: string,
  defaultPos: () => { x: number; y: number }
) {
  const read = (): { x: number; y: number } => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return defaultPos()
      const o = JSON.parse(raw) as { x?: number; y?: number }
      if (typeof o.x === 'number' && typeof o.y === 'number') return { x: o.x, y: o.y }
    } catch {
      /* vacío */
    }
    return defaultPos()
  }

  const [pos, setPos] = useState(read)
  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ dx: number; dy: number; active: boolean } | null>(null)

  const clampPos = useCallback((x: number, y: number) => {
    const pad = 8
    const el = rootRef.current
    const w = el?.offsetWidth ?? 480
    const h = el?.offsetHeight ?? 160
    const maxX = Math.max(pad, window.innerWidth - w - pad)
    const maxY = Math.max(pad, window.innerHeight - h - pad)
    return {
      x: Math.min(maxX, Math.max(pad, x)),
      y: Math.min(maxY, Math.max(pad, y))
    }
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d?.active) return
      setPos(clampPos(e.clientX - d.dx, e.clientY - d.dy))
    }
    const onUp = () => {
      if (!dragRef.current?.active) return
      dragRef.current = null
      setPos((p) => {
        try {
          localStorage.setItem(storageKey, JSON.stringify(p))
        } catch {
          /* vacío */
        }
        return p
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [clampPos, storageKey])

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('button,input,select,option,a,label,[data-no-drag]')) return
      dragRef.current = { active: true, dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    },
    [pos.x, pos.y]
  )

  return { pos, rootRef, startDrag, clampPos, setPos }
}
