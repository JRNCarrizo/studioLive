const REPO = 'JRNCarrizo/studioLive'
const FALLBACK_EXE =
  'https://github.com/JRNCarrizo/studioLive/releases/download/v0.1.0/Studio-Live-Setup-0.1.0.exe'

exports.handler = async function downloadRedirect() {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'StudioLive-Website-Download'
      }
    })
    if (!r.ok) {
      return redirect(FALLBACK_EXE)
    }
    const release = await r.json()
    const asset = (release.assets ?? []).find((a) => /\.exe$/i.test(a.name))
    if (!asset?.browser_download_url) {
      return redirect(FALLBACK_EXE)
    }
    return redirect(asset.browser_download_url)
  } catch {
    return redirect(FALLBACK_EXE)
  }
}

function redirect(location) {
  return {
    statusCode: 302,
    headers: {
      Location: location,
      'Cache-Control': 'public, max-age=300'
    }
  }
}
