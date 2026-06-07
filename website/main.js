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

function isEmbeddedPreview() {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

function showDownload({ fileName, sizeLabel, version, directUrl }) {
  const btn = document.getElementById('downloadBtn')
  const meta = document.getElementById('downloadMeta')
  const fallback = document.getElementById('downloadFallback')
  const versionLabel = document.getElementById('versionLabel')

  const downloadHref = directUrl || new URL(DOWNLOAD_PATH, window.location.origin).href

  btn.hidden = false
  btn.href = downloadHref
  // Nueva pestaña = contexto no sandboxeado (Cursor preview, iframes, etc.).
  btn.target = '_blank'
  btn.rel = 'noopener noreferrer'
  btn.removeAttribute('download')

  fallback.hidden = false
  if (isEmbeddedPreview()) {
    fallback.innerHTML =
      'Estás en una vista previa embebida: usá <strong>clic derecho → Abrir enlace en nueva pestaña</strong> o abrí esta web en Chrome/Edge.'
  } else {
    fallback.textContent =
      'Se abre una pestaña nueva y empieza la descarga. Revisá Descargas si no la ves.'
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
    directUrl: new URL('/download', window.location.origin).href
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
      version: String(release.tag_name ?? '').replace(/^v/i, '') || parseVersion(asset.name),
      directUrl: new URL(DOWNLOAD_PATH, window.location.origin).href
    })
  } catch {
    showDownload({
      fileName: 'Studio-Live-Setup-0.1.0.exe',
      sizeLabel: null,
      version: '0.1.0',
      directUrl: new URL(DOWNLOAD_PATH, window.location.origin).href
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
