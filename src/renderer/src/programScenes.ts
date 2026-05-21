/**
 * Definiciones compartidas para la "escena del programa" en Fusión por archivos y Fusión en vivo:
 *  - Layouts (1×, 2×, PIP, 2×2, 1+2) con rects orientation-aware.
 *  - Asignaciones por formato (qué cámaras van en qué slots).
 *  - Orientación de salida (Horizontal / Vertical / Cuadrado).
 *  - Helpers para serializar/parsear escenas en el EDL y para formatear etiquetas con alias.
 *
 * Importante: para layout 'single' la firma de la escena es el cameraId pelado, así que el formato
 * de plan/EDL existente sigue siendo compatible con grabaciones previas.
 */

export type ProgramOrientation = 'landscape' | 'portrait' | 'square'

export const CANVAS_DIMS: Record<ProgramOrientation, { w: number; h: number }> = {
  landscape: { w: 1280, h: 720 },
  portrait: { w: 720, h: 1280 },
  square: { w: 1080, h: 1080 }
}

export const ORIENTATION_LABEL: Record<ProgramOrientation, string> = {
  landscape: 'Horizontal 16:9',
  portrait: 'Vertical 9:16',
  square: 'Cuadrado 1:1'
}

/** Heurística simple: orientación sugerida según relación de aspecto medida. */
export function aspectToOrientation(w: number, h: number): ProgramOrientation {
  if (!w || !h) return 'landscape'
  const r = w / h
  if (r > 1.15) return 'landscape'
  if (r < 0.85) return 'portrait'
  return 'square'
}

export type SlotRect = { x: number; y: number; w: number; h: number }

export type LayoutId = 'single' | 'sideBySide2' | 'pip' | 'grid2x2' | 'oneBigTwoSmall'

export type ProgramScene = { layoutId: LayoutId; slots: (string | null)[] }

export type LayoutPreset = {
  id: LayoutId
  label: string
  short: string
  slotsCount: number
  rects: (cw: number, ch: number) => SlotRect[]
  slotLabels: (orientation: ProgramOrientation) => readonly string[]
}

/**
 * Las funciones de rects detectan la orientación leyendo la relación del canvas (`cw` vs `ch`)
 * y devuelven los slots con la proporción de pantalla apropiada:
 *  - Horizontal (cw > ch): cada slot suele ser 16:9.
 *  - Vertical (cw < ch): cada slot suele ser 9:16 (perfecto para celular en portrait).
 *  - Cuadrado: se elige una distribución equilibrada.
 *
 * En todos los casos las "barras" sobrantes quedan en negro (el canvas se limpia en `#000`).
 */
