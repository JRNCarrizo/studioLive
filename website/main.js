const REPO = 'JRNCarrizo/studioLive'
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`

/** Fallback si la API de GitHub falla. */
const RELEASE_FALLBACK = {
  version: '0.1.0',
  fileName: 'Studio-Live-Setup-0.1.0.exe',
  releasesPage: RELEASES_PAGE
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

function wireDownloadButton(btn, { href, external }) {
  btn.replaceWith(btn.cloneNode(true))
  const fresh = document.getElementById('downloadBtn')

  if (!external) {
    fresh.href = href
    fresh.removeAttribute('target')
    fresh.removeAttribute('rel')
    return fresh
  }

  fresh.href = href
  fresh.setAttribute('target', '_blank')
  fresh.setAttribute('rel', 'noopener noreferrer')
  return fresh
}

function showDownload({ href, fileName, sizeLabel, version, external = false, releasesPage }) {
  const meta = document.getElementById('downloadMeta')
  const fallback = document.getElementById('downloadFallback')
  const versionLabel = document.getElementById('versionLabel')
  const btn = wireDownloadButton(document.getElementById('downloadBtn'), { href, external })

  btn.hidden = false

  if (external) {
    const page = releasesPage ?? RELEASES_PAGE
    fallback.hidden = false
    fallback.querySelector('a').href = page
    const fileEl = fallback.querySelector('[data-download-file]')
    if (fileEl) fileEl.textContent = fileName
    meta.textContent = sizeLabel
      ? `${fileName} · ${sizeLabel} · se abre GitHub en otra pestaña`
      : `${fileName} · se abre GitHub en otra pestaña`
  } else {
    fallback.hidden = true
    meta.textContent = sizeLabel ? `${fileName} · ${sizeLabel}` : fileName
  }

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
    version: parseVersion(data.fileName),
    external: false
  })
}

function applyFallbackDownload() {
  showDownload({
    href: RELEASES_PAGE,
    fileName: RELEASE_FALLBACK.fileName,
    sizeLabel: null,
    version: RELEASE_FALLBACK.version,
    external: true,
    releasesPage: RELEASES_PAGE
  })
}

/** Netlify: abrir la release en GitHub (descarga fiable del .exe en Assets). */
async function loadFromGitHubRelease() {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
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
    const releasesPage = release.html_url ?? RELEASES_PAGE

    showDownload({
      href: releasesPage,
      fileName: asset.name,
      sizeLabel: `${sizeMb.toFixed(1)} MB`,
      version: String(release.tag_name ?? '').replace(/^v/i, '') || parseVersion(asset.name),
      external: true,
      releasesPage
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
