const STORAGE_KEY = 'studioLive.outputDir.v1'

export function readStoredOutputDir(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)?.trim()
    return v || null
  } catch {
    return null
  }
}

export function writeStoredOutputDir(dir: string | null): void {
  try {
    if (!dir) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    localStorage.setItem(STORAGE_KEY, dir)
  } catch {
    /* vacío */
  }
}
