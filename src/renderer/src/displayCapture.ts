/** Prefijo de `cameraId` / clave en `streams` para captura local de pantalla o ventana (no WebRTC). */
export const DISPLAY_CAPTURE_ID_PREFIX = 'display-'

export function isDisplayCaptureId(id: string): boolean {
  return id.startsWith(DISPLAY_CAPTURE_ID_PREFIX)
}

export function defaultDisplayCaptureLabel(index: number): string {
  return index <= 1 ? 'Pantalla' : `Pantalla ${index}`
}

/** Etiqueta corta según lo que eligió el usuario en el picker del sistema. */
export function displayCaptureLabelFromTrack(track: MediaStreamTrack | undefined): string | null {
  const s = track?.getSettings?.()
  if (!s) return null
  const surface = (s as MediaTrackSettings & { displaySurface?: string }).displaySurface
  if (surface === 'monitor') return 'Pantalla completa'
  if (surface === 'window') return 'Ventana'
  if (surface === 'browser') return 'Pestaña'
  return null
}

export type DisplaySourceKind = 'screen' | 'window'

export type DisplaySourceOption = {
  id: string
  name: string
  thumbnailDataUrl: string
  kind: DisplaySourceKind
}

export function displaySourceKind(sourceId: string): DisplaySourceKind {
  return sourceId.startsWith('screen:') ? 'screen' : 'window'
}

/** Ajustes para que el track entregue fotogramas continuos (no solo el primero). */
export function configureDisplayCaptureVideoTrack(track: MediaStreamTrack): void {
  track.contentHint = 'motion'
  void track
    .applyConstraints({
      width: { ideal: 1920, max: 1920 },
      height: { ideal: 1080, max: 1080 },
      frameRate: { min: 15, ideal: 30, max: 30 }
    })
    .catch(() => {})
}

/** Ruta antigua Chromium/Electron (chromeMediaSource). */
async function acquireDesktopStreamLegacy(sourceId: string): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    audio: false,
    video: {
      // @ts-expect-error restricciones Chromium/Electron para captura de escritorio
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        minFrameRate: 15,
        maxFrameRate: 30,
        minWidth: 640,
        minHeight: 360,
        maxWidth: 1920,
        maxHeight: 1080
      }
    }
  }
  const stream = await navigator.mediaDevices.getUserMedia(constraints)
  const vt = stream.getVideoTracks()[0]
  if (vt) configureDisplayCaptureVideoTrack(vt)
  return stream
}

function isWindows(): boolean {
  return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
}

export type AcquireDesktopOptions = {
  /** Forzar ruta chromiumMediaSource (a veces mueve YouTube cuando getDisplayMedia queda congelado). */
  forceLegacy?: boolean
}

/**
 * En Windows + monitor completo, probamos primero la ruta legacy: con YouTube en Chrome
 * getDisplayMedia/WGC a menudo entrega un frame fijo.
 */
export async function acquireDesktopStreamFromSourceId(
  sourceId: string,
  opts?: AcquireDesktopOptions
): Promise<MediaStream> {
  const preferLegacyFirst =
    Boolean(opts?.forceLegacy) || (sourceId.startsWith('screen:') && isWindows())

  if (preferLegacyFirst) {
    try {
      return await acquireDesktopStreamLegacy(sourceId)
    } catch (e) {
      if (e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError')) {
        throw e
      }
    }
  }

  if (typeof window.studio?.setPendingDisplaySource === 'function') {
    await window.studio.setPendingDisplaySource(sourceId)
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: {
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { min: 15, ideal: 30, max: 30 }
        }
      })
      const vt = stream.getVideoTracks()[0]
      if (!vt) {
        stream.getTracks().forEach((t) => t.stop())
        throw new Error('Sin pista de vídeo en la captura.')
      }
      configureDisplayCaptureVideoTrack(vt)
      return stream
    } catch (e) {
      if (e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError')) {
        throw e
      }
    }
  }
  return acquireDesktopStreamLegacy(sourceId)
}
