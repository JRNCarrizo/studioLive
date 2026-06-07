const REPO = 'JRNCarrizo/studioLive'
const DOWNLOAD_PATH = '/download'

function parseVersion(fileName) {
  const m =
    /Setup[-\s]+([\d.]+)/i.exec(fileName) ?? /-([\d.]+)\.exe$/i.exec(fileName)
  return m ? m[1] : '0.1.0'
}

function isLocalDev() {
  const h = location.hostname
  return h === '127.0.0.1' || h === 'localhost'
}

function showDownload({ fileName, sizeLabel, version }) {
  const btn = document.getElementById('downloadBtn')
  const meta = document.getElementById('downloadMeta')
  const fallback = document.getElementById('downloadFallback')
  const versionLabel = document.getElementById('versionLabel')

  btn.hidden = false
  btn.href = DOWNLOAD_PATH
  btn.removeAttribute('target')
  btn.removeAttribute('rel')
  btn.removeAttribute('download')

  fallback.hidden = false
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
    fileName: data.fileName,
    sizeLabel: data.sizeLabel,
    version: parseVersion(data.fileName)
  })
}

async function loadFromGitHubMeta() {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!r.ok) throw new Error('no release')
    const release = await r.json()
    const asset = (release.assets ?? []).find((a) => /\.exe$/i.test(a.name))
    if (!asset) throw new Error('no exe')
    const sizeMb = asset.size / (1024 * 1024)
    showDownload({
      fileName: asset.name,
      sizeLabel: `${sizeMb.toFixed(1)} MB`,
      version: String(release.tag_name ?? '').replace(/^v/i, '') || parseVersion(asset.name)
    })
  } catch {
    showDownload({
      fileName: 'Studio-Live-Setup-0.1.0.exe',
      sizeLabel: null,
      version: '0.1.0'
    })
  }
}

async function loadInstaller() {
  try {
    if (isLocalDev()) await loadFromLocalServer()
    else await loadFromGitHubMeta()
  } catch {
    showError(
      isLocalDev()
        ? 'No se pudo contactar al servidor local. Ejecutá npm run website en la carpeta del proyecto.'
        : 'No se pudo preparar la descarga. Probá de nuevo en unos minutos.'
    )
  }
}

loadInstaller()
