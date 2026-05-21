/** Grados de rotación manual (0, 90, 180, 270) como en Sesión en vivo. */
export function normalizeRotateDeg(deg: number): number {
  return ((deg % 360) + 360) % 360
}

export function isSidewaysRotation(deg: number): boolean {
  const n = normalizeRotateDeg(deg)
  return n === 90 || n === 270
}

/** Tamaño visible tras rotar (para letterbox / contain). */
export function displaySizeForVideo(
  vw: number,
  vh: number,
  rotateDeg: number
): { w: number; h: number } {
  if (!vw || !vh) return { w: vw, h: vh }
  return isSidewaysRotation(rotateDeg) ? { w: vh, h: vw } : { w: vw, h: vh }
}