export const PROGRAM_LAYOUTS: ReadonlyArray<LayoutPreset> = [
  {
    id: 'single',
    label: '1 cámara (clásico)',
    short: '1×',
    slotsCount: 1,
    rects: (cw, ch) => [{ x: 0, y: 0, w: cw, h: ch }],
    slotLabels: () => ['Cámara']
  },
  {
    id: 'sideBySide2',
    label: 'Pantalla partida 2',
    short: '2×',
    slotsCount: 2,
    rects: (cw, ch) => {
      if (cw >= ch) {
        const slotW = Math.floor(cw / 2)
        const slotH = Math.round((slotW * 9) / 16)
        const cappedH = Math.min(slotH, ch)
        const y = Math.max(0, Math.round((ch - cappedH) / 2))
        return [
          { x: 0, y, w: slotW, h: cappedH },
          { x: slotW, y, w: cw - slotW, h: cappedH }
        ]
      }
      const slotH = Math.floor(ch / 2)
      const slotW = Math.round((slotH * 9) / 16)
      const cappedW = Math.min(slotW, cw)
      const x = Math.max(0, Math.round((cw - cappedW) / 2))
      return [
        { x, y: 0, w: cappedW, h: slotH },
        { x, y: slotH, w: cappedW, h: ch - slotH }
      ]
    },
    slotLabels: (o) => (o === 'portrait' ? ['Superior', 'Inferior'] : ['Izquierda', 'Derecha'])
  },
  {
    id: 'pip',
    label: 'PIP (1 grande + 1 chica)',
    short: 'PIP',
    slotsCount: 2,
    rects: (cw, ch) => {
      const margin = Math.max(8, Math.round(Math.min(cw, ch) * 0.022))
      const ratio = cw / ch
      const sw = Math.round(Math.min(cw, ch) * 0.32)
      const sh = Math.round(sw / ratio)
      return [
        { x: 0, y: 0, w: cw, h: ch },
        { x: cw - sw - margin, y: ch - sh - margin, w: sw, h: sh }
      ]
    },
    slotLabels: () => ['Principal', 'Inserto']
  },
  {
    id: 'grid2x2',
    label: 'Cuadrícula 2×2',
    short: '2×2',
    slotsCount: 4,
    rects: (cw, ch) => {
      const w = Math.floor(cw / 2)
      const h = Math.floor(ch / 2)
      return [
        { x: 0, y: 0, w, h },
        { x: w, y: 0, w: cw - w, h },
        { x: 0, y: h, w, h: ch - h },
        { x: w, y: h, w: cw - w, h: ch - h }
      ]
    },
    slotLabels: () => ['Sup. izq.', 'Sup. der.', 'Inf. izq.', 'Inf. der.']
  },
  {
    id: 'oneBigTwoSmall',
    label: '1 grande + 2 chicas',
    short: '1+2',
    slotsCount: 3,
    rects: (cw, ch) => {
      if (cw >= ch) {
        const sideW = Math.round(cw * 0.25)
        const sideH = Math.round((sideW * 9) / 16)
        const mainW = cw - sideW
        const mainH = Math.round((mainW * 9) / 16)
        const cappedMainH = Math.min(mainH, ch)
        const mainY = Math.max(0, Math.round((ch - cappedMainH) / 2))
        const sideX = mainW
        const topY = mainY
        const botY = mainY + cappedMainH - sideH
        return [
          { x: 0, y: mainY, w: mainW, h: cappedMainH },
          { x: sideX, y: topY, w: sideW, h: sideH },
          { x: sideX, y: botY, w: sideW, h: sideH }
        ]
      }
      const sideH = Math.round(ch * 0.25)
      const sideW = Math.round((sideH * 9) / 16)
      const mainH = ch - sideH
      const mainW = Math.round((mainH * 9) / 16)
      const cappedMainW = Math.min(mainW, cw)
      const mainX = Math.max(0, Math.round((cw - cappedMainW) / 2))
      const sideY = mainH
      const leftX = mainX
      const rightX = mainX + cappedMainW - sideW
      return [
        { x: mainX, y: 0, w: cappedMainW, h: mainH },
        { x: leftX, y: sideY, w: sideW, h: sideH },
        { x: rightX, y: sideY, w: sideW, h: sideH }
      ]
    },
    slotLabels: (o) =>
      o === 'portrait' ? ['Principal', 'Inf. izq.', 'Inf. der.'] : ['Principal', 'Sup. der.', 'Inf. der.']
  }
] as const

export function getLayout(id: LayoutId): LayoutPreset {
  return PROGRAM_LAYOUTS.find((p) => p.id === id) ?? PROGRAM_LAYOUTS[0]!
}

const SCENE_SLOT_EMPTY = '∅'

export function sceneSignature(scene: ProgramScene): string {
  if (scene.layoutId === 'single') return scene.slots[0] ?? ''
  return `${scene.layoutId}|${scene.slots.map((x) => x ?? SCENE_SLOT_EMPTY).join('+')}`
}

export function parseSceneSignature(sig: string): ProgramScene {
  if (!sig) return { layoutId: 'single', slots: [null] }
  const idx = sig.indexOf('|')
  if (idx < 0) return { layoutId: 'single', slots: [sig] }
  const rawId = sig.slice(0, idx)
  const layout = PROGRAM_LAYOUTS.find((p) => p.id === rawId)
  const layoutId = (layout?.id ?? 'single') as LayoutId
  const rest = sig.slice(idx + 1)
  const slots = rest.split('+').map((x) => (x === SCENE_SLOT_EMPTY || x === '' ? null : x))
  const wantedCount = (layout ?? getLayout('single')).slotsCount
  while (slots.length < wantedCount) slots.push(null)
  return { layoutId, slots: slots.slice(0, wantedCount) }
}

export function formatSceneLabel(sig: string, resolveAlias: (id: string) => string): string {
  const sc = parseSceneSignature(sig)
  const layout = getLayout(sc.layoutId)
  const cams = sc.slots.map((s) => (s ? resolveAlias(s) : '—'))
  if (sc.layoutId === 'single') return cams[0] ?? '—'
  return `${layout.short}: ${cams.join(' · ')}`
}

export type LayoutAssignments = Record<LayoutId, (string | null)[]>

