/**
 * Sube latest.yml + instalador + blockmap a un GitHub Release.
 * Requiere: npm run dist:win antes, y token con permiso repo.
 *
 * PowerShell:
 *   $env:GH_TOKEN="ghp_..."
 *   npm run release:upload
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const releaseDir = path.join(root, 'release')

const owner = 'JRNCarrizo'
const repo = 'studioLive'

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
if (!token) {
  console.error('Falta GH_TOKEN (o GITHUB_TOKEN). Creá un token en GitHub → Settings → Developer settings → PAT.')
  process.exit(1)
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version
const tag = `v${version}`

function findAsset(baseName) {
  const exact = path.join(releaseDir, baseName)
  if (fs.existsSync(exact)) return { path: exact, name: baseName }
  const alt = path.join(releaseDir, `Studio Live Setup ${version}.exe`)
  if (baseName.endsWith('.exe') && fs.existsSync(alt)) {
    return { path: alt, name: `Studio-Live-Setup-${version}.exe` }
  }
  return null
}

async function gh(method, apiPath, body) {
  const r = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'studio-live-release-upload',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body && !(body instanceof Buffer) ? { 'Content-Type': 'application/json' } : {})
    },
    body: body instanceof Buffer ? body : body ? JSON.stringify(body) : undefined
  })
  const text = await r.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!r.ok) {
    throw new Error(`GitHub ${method} ${apiPath} → ${r.status}: ${text}`)
  }
  return data
}

async function getOrCreateRelease() {
  try {
    return await gh('GET', `/repos/${owner}/${repo}/releases/tags/${tag}`)
  } catch {
    /* crear */
  }
  return gh('POST', `/repos/${owner}/${repo}/releases`, {
    tag_name: tag,
    name: `Studio Live ${version}`,
    body: `Release ${version}`,
    draft: false,
    prerelease: false
  })
}

async function deleteAssetIfExists(releaseId, name) {
  const release = await gh('GET', `/repos/${owner}/${repo}/releases/${releaseId}`)
  const hit = release.assets?.find((a) => a.name === name)
  if (hit) await gh('DELETE', `/repos/${owner}/${repo}/releases/assets/${hit.id}`)
}

async function uploadAsset(releaseId, filePath, uploadName) {
  const buf = fs.readFileSync(filePath)
  const ct =
    uploadName.endsWith('.yml') ? 'text/yaml' : uploadName.endsWith('.blockmap') ? 'application/octet-stream' : 'application/octet-stream'
  await deleteAssetIfExists(releaseId, uploadName)
  const r = await fetch(
    `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(uploadName)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': ct,
        'Content-Length': String(buf.length)
      },
      body: buf
    }
  )
  if (!r.ok) throw new Error(`Upload ${uploadName} → ${r.status}: ${await r.text()}`)
  console.log(`  ✓ ${uploadName}`)
}

const ymlPath = path.join(releaseDir, 'latest.yml')
if (!fs.existsSync(ymlPath)) {
  console.error('No existe release/latest.yml — corré npm run dist:win primero.')
  process.exit(1)
}

const ymlText = fs.readFileSync(ymlPath, 'utf8')
const pathMatch = /path:\s*(.+)/.exec(ymlText)
const exeUploadName = pathMatch?.[1]?.trim() ?? `Studio-Live-Setup-${version}.exe`
const exe = findAsset(exeUploadName)
const blockmapName = `${exeUploadName}.blockmap`
const blockmap = findAsset(blockmapName) ?? findAsset(`Studio Live Setup ${version}.exe.blockmap`)

if (!exe) {
  console.error(`No se encontró el .exe en release/ (esperado: ${exeUploadName})`)
  process.exit(1)
}

console.log(`Publicando ${tag} en ${owner}/${repo}…`)
const release = await getOrCreateRelease()
console.log(`Release id ${release.id}`)

await uploadAsset(release.id, ymlPath, 'latest.yml')
await uploadAsset(release.id, exe.path, exe.name)
if (blockmap) await uploadAsset(release.id, blockmap.path, blockmap.name)
else console.warn('  (sin .blockmap — opcional)')

console.log('')
console.log(`Listo: https://github.com/${owner}/${repo}/releases/tag/${tag}`)
console.log('Probá el botón de versión en Studio Live instalado.')
