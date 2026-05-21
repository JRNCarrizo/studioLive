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

/** Stream de escritorio vía `desktopCapturer` (Electron); no usa `getDisplayMedia`. */
export async function acquireDesktopStreamFromSourceId(sourceId: string): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    audio: false,
    video: {
      // @ts-expect-error restricciones Chromium/Electron para captura de escritorio
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        minFrameRate: 15,
        maxFrameRate: 30,
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