/** Asigna automáticamente cámaras distintas (en la medida que haya) a cada slot de cada layout. */
export function buildDefaultLayoutAssignments(camIds: readonly string[]): LayoutAssignments {
  const out = {} as LayoutAssignments
  for (const layout of PROGRAM_LAYOUTS) {
    const slots: (string | null)[] = []
    const used = new Set<string>()
    for (let i = 0; i < layout.slotsCount; i++) {
      const next = camIds.find((id) => !used.has(id)) ?? camIds[0] ?? null
      if (next) used.add(next)
      slots.push(next)
    }
    out[layout.id] = slots
  }
  return out
}

/**
 * Sincroniza las asignaciones existentes con la lista de cámaras vigente:
 *  - Si una cámara ya no existe, la reemplaza por la primera disponible aún libre en ese layout.
 *  - Si quedan slots vacíos y hay cámaras libres, los rellena.
 *  - Mantiene las elecciones manuales que sigan siendo válidas.
 */
export function reconcileLayoutAssignments(
  prev: LayoutAssignments,
  camIds: readonly string[]
): LayoutAssignments {
  const next = { ...prev }
  let changed = false
  for (const layout of PROGRAM_LAYOUTS) {
    const cur = prev[layout.id] ?? []
    const slots: (string | null)[] = []
    const used = new Set<string>()
    let layoutChanged = cur.length !== layout.slotsCount
    for (let i = 0; i < layout.slotsCount; i++) {
      const wanted = cur[i] ?? null
      if (wanted && camIds.includes(wanted) && !used.has(wanted)) {
        slots.push(wanted)
        used.add(wanted)
        continue
      }
      const repl = camIds.find((id) => !used.has(id)) ?? null
      if (repl) used.add(repl)
      slots.push(repl)
      if (repl !== wanted) layoutChanged = true
    }
    if (layoutChanged) {
      next[layout.id] = slots
      changed = true
    }
  }
  return changed ? next : prev
}

/** Rectángulo de slot en coordenadas normalizadas 0..1 del canvas de programa. */
export type NormalizedSlotRect = { x: number; y: number; w: number; h: number }

export type LayoutGeometryMap = Partial<Record<LayoutId, NormalizedSlotRect[]>>

export const LAYOUT_SLOT_MIN_SPAN = 0.07

export function clampNormalizedSlotRect(r: NormalizedSlotRect): NormalizedSlotRect {
  let { x, y, w, h } = r
  w = Math.max(LAYOUT_SLOT_MIN_SPAN, Math.min(1, w))
  h = Math.max(LAYOUT_SLOT_MIN_SPAN, Math.min(1, h))
  x = Math.max(0, Math.min(1 - w, x))
  y = Math.max(0, Math.min(1 - h, y))
  return { x, y, w, h }
}

export function presetLayoutGeometry(layoutId: LayoutId, cw: number, ch: number): NormalizedSlotRect[] {
  return getLayout(layoutId)
    .rects(cw, ch)
    .map((r) => clampNormalizedSlotRect({ x: r.x / cw, y: r.y / ch, w: r.w / cw, h: r.h / ch }))
}

export function normalizedToSlotRects(norm: readonly NormalizedSlotRect[], cw: number, ch: number): SlotRect[] {
  return norm.map((n) => {
    const c = clampNormalizedSlotRect(n)
    return {
      x: Math.round(c.x * cw),
      y: Math.round(c.y * ch),
      w: Math.round(c.w * cw),
      h: Math.round(c.h * ch)
    }
  })
}

export function resolveLayoutSlotRects(
  layoutId: LayoutId,
  cw: number,
  ch: number,
  geometry?: readonly NormalizedSlotRect[] | null
): SlotRect[] {
  const layout = getLayout(layoutId)
  const preset = presetLayoutGeometry(layoutId, cw, ch)
  if (!geometry || geometry.length !== layout.slotsCount) {
    return normalizedToSlotRects(preset, cw, ch)
  }
  return normalizedToSlotRects(geometry, cw, ch)
}

export function clientToCanvasNormalized(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement
): { u: number; v: number } {
  const br = canvas.getBoundingClientRect()
  return {
    u: Math.min(1, Math.max(0, (clientX - br.left) / br.width)),
    v: Math.min(1, Math.max(0, (clientY - br.top) / br.height))
  }
}

/** Slot superior en Z (índice mayor = encima, p. ej. PIP chico). */
export function hitTestLayoutSlotIndex(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  rects: readonly SlotRect[]
): number | null {
  const { u, v } = clientToCanvasNormalized(clientX, clientY, canvas)
  const px = u * canvas.width
  const py = v * canvas.height
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i]!
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return i
  }
  return null
}

