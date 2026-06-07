const REPO = 'JRNCarrizo/studioLive'
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`
const FALLBACK = {
  version: '0.1.0',
  fileName: 'Studio-Live-Setup-0.1.0.exe',
  url: `https://github.com/${REPO}/releases/download/v0.1.0/Studio-Live-Setup-0.1.0.exe`
}

function parseVersion(fileName) {
  const m =
    /Setup[-\s]+([\d.]+)/i.exec(fileName) ?? /-([\d.]+)\.exe$/i.exec(fileName)
  return m ? m[1] : FALLBACK.version
}

function isLocalDev() {
  const h = location.hostname
  return h === '127.0.0.1' || h === 'localhost'
}

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function applyDownloadLinks({ url, fileName, sizeLabel, version }) {
  const btn = document.getElementById('downloadBtn')
  const alt = document.getElementById('downloadAlt')
  const meta = document.getElementById('downloadMeta')
  const versionLabel = document.getElementById('versionLabel')

  btn.href = url
  alt.href = RELEASES_PAGE
  meta.textContent = sizeLabel ? `${fileName} · ${sizeLabel}` : fileName
  versionLabel.textContent = version ?? parseVersion(fileName)
}

async function loadFromLocalServer() {
  const r = await fetch('/api/installer')
  const data = await r.json()
  if (!data.ok) {
    document.getElementById('downloadErr').hidden = false
    document.getElementById('downloadErr').textContent = data.message
    return
  }
  applyDownloadLinks({
    url: '/download',
    fileName: data.fileName,
    sizeLabel: data.sizeLabel,
    version: parseVersion(data.fileName)
  })
}

async function loadFromGitHub() {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!r.ok) throw new Error('no release')
    const release = await r.json()
    const asset = (release.assets ?? []).find((a) => /\.exe$/i.test(a.name))
    if (!asset?.browser_download_url) throw new Error('no exe')
    applyDownloadLinks({
      url: asset.browser_download_url,
      fileName: asset.name,
      sizeLabel: formatMb(asset.size),
      version: String(release.tag_name ?? '').replace(/^v/i, '')
    })
  } catch {
    applyDownloadLinks(FALLBACK)
  }
}

if (isLocalDev()) loadFromLocalServer()
else loadFromGitHub()
