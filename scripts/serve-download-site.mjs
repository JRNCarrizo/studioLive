/**
 * Servidor local de la landing + instaladores en release/
 * Uso: npm run website  (después de npm run dist:win)
 */
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const websiteDir = path.join(root, 'website')
const releaseDir = path.join(root, 'release')
const port = Number(process.env.STUDIO_WEBSITE_PORT) || 3080

function listWindowsInstallers() {
  if (!fs.existsSync(releaseDir)) return []
  return fs
    .readdirSync(releaseDir)
    .filter((f) => f.endsWith('.exe'))
    .map((name) => {
      const abs = path.join(releaseDir, name)
      const st = fs.statSync(abs)
      return { name, abs, mtimeMs: st.mtimeMs, size: st.size }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

function formatBytes(n) {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const app = express()

app.get('/api/installer', (_req, res) => {
  const list = listWindowsInstallers()
  if (!list.length) {
    res.status(404).json({
      ok: false,
      message: 'No hay instalador. Ejecutá npm run dist:win en la carpeta del proyecto.'
    })
    return
  }
  const latest = list[0]
  res.json({
    ok: true,
    fileName: latest.name,
    downloadUrl: `/downloads/${encodeURIComponent(latest.name)}`,
    sizeLabel: formatBytes(latest.size),
    builtAt: new Date(latest.mtimeMs).toISOString()
  })
})

app.use('/downloads', express.static(releaseDir, { index: false, fallthrough: false }))

app.use(express.static(websiteDir))

app.listen(port, '127.0.0.1', () => {
  const list = listWindowsInstallers()
  console.log('')
  console.log('  Studio Live — landing local')
  console.log(`  http://127.0.0.1:${port}/`)
  if (list.length) {
    console.log(`  Instalador: ${list[0].name} (${formatBytes(list[0].size)})`)
  } else {
    console.log('  (Sin .exe en release/ — corré npm run dist:win primero)')
  }
  console.log('')
}).on('error', (err) => {
  if (err && typeof err === 'object' && 'code' in err && err.code === 'EADDRINUSE') {
    console.error('')
    console.error(`  El puerto ${port} ya está en uso.`)
    console.error('  Cerrá la otra ventana donde corriste npm run website, o usá otro puerto:')
    console.error(`    $env:STUDIO_WEBSITE_PORT=3081; npm run website`)
    console.error('')
    process.exit(1)
  }
  throw err
})
