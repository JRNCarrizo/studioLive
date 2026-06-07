import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = path.join(root, 'build')
const out = path.join(buildDir, 'icon.ico')
const outCopy = path.join(buildDir, 'ICONOCAM.ico')
const preview = path.join(buildDir, 'icon-preview.png')
const transparent = { r: 0, g: 0, b: 0, alpha: 0 }

const imageSources = ['IconCam.png', 'IconCam.jpeg', 'iconCam.png', 'iconCam.jpeg']

function resolveSource() {
  for (const name of imageSources) {
    const file = path.join(buildDir, name)
    if (fs.existsSync(file)) return { path: file, kind: name.endsWith('.png') ? 'png' : 'jpeg' }
  }
  if (fs.existsSync(out)) {
    console.log('[generate-icon] no IconCam.* found → using existing build/icon.ico')
    return { path: out, kind: 'ico' }
  }
  console.error('[generate-icon] put build/IconCam.png (PNG transparente) or build/icon.ico')
  process.exit(1)
}

async function pngHasTransparency(imagePath) {
  const { data, info } = await sharp(imagePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  let transparentPixels = 0
  const total = info.width * info.height
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) transparentPixels++
  }
  return transparentPixels / total > 0.02
}

async function loadSourceImage(sourcePath, kind) {
  if (kind === 'ico') return sharp(sourcePath).ensureAlpha()
  if (kind === 'png' && (await pngHasTransparency(sourcePath))) {
    console.log('[generate-icon] IconCam.png with transparency (sin procesado extra)')
    return sharp(sourcePath).ensureAlpha()
  }
  console.log('[generate-icon] JPEG/opaco: aplicando limpieza de bordes blancos')
  return loadCleanedJpeg(sourcePath)
}

/** Solo para JPEG viejos con lienzo blanco; no se usa si tenés IconCam.png limpio. */
async function loadCleanedJpeg(sourcePath) {
  const { data, info } = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  floodEdgeWhite(data, info.width, info.height)
  applyRoundedSilhouetteMask(data, info.width, info.height)
  removeOuterWhiteRing(data, info.width, info.height, 6, 0.22, 18, 232)
  defringeNearWhiteBorder(data, info.width, info.height)
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
}

function insideRoundedRect(x, y, x0, y0, x1, y1, radius) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const r = Math.max(0, radius)
  if (r === 0) return true
  const corners = [
    [x0 + r, y0 + r],
    [x1 - r, y0 + r],
    [x1 - r, y1 - r],
    [x0 + r, y1 - r]
  ]
  if (x < x0 + r && y < y0 + r) {
    const [cx, cy] = corners[0]
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }
  if (x > x1 - r && y < y0 + r) {
    const [cx, cy] = corners[1]
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }
  if (x > x1 - r && y > y1 - r) {
    const [cx, cy] = corners[2]
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }
  if (x < x0 + r && y > y1 - r) {
    const [cx, cy] = corners[3]
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }
  return true
}

function contentBounds(data, width, height, skipNearWhite = true) {
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (data[i + 3] === 0) continue
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      if (skipNearWhite && r >= 248 && g >= 248 && b >= 248) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return { minX, minY, maxX, maxY }
}

function floodEdgeWhite(data, width, height, threshold = 235) {
  const isNearWhite = (offset) =>
    data[offset] >= threshold && data[offset + 1] >= threshold && data[offset + 2] >= threshold
  const visited = new Uint8Array(width * height)
  const queue = []
  const seed = (x, y) => {
    const idx = y * width + x
    if (visited[idx] || !isNearWhite(idx * 4)) return
    visited[idx] = 1
    queue.push(idx)
  }
  for (let x = 0; x < width; x++) {
    seed(x, 0)
    seed(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    seed(0, y)
    seed(width - 1, y)
  }
  while (queue.length > 0) {
    const idx = queue.pop()
    data[idx * 4 + 3] = 0
    const x = idx % width
    const y = (idx - x) / width
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
      const nidx = ny * width + nx
      if (visited[nidx] || !isNearWhite(nidx * 4)) continue
      visited[nidx] = 1
      queue.push(nidx)
    }
  }
}

function applyRoundedSilhouetteMask(data, width, height, inset = 4, radiusRatio = 0.22) {
  const { minX, minY, maxX, maxY } = contentBounds(data, width, height)
  if (maxX <= minX || maxY <= minY) return
  const x0 = Math.min(width - 1, minX + inset)
  const y0 = Math.min(height - 1, minY + inset)
  const x1 = Math.max(0, maxX - inset)
  const y1 = Math.max(0, maxY - inset)
  const radius = Math.round(Math.min(x1 - x0 + 1, y1 - y0 + 1) * radiusRatio)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (insideRoundedRect(x, y, x0, y0, x1, y1, radius)) continue
      data[(y * width + x) * 4 + 3] = 0
    }
  }
}

function removeOuterWhiteRing(data, width, height, inset, radiusRatio, ringPx, threshold) {
  const { minX, minY, maxX, maxY } = contentBounds(data, width, height, false)
  if (maxX <= minX || maxY <= minY) return
  const x0 = Math.min(width - 1, minX + inset)
  const y0 = Math.min(height - 1, minY + inset)
  const x1 = Math.max(0, maxX - inset)
  const y1 = Math.max(0, maxY - inset)
  const radius = Math.round(Math.min(x1 - x0 + 1, y1 - y0 + 1) * radiusRatio)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (data[i + 3] === 0) continue
      if (!insideRoundedRect(x, y, x0, y0, x1, y1, radius)) continue
      if (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold) continue
      let nearEdge = false
      for (let d = 1; d <= ringPx; d++) {
        if (
          !insideRoundedRect(x - d, y, x0, y0, x1, y1, radius) ||
          !insideRoundedRect(x + d, y, x0, y0, x1, y1, radius) ||
          !insideRoundedRect(x, y - d, x0, y0, x1, y1, radius) ||
          !insideRoundedRect(x, y + d, x0, y0, x1, y1, radius)
        ) {
          nearEdge = true
          break
        }
      }
      if (nearEdge) data[i + 3] = 0
    }
  }
}

function defringeNearWhiteBorder(data, width, height, threshold = 244) {
  const alphaAt = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return 0
    return data[(y * width + x) * 4 + 3]
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (data[i + 3] === 0) continue
      if (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold) continue
      if (
        alphaAt(x - 1, y) === 0 ||
        alphaAt(x + 1, y) === 0 ||
        alphaAt(x, y - 1) === 0 ||
        alphaAt(x, y + 1) === 0
      ) {
        data[i + 3] = 0
      }
    }
  }
}

const { path: sourcePath, kind } = resolveSource()

if (kind === 'ico') {
  fs.copyFileSync(out, outCopy)
  console.log('[generate-icon] using your build/icon.ico as-is (add IconCam.png to regenerate)')
  process.exit(0)
}

const processed = await loadSourceImage(sourcePath, kind)

await processed
  .clone()
  .resize(512, 512, { fit: 'contain', background: transparent })
  .png()
  .toFile(preview)

const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngBuffers = await Promise.all(
  sizes.map((size) =>
    processed
      .clone()
      .resize(size, size, { fit: 'contain', background: transparent })
      .png()
      .toBuffer()
  )
)

const ico = await pngToIco(pngBuffers)
fs.writeFileSync(out, ico)
fs.copyFileSync(out, outCopy)
console.log(`[generate-icon] source → ${path.basename(sourcePath)}`)
console.log(`[generate-icon] preview → ${preview}`)
console.log(`[generate-icon] wrote ${out} (${ico.length} bytes)`)
