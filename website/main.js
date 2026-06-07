const REPO = 'JRNCarrizo/studioLive'
const FALLBACK_EXE =
  'https://github.com/JRNCarrizo/studioLive/releases/download/v0.1.0/Studio-Live-Setup-0.1.0.exe'

function parseVersion(fileName) {
  const m =
    /Setup[-\s]+([\d.]+)/i.exec(fileName) ?? /-([\d.]+)\.exe$/i.exec(fileName)
  return m ? m[1] : '0.1.0'
}

function isLocalDev() {
  const h = location.hostname
  return h === '127.0.0.1' || h === 'localhost'
}

function isEmbeddedPreview() {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

/** Descarga sin abrir pestañas (iframe oculto). */
function triggerDownload(url) {
  if (isEmbeddedPreview()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden'
  iframe.src = url
  document.body.appendChild(iframe)
  window.setTimeout(() => iframe.remove(), 120000)
}

function showDownload({ fileName, sizeLabel, version, downloadUrl }) {
  const btn = document.getElementById('downloadBtn')
  const meta = document.getElementById('downloadMeta')
  const fallback = document.getElementById('downloadFallback')
  const manual = document.getElementById('downloadManual')
  const versionLabel = document.getElementById('versionLabel')

  btn.hidden = false
  btn.onclick = () => triggerDownload(downloadUrl)

  fallback.hidden = false
  manual.hidden = false
  manual.href = downloadUrl
  manual.onclick = (e) => {
    e.preventDefault()
    if (isEmbeddedPreview()) {
      window.open(downloadUrl, '_blank', 'noopener,noreferrer')
      return
    }
    window.location.assign(downloadUrl)
  }

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
    version: parseVersion(data.fileName),
    downloadUrl: new URL('/download', window.location.origin).href
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
    if (!asset?.browser_download_url) throw new Error('no exe')
    const sizeMb = asset.size / (1024 * 1024)
    showDownload({
      fileName: asset.name,
      sizeLabel: `${sizeMb.toFixed(1)} MB`,
      version: String(release.tag_name ?? '').replace(/^v/i, '') || parseVersion(asset.name),
      downloadUrl: asset.browser_download_url
    })
  } catch {
    showDownload({
      fileName: 'Studio-Live-Setup-0.1.0.exe',
      sizeLabel: null,
      version: '0.1.0',
      downloadUrl: FALLBACK_EXE
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
