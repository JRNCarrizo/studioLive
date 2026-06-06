/** Duración útil del elemento video (WebM de MediaRecorder suele devolver Infinity al principio). */
export function readVideoDurationSec(el: HTMLVideoElement): number | null {
  const d = el.duration
  if (Number.isFinite(d) && d > 0) return d
  if (el.seekable.length > 0) {
    const end = el.seekable.end(el.seekable.length - 1)
    if (Number.isFinite(end) && end > 0) return end
  }
  return null
}

/**
 * Fuerza lectura de duración en blobs WebM sin metadata de duración.
 * Técnica estándar: seek al final y leer duration / seekable.
 */
export function probeVideoDurationSec(el: HTMLVideoElement): Promise<number | null> {
  const immediate = readVideoDurationSec(el)
  if (immediate != null) return Promise.resolve(immediate)

  return new Promise((resolve) => {
    let settled = false
    const finish = (d: number | null) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(d)
    }

    const onUpdate = () => {
      const d = readVideoDurationSec(el)
      if (d != null) {
        try {
          el.currentTime = 0
        } catch {
          /* vacío */
        }
        finish(d)
      }
    }

    const cleanup = () => {
      el.removeEventListener('durationchange', onUpdate)
      el.removeEventListener('loadedmetadata', onUpdate)
      el.removeEventListener('loadeddata', onUpdate)
      el.removeEventListener('timeupdate', onUpdate)
      clearTimeout(timer)
    }

    el.addEventListener('durationchange', onUpdate)
    el.addEventListener('loadedmetadata', onUpdate)
    el.addEventListener('loadeddata', onUpdate)
    el.addEventListener('timeupdate', onUpdate)

    try {
      el.currentTime = 1e10
    } catch {
      /* vacío */
    }

    const timer = window.setTimeout(() => {
      const d = readVideoDurationSec(el)
      try {
        el.currentTime = 0
      } catch {
        /* vacío */
      }
      finish(d)
    }, 2500)
  })
}