/** Tras elegir un layout multi-slot, qué recuadro conviene preseleccionar. */
export function defaultEditableSlotIndex(layoutId: LayoutId): number {
  if (layoutId === 'pip') return 1
  return 0
}

export const LAYOUT_SLOT_MIN_GAP = 0.004

export type LayoutSlotHandle =
  | 'move'
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw'

export function layoutEditorRules(layoutId: LayoutId): {
  lockAspect: boolean
  preventOverlap: boolean
  cornerResizeOnly: boolean
  edgeCrop: boolean
} {
  if (layoutId === 'sideBySide2') {
    return { lockAspect: true, preventOverlap: true, cornerResizeOnly: false, edgeCrop: true }
  }
  if (layoutId === 'pip') {
    return { lockAspect: false, preventOverlap: false, cornerResizeOnly: false, edgeCrop: false }
  }
  return { lockAspect: false, preventOverlap: true, cornerResizeOnly: false, edgeCrop: false }
}

export function isLayoutCornerHandle(handle: LayoutSlotHandle): boolean {
  return handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw'
}

export function isLayoutEdgeCropHandle(handle: LayoutSlotHandle): boolean {
  return handle === 'n' || handle === 's' || handle === 'e' || handle === 'w'
}

/** Límite máximo al que un slot puede volver al “des-recortar” con los lados. */
export function clampSlotWithinCeiling(slot: NormalizedSlotRect, ceiling: NormalizedSlotRect): NormalizedSlotRect {
  const minW = LAYOUT_SLOT_MIN_SPAN
  const minH = LAYOUT_SLOT_MIN_SPAN
  let x = Math.max(ceiling.x, Math.min(slot.x, ceiling.x + ceiling.w - minW))
  let y = Math.max(ceiling.y, Math.min(slot.y, ceiling.y + ceiling.h - minH))
  let right = Math.min(ceiling.x + ceiling.w, Math.max(slot.x + slot.w, ceiling.x + minW))
  let bottom = Math.min(ceiling.y + ceiling.h, Math.max(slot.y + slot.h, ceiling.y + minH))
  if (right - x < minW) {
    x = ceiling.x
    right = ceiling.x + minW
  }
  if (bottom - y < minH) {
    y = ceiling.y
    bottom = ceiling.y + minH
  }
  return clampNormalizedSlotRect({ x, y, w: right - x, h: bottom - y })
}

/**
 * Recorta o recupera un solo lado del marco (los otros bordes quedan fijos al techo del arrastre).
 * Sin esto, al llegar al tamaño mínimo el clamp simétrico “comía” el costado opuesto.
 */
export function cropNormalizedSlotFromEdge(
  start: NormalizedSlotRect,
  handle: LayoutSlotHandle,
  du: number,
  dv: number,
  ceiling: NormalizedSlotRect
): NormalizedSlotRect {
  const ceil = clampNormalizedSlotRect(ceiling)
  const cL = ceil.x
  const cT = ceil.y
  const cR = ceil.x + ceil.w
  const cB = ceil.y + ceil.h
  const anchorR = start.x + start.w
  const anchorB = start.y + start.h
  const min = LAYOUT_SLOT_MIN_SPAN

  let x = start.x
  let y = start.y
  let w = start.w
  let h = start.h

  switch (handle) {
    case 'e': {
      const right = Math.max(x + min, Math.min(cR, anchorR + du))
      w = right - x
      break
    }
    case 'w': {
      x = Math.max(cL, Math.min(anchorR - min, start.x + du))
      w = anchorR - x
      break
    }
    case 's': {
      const bottom = Math.max(y + min, Math.min(cB, anchorB + dv))
      h = bottom - y
      break
    }
    case 'n': {
      y = Math.max(cT, Math.min(anchorB - min, start.y + dv))
      h = anchorB - y
      break
    }
    default:
      return clampNormalizedSlotRect(start)
  }

  return clampNormalizedSlotRectPreserveEdge(start, handle, { x, y, w, h })
}

