const STORAGE_KEY = 'studioLive.excludeFromCapture.v1'

export function readStoredExcludeFromCapture(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function writeStoredExcludeFromCapture(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    /* vacío */
  }
}
