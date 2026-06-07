/** Fallback si la API de GitHub falla (rate limit, red, etc.). */
const RELEASE_FALLBACK = {
  version: '0.1.0',
  fileName: 'Studio-Live-Setup-0.1.0.exe',
  downloadUrl:
    'https://github.com/JRNCarrizo/studioLive/releases/download/v0.1.0/Studio-Live-Setup-0.1.0.exe'
}

function parseVersion(fileName) {
  const m =
    /Setup[-\s]+([\d.]+)/i.exec(fileName) ?? /-([\d.]+)\.exe$/i.exec(fileName)
  return m ? m[1] : RELEASE_FALLBACK.version
}

function isLocalDev() {
  const h = location.hostname
  return h === '127.0.0.1' || h === 'localhost'
}

function showDownload({ href, fileName, sizeLabel, version }) {
  const btn = document.getElementById('downloadBtn')
  const meta = document.getElementById('downloadMeta')
  const versionLabel = document.getElementById('versionLabel')

  btn.hidden = false
  btn.href = href
  btn.setAttribute('download', fileName)
  btn.setAttribute('target', '_blank')
  btn.setAttribute('rel', 'noopener noreferrer')
  meta.textContent = sizeLabel ? `${fileName} · ${sizeLabel}` : fileName
  versionLabel.textContent = version ?? parseVersion(fileName)
}

function showError(message) {
  const err = document.getElementById('downloadErr')
  err.hidden = false
  err.textContent = message
}

async function loadFromLocalServer() {
  const r = await fetch('/api/installer')
  const data = await r.json()
  if (!data.ok) {
    showError(data.message)
    return
  }
  showDownload({
    href: data.downloadUrl,
    fileName: data.fileName,
    sizeLabel: data.sizeLabel,
    version: parseVersion(data.fileName)
  })
}

function applyFallbackDownload() {
  showDownload({
    href: RELEASE_FALLBACK.downloadUrl,
    fileName: RELEASE_FALLBACK.fileName,
    sizeLabel: null,
    version: RELEASE_FALLBACK.version
  })
}

/** Netlify y cualquier hosting estático: último Release publicado en GitHub. */
async function loadFromGitHubRelease() {
  const repo = 'JRNCarrizo/studioLive'
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!r.ok) {
      applyFallbackDownload()
      return
    }
    const release = await r.json()
    const asset = (release.assets ?? []).find((a) => /\.exe$/i.test(a.name))
    if (!asset) {
      applyFallbackDownload()
      return
    }
    const sizeMb = asset.size / (1024 * 1024)
    showDownload({
      href: asset.browser_download_url,
      fileName: asset.name,
      sizeLabel: `${sizeMb.toFixed(1)} MB`,
      version: String(release.tag_name ?? '').replace(/^v/i, '') || parseVersion(asset.name)
    })
  } catch {
    applyFallbackDownload()
  }
}

async function loadInstaller() {
  try {
    if (isLocalDev()) await loadFromLocalServer()
    else await loadFromGitHubRelease()
  } catch {
    if (isLocalDev()) {
      showError(
        'No se pudo contactar al servidor local. Ejecutá npm run website en la carpeta del proyecto.'
      )
    } else {
      applyFallbackDownload()
    }
  }
}

loadInstaller()