/** clamp sin desplazar el borde opuesto al que se está recortando. */
function clampNormalizedSlotRectPreserveEdge(
  start: NormalizedSlotRect,
  handle: LayoutSlotHandle,
  r: NormalizedSlotRect
): NormalizedSlotRect {
  const min = LAYOUT_SLOT_MIN_SPAN
  let { x, y, w, h } = r
  w = Math.max(min, Math.min(1, w))
  h = Math.max(min, Math.min(1, h))

  const anchorR = start.x + start.w
  const anchorB = start.y + start.h

  switch (handle) {
    case 'e':
      x = start.x
      y = start.y
      w = Math.min(w, 1 - x)
      h = Math.min(h, 1 - y)
      break
    case 'w':
      x = Math.max(0, Math.min(x, anchorR - min))
      w = anchorR - x
      y = start.y
      h = Math.min(h, 1 - y)
      break
    case 's':
      x = start.x
      y = start.y
      w = Math.min(w, 1 - x)
      h = Math.min(h, anchorB - y)
      break
    case 'n':
      x = start.x
      y = Math.max(0, Math.min(y, anchorB - min))
      w = Math.min(w, 1 - x)
      h = anchorB - y
      break
    default:
      return clampNormalizedSlotRect(r)
  }

  w = Math.max(min, w)
  h = Math.max(min, h)
  return { x, y, w, h }
}

function otherIsEastOf(start: NormalizedSlotRect, o: NormalizedSlotRect, gap: number): boolean {
  return o.x >= start.x + start.w - gap
}

function otherIsWestOf(start: NormalizedSlotRect, o: NormalizedSlotRect, gap: number): boolean {
  return o.x + o.w <= start.x + gap
}

function otherIsSouthOf(start: NormalizedSlotRect, o: NormalizedSlotRect, gap: number): boolean {
  return o.y >= start.y + start.h - gap
}

function otherIsNorthOf(start: NormalizedSlotRect, o: NormalizedSlotRect, gap: number): boolean {
  return o.y + o.h <= start.y + gap
}

export type VideoRectAlign = {
  x: 'left' | 'center' | 'right'
  y: 'top' | 'center' | 'bottom'
}

export const VIDEO_ALIGN_CENTER: VideoRectAlign = { x: 'center', y: 'center' }

const LAYOUT_ALIGN_EPS = 0.0015

export type LayoutEdgeCropHandle = 'n' | 's' | 'e' | 'w'

/** Anclaje fijo en el lado opuesto al borde que se arrastra. */
export function videoAlignForEdgeCropHandle(handle: LayoutEdgeCropHandle): VideoRectAlign {
  switch (handle) {
    case 'e':
      return { x: 'left', y: 'center' }
    case 'w':
      return { x: 'right', y: 'center' }
    case 's':
      return { x: 'center', y: 'top' }
    case 'n':
      return { x: 'center', y: 'bottom' }
  }
}

/** Recorte por un solo lado respecto al techo (también si el otro eje ya era menor por esquinas). */
export function isLayoutEdgeCropGeometry(slot: NormalizedSlotRect, ceiling: NormalizedSlotRect): boolean {
  const e = LAYOUT_ALIGN_EPS
  const wShrunk = slot.w < ceiling.w - e
  const hShrunk = slot.h < ceiling.h - e
  const wMatch = Math.abs(slot.w - ceiling.w) < e
  const hMatch = Math.abs(slot.h - ceiling.h) < e
  return (wShrunk && hMatch) || (hShrunk && wMatch) || (wShrunk && !hShrunk) || (hShrunk && !wShrunk)
}

export type LayoutEdgeCropHandleMap = Partial<Record<LayoutId, (LayoutEdgeCropHandle | null)[]>>

export function translateNormalizedSlotRect(
  r: NormalizedSlotRect,
  du: number,
  dv: number
): NormalizedSlotRect {
  return clampNormalizedSlotRect({ ...r, x: r.x + du, y: r.y + dv })
}

/** Anclaje cover respecto al techo: el lado con menos “margen” queda fijo. */
export function slotVideoCoverAlign(slot: NormalizedSlotRect, ceiling: NormalizedSlotRect): VideoRectAlign {
  const e = LAYOUT_ALIGN_EPS
  const cL = ceiling.x
  const cT = ceiling.y
  const cR = ceiling.x + ceiling.w
  const cB = ceiling.y + ceiling.h
  const sR = slot.x + slot.w
  const sB = slot.y + slot.h

  const gapLeft = slot.x - cL
  const gapRight = cR - sR
  const gapTop = slot.y - cT
  const gapBottom = cB - sB

  let x: VideoRectAlign['x'] = 'center'
  if (gapRight > gapLeft + e) x = 'left'
  else if (gapLeft > gapRight + e) x = 'right'

  let y: VideoRectAlign['y'] = 'center'
  if (gapBottom > gapTop + e) y = 'top'
  else if (gapTop > gapBottom + e) y = 'bottom'

  return { x, y }
}

