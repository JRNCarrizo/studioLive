import { useEffect, useRef } from 'react'

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** No disparar atajos mientras se escribe o con modificadores (copiar/pegar, etc.). */
export function shouldIgnoreFusionHotkey(e: KeyboardEvent): boolean {
  if (e.defaultPrevented) return true
  if (e.ctrlKey || e.metaKey || e.altKey) return true
  return isTypingTarget(e.target)
}

/** Espacio en un botón/enlace debe activar ese control, no el play del programa. */
function shouldIgnoreFusionPlayHotkey(e: KeyboardEvent): boolean {
  if (shouldIgnoreFusionHotkey(e)) return true
  const el = e.target
  if (!(el instanceof HTMLElement)) return false
  if (el.tagName === 'BUTTON' || el.tagName === 'A') return true
  return Boolean(el.closest('button, a, [role="button"]'))
}

/** Tecla `1`…`9` → índice 0…8 en la lista de cámaras del panel. */
export function digitKeyToCameraIndex(key: string): number | null {
  if (key.length !== 1) return null
  const code = key.charCodeAt(0)
  if (code < 49 || code > 57) return null
  return code - 49
}

export type FusionProgramHotkeyActions = {
  /** Pestaña de fusión visible (evita que el panel oculto capture teclas). */
  workspaceActive?: boolean
  enabled: boolean
  /** Modales / overlays que bloquean atajos (confirmaciones, config, vista previa, etc.). */
  blocked?: boolean
  cameraIds: string[]
  activeCameraId: string | null
  onAssignCamera: (cameraId: string) => void
  /** Fusión en vivo en director automático: no cambiar cámara con teclado. */
  manualDirectorOnly?: boolean
  onTogglePlay?: () => void
  canPlay?: boolean
  onRecordStart?: () => void
  onRecordStop?: () => void
  recording?: boolean
  canRecord?: boolean
}

export function handleFusionProgramHotkey(
  e: KeyboardEvent,
  actions: FusionProgramHotkeyActions
): void {
  if (actions.workspaceActive === false || !actions.enabled || actions.blocked) return
  if (shouldIgnoreFusionHotkey(e)) return

  const key = e.key

  const camIdx = digitKeyToCameraIndex(key)
  if (camIdx != null && !actions.manualDirectorOnly) {
    const id = actions.cameraIds[camIdx]
    if (id) {
      e.preventDefault()
      actions.onAssignCamera(id)
    }
    return
  }

  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    if (actions.manualDirectorOnly || actions.cameraIds.length === 0) return
    const cur = actions.activeCameraId
    let idx = cur ? actions.cameraIds.indexOf(cur) : -1
    if (idx < 0) idx = 0
    const delta = key === 'ArrowRight' ? 1 : -1
    const next = (idx + delta + actions.cameraIds.length) % actions.cameraIds.length
    const id = actions.cameraIds[next]
    if (id) {
      e.preventDefault()
      actions.onAssignCamera(id)
    }
    return
  }

  if (key === ' ' || key === 'Spacebar') {
    if (shouldIgnoreFusionPlayHotkey(e)) return
    if (!actions.onTogglePlay || !actions.canPlay) return
    e.preventDefault()
    actions.onTogglePlay()
    return
  }

  if (key === 'r' || key === 'R') {
    if (actions.recording) {
      if (actions.onRecordStop) {
        e.preventDefault()
        actions.onRecordStop()
      }
      return
    }
    if (actions.canRecord && actions.onRecordStart) {
      e.preventDefault()
      actions.onRecordStart()
    }
  }
}

export function useFusionProgramHotkeys(actions: FusionProgramHotkeyActions): void {
  const ref = useRef(actions)
  ref.current = actions

  useEffect(() => {
    if (!actions.enabled) return
    const onKey = (e: KeyboardEvent) => handleFusionProgramHotkey(e, ref.current)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    actions.workspaceActive,
    actions.enabled,
    actions.blocked,
    actions.cameraIds.join('\n'),
    actions.activeCameraId,
    actions.manualDirectorOnly,
    actions.canPlay,
    actions.canRecord,
    actions.recording
  ])
}
