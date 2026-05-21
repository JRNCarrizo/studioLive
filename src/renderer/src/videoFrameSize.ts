/**
 * Dimensiones del frame para dibujar en canvas (misma lógica que las miniaturas en App.tsx).
 * En WebRTC, `videoWidth`/`videoHeight` del <video> a veces van en 16:9 mientras el track ya es retrato.
 */
export function getVideoFrameSize(
  video: HTMLVideoElement,
  stream?: MediaStream
): { vw: number; vh: number } {
  const track = stream?.getVideoTracks()[0]
  const s = track?.getSettings?.()
  let vw = 0
  let vh = 0
  if (s?.width && s?.height && s.width > 0 && s.height > 0) {
    vw = s.width
    vh = s.height
  }
  if (video.videoWidth > 0 && video.videoHeight > 0) {
    if (vw <= 0 || vh <= 0) {
      vw = video.videoWidth
      vh = video.videoHeight
    }
  } else if (vw <= 0 || vh <= 0) {
    vw = video.videoWidth
    vh = video.videoHeight
  }
  return { vw, vh }
}

/** Tamaño visible en programa (tras rotación manual ↻ de Sesión en vivo). */
export function getVideoFrameSizeForProgram(
  video: HTMLVideoElement,
  stream: MediaStream | undefined,
  rotateDeg: number
): { vw: number; vh: number } {
  const { vw, vh } = getVideoFrameSize(video, stream)
  if (!vw || !vh) return { vw, vh }
  const deg = ((rotateDeg % 360) + 360) % 360
  if (deg === 90 || deg === 270) return { vw: vh, vh: vw }
  return { vw, vh }
}