/** Unión de dos rects (p. ej. techo máximo alcanzable con esquinas). */
export function unionNormalizedSlotRects(a: NormalizedSlotRect, b: NormalizedSlotRect): NormalizedSlotRect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.w, b.x + b.w)
  const bottom = Math.max(a.y + a.h, b.y + b.h)
  return clampNormalizedSlotRect({ x, y, w: right - x, h: bottom - y })
}

function clampEdgeCropAgainstOthers(
  start: NormalizedSlotRect,
  slot: NormalizedSlotRect,
  handle: LayoutSlotHandle,
  others: readonly NormalizedSlotRect[],
  gap: number
): NormalizedSlotRect {
  const anchorR = start.x + start.w
  const anchorB = start.y + start.h
  let { x, y, w, h } = slot

  for (const o of others) {
    if (handle === 'e' && otherIsEastOf(start, o, gap)) {
      const maxRight = o.x - gap
      if (x + w > maxRight + 1e-6) {
        w = Math.max(LAYOUT_SLOT_MIN_SPAN, maxRight - x)
      }
    }
    if (handle === 'w' && otherIsWestOf(start, o, gap)) {
      const minX = o.x + o.w + gap
      if (x < minX - 1e-6) {
        w = Math.max(LAYOUT_SLOT_MIN_SPAN, anchorR - minX)
        x = anchorR - w
      }
    }
    if (handle === 's' && otherIsSouthOf(start, o, gap)) {
      const maxBottom = o.y - gap
      if (y + h > maxBottom + 1e-6) {
        h = Math.max(LAYOUT_SLOT_MIN_SPAN, maxBottom - y)
      }
    }
    if (handle === 'n' && otherIsNorthOf(start, o, gap)) {
      const minY = o.y + o.h + gap
      if (y < minY - 1e-6) {
        h = Math.max(LAYOUT_SLOT_MIN_SPAN, anchorB - minY)
        y = anchorB - h
      }
    }
  }

  return clampNormalizedSlotRectPreserveEdge(start, handle, { x, y, w, h })
}

/** Relación ancho/alto del slot en píxeles del canvas. */
export function normalizedSlotPixelAspect(r: NormalizedSlotRect, cw: number, ch: number): number {
  return (r.w * cw) / Math.max(1e-6, r.h * ch)
}

function layoutRectsOverlap(a: NormalizedSlotRect, b: NormalizedSlotRect, gap: number): boolean {
  return (
    a.x < b.x + b.w - gap &&
    a.x + a.w > b.x + gap &&
    a.y < b.y + b.h - gap &&
    a.y + a.h > b.y + gap
  )
}

/** Empuja el slot para que no invada otros (solo mueve posición). */
export function separateSlotFromOthers(
  slot: NormalizedSlotRect,
  others: readonly NormalizedSlotRect[],
  gap = LAYOUT_SLOT_MIN_GAP
): NormalizedSlotRect {
  let s = clampNormalizedSlotRect(slot)
  for (let pass = 0; pass < 8; pass++) {
    let moved = false
    for (const o of others) {
      const overlapX = Math.min(s.x + s.w, o.x + o.w) - Math.max(s.x, o.x)
      const overlapY = Math.min(s.y + s.h, o.y + o.h) - Math.max(s.y, o.y)
      if (overlapX <= gap || overlapY <= gap) continue

      const sCx = s.x + s.w / 2
      const sCy = s.y + s.h / 2
      const oCx = o.x + o.w / 2
      const oCy = o.y + o.h / 2
      let { x, y } = s

      if (overlapX < overlapY) {
        const push = overlapX + gap
        x += sCx < oCx ? -push : push
      } else {
        const push = overlapY + gap
        y += sCy < oCy ? -push : push
      }
      const next = clampNormalizedSlotRect({ ...s, x, y })
      if (next.x !== s.x || next.y !== s.y) moved = true
      s = next
    }
    if (!moved) break
  }
  return s
}

function hFromAspectW(w: number, aspect: number, cw: number, ch: number): number {
  return (w * cw) / (aspect * ch)
}

function wFromAspectH(h: number, aspect: number, cw: number, ch: number): number {
  return (h * ch * aspect) / cw
}

