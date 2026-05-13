import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'studioLive.cameraAliases.v1'
const EVENT_NAME = 'studio-live:camera-aliases-changed'

type AliasMap = Record<string, string>

function readAll(): AliasMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const o = JSON.parse(raw) as unknown
    if (!o || typeof o !== 'object') return {}
    const out: AliasMap = {}
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function writeAll(map: AliasMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* vacío */
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME))
  } catch {
    /* vacío */
  }
}

export function setCameraAlias(cameraId: string, alias: string | null) {
  const all = readAll()
  const trimmed = (alias ?? '').trim()
  if (!trimmed) {
    if (cameraId in all) {
      delete all[cameraId]
      writeAll(all)
    }
    return
  }
  if (all[cameraId] === trimmed) return
  all[cameraId] = trimmed
  writeAll(all)
}

export function getCameraAlias(cameraId: string): string | null {
  const all = readAll()
  return all[cameraId] ?? null
}

export type AliasResolver = (cameraId: string) => string

/**
 * Hook que devuelve un mapa reactivo de alias y un resolver que cae al cameraId si no hay alias.
 * Se actualiza ante cambios en otras tabs (storage event) o desde el mismo proceso (custom event).
 */
export function useCameraAliases(): {
  aliases: AliasMap
  resolve: AliasResolver
  setAlias: (cameraId: string, alias: string | null) => void
} {
  const [aliases, setAliases] = useState<AliasMap>(() => readAll())

  useEffect(() => {
    const refresh = () => setAliases(readAll())
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) refresh()
    }
    window.addEventListener(EVENT_NAME, refresh as EventListener)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(EVENT_NAME, refresh as EventListener)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const resolve = useCallback<AliasResolver>(
    (cameraId: string) => aliases[cameraId] ?? cameraId,
    [aliases]
  )

  const setAlias = useCallback((cameraId: string, alias: string | null) => {
    setCameraAlias(cameraId, alias)
  }, [])

  return { aliases, resolve, setAlias }
}