/** Redimensiona manteniendo la relación ancho/alto (ancla según la esquina arrastrada). */
export function resizeNormalizedSlotWithAspect(
  start: NormalizedSlotRect,
  handle: LayoutSlotHandle,
  du: number,
  dv: number,
  aspect: number,
  cw: number,
  ch: number
): NormalizedSlotRect {
  const right = start.x + start.w
  const bottom = start.y + start.h
  const duPx = du * cw
  const dvPx = dv * ch
  const useHeightLead = Math.abs(dvPx) > Math.abs(duPx)

  let x = start.x
  let y = start.y
  let w = start.w
  let h = start.h

  switch (handle) {
    case 'se':
      if (useHeightLead) {
        h = Math.max(LAYOUT_SLOT_MIN_SPAN, start.h + dv)
        w = wFromAspectH(h, aspect, cw, ch)
      } else {
        w = Math.max(LAYOUT_SLOT_MIN_SPAN, start.w + du)
        h = hFromAspectW(w, aspect, cw, ch)
      }
      break
    case 'sw':
      if (useHeightLead) {
        h = Math.max(LAYOUT_SLOT_MIN_SPAN, start.h + dv)
        w = wFromAspectH(h, aspect, cw, ch)
      } else {
        w = Math.max(LAYOUT_SLOT_MIN_SPAN, start.w - du)
        h = hFromAspectW(w, aspect, cw, ch)
      }
      x = right - w
      break
    case 'ne':
      if (useHeightLead) {
        h = Math.max(LAYOUT_SLOT_MIN_SPAN, start.h - dv)
        w = wFromAspectH(h, aspect, cw, ch)
      } else {
        w = Math.max(LAYOUT_SLOT_MIN_SPAN, start.w + du)
        h = hFromAspectW(w, aspect, cw, ch)
      }
      y = bottom - h
      break
    case 'nw':
      if (useHeightLead) {
        h = Math.max(LAYOUT_SLOT_MIN_SPAN, start.h - dv)
        w = wFromAspectH(h, aspect, cw, ch)
      } else {
        w = Math.max(LAYOUT_SLOT_MIN_SPAN, start.w - du)
        h = hFromAspectW(w, aspect, cw, ch)
      }
      x = right - w
      y = bottom - h
      break
    default:
      return clampNormalizedSlotRect(start)
  }

  return clampNormalizedSlotRect({ x, y, w, h })
}

/** Limita el resize con aspecto para no invadir otros slots (anclas de esquina respetadas). */
function clampAspectSlotAgainstOthers(
  start: NormalizedSlotRect,
  slot: NormalizedSlotRect,
  handle: LayoutSlotHandle,
  others: readonly NormalizedSlotRect[],
  aspect: number,
  cw: number,
  ch: number,
  gap: number
): NormalizedSlotRect {
  const right = start.x + start.w
  const bottom = start.y + start.h
  let s = clampNormalizedSlotRect(slot)

  const applyWFromAnchor = () => {
    s.h = hFromAspectW(s.w, aspect, cw, ch)
    if (handle === 'ne' || handle === 'nw') s.y = bottom - s.h
    if (handle === 'sw' || handle === 'nw') s.x = right - s.w
    if (handle === 'se' || handle === 'ne') {
      s.x = start.x
      if (handle === 'ne') s.y = bottom - s.h
    }
  }

  const applyHFromAnchor = () => {
    s.w = wFromAspectH(s.h, aspect, cw, ch)
    if (handle === 'sw' || handle === 'nw') s.x = right - s.w
    if (handle === 'se' || handle === 'ne') {
      s.x = start.x
      if (handle === 'ne') s.y = bottom - s.h
    }
  }

  for (const o of others) {
    const oRight = o.x + o.w
    const oBottom = o.y + o.h

    if ((handle === 'se' || handle === 'ne') && otherIsEastOf(start, o, gap)) {
      const maxW = o.x - gap - start.x
      if (s.w > maxW + 1e-6) {
        s.w = Math.max(LAYOUT_SLOT_MIN_SPAN, maxW)
        applyWFromAnchor()
      }
    }
    if ((handle === 'sw' || handle === 'nw') && otherIsWestOf(start, o, gap)) {
      const minX = oRight + gap
      if (s.x < minX - 1e-6) {
        s.w = Math.max(LAYOUT_SLOT_MIN_SPAN, right - minX)
        s.x = right - s.w
        applyWFromAnchor()
      }
    }
    if ((handle === 'se' || handle === 'sw') && otherIsSouthOf(start, o, gap)) {
      const maxH = o.y - gap - start.y
      if (s.h > maxH + 1e-6) {
        s.h = Math.max(LAYOUT_SLOT_MIN_SPAN, maxH)
        applyHFromAnchor()
      }
    }
    if ((handle === 'ne' || handle === 'nw') && otherIsNorthOf(start, o, gap)) {
      const minY = oBottom + gap
      if (s.y < minY - 1e-6) {
        s.h = Math.max(LAYOUT_SLOT_MIN_SPAN, bottom - minY)
        s.y = minY
        applyHFromAnchor()
      }
    }
  }

  return clampNormalizedSlotRect(s)
}

export function resizeNormalizedSlotFree(
  start: NormalizedSlotRect,
  handle: LayoutSlotHandle,
  du: number,
  dv: number
): NormalizedSlotRect {
  const s = { ...start }
  if (handle === 'move') {
    s.x += du
    s.y += dv
  } else {
    if (handle === 'w' || handle === 'nw' || handle === 'sw') {
      s.x += du
      s.w -= du
    }
    if (handle === 'e' || handle === 'ne' || handle === 'se') {
      s.w += du
    }
    if (handle === 'n' || handle === 'nw' || handle === 'ne') {
      s.y += dv
      s.h -= dv
    }
    if (handle === 's' || handle === 'sw' || handle === 'se') {
      s.h += dv
    }
  }
  return clampNormalizedSlotRect(s)
}

function resolveFreeResizeAgainstOthers(
  slot: NormalizedSlotRect,
  others: readonly NormalizedSlotRect[],
  gap: number
): NormalizedSlotRect {
  let s = clampNormalizedSlotRect(slot)
  s = separateSlotFromOthers(s, others, gap)
  for (let i = 0; i < 16; i++) {
    const blocker = others.find((o) => layoutRectsOverlap(s, o, gap))
    if (!blocker) break
    const overlapX = Math.min(s.x + s.w, blocker.x + blocker.w) - Math.max(s.x, blocker.x)
    const overlapY = Math.min(s.y + s.h, blocker.y + blocker.h) - Math.max(s.y, blocker.y)
    if (overlapX < overlapY) {
      const push = overlapX + gap
      s.x += s.x + s.w / 2 < blocker.x + blocker.w / 2 ? -push : push
    } else {
      const push = overlapY + gap
      s.y += s.y + s.h / 2 < blocker.y + blocker.h / 2 ? -push : push
    }
    s = clampNormalizedSlotRect(s)
  }
  return s
}

/** Aplica arrastre o resize de un slot y devuelve la geometría completa actualizada. */
export function transformLayoutSlotGeometry(
  layoutId: LayoutId,
  startGeom: readonly NormalizedSlotRect[],
  slotIndex: number,
  handle: LayoutSlotHandle,
  du: number,
  dv: number,
  cw: number,
  ch: number,
  aspectAtDragStart: number,
  ceilingGeom?: readonly NormalizedSlotRect[] | null
): NormalizedSlotRect[] {
  const rules = layoutEditorRules(layoutId)
  const start = startGeom[slotIndex]!
  const others = startGeom.filter((_, i) => i !== slotIndex)
  const ceiling = ceilingGeom?.[slotIndex] ?? start

  let slot: NormalizedSlotRect
  if (handle === 'move') {
    slot = clampNormalizedSlotRect({ ...start, x: start.x + du, y: start.y + dv })
  } else if (rules.edgeCrop && isLayoutEdgeCropHandle(handle)) {
    slot = cropNormalizedSlotFromEdge(start, handle, du, dv, ceiling)
    if (rules.preventOverlap) {
      slot = clampEdgeCropAgainstOthers(start, slot, handle, others, LAYOUT_SLOT_MIN_GAP)
    }
  } else if (rules.lockAspect && isLayoutCornerHandle(handle)) {
    slot = resizeNormalizedSlotWithAspect(start, handle, du, dv, aspectAtDragStart, cw, ch)
    if (rules.preventOverlap) {
      slot = clampAspectSlotAgainstOthers(
        start,
        slot,
        handle,
        others,
        aspectAtDragStart,
        cw,
        ch,
        LAYOUT_SLOT_MIN_GAP
      )
    }
  } else {
    slot = resizeNormalizedSlotFree(start, handle, du, dv)
  }

  if (rules.preventOverlap && handle === 'move') {
    slot = separateSlotFromOthers(slot, others, LAYOUT_SLOT_MIN_GAP)
  } else if (rules.preventOverlap && !rules.edgeCrop && !isLayoutCornerHandle(handle)) {
    slot = resolveFreeResizeAgainstOthers(slot, others, LAYOUT_SLOT_MIN_GAP)
  }

  return startGeom.map((r, i) => (i === slotIndex ? slot : r))
}
