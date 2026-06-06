async function loadInstaller() {
  const btn = document.getElementById('downloadBtn')
  const meta = document.getElementById('downloadMeta')
  const err = document.getElementById('downloadErr')
  const versionLabel = document.getElementById('versionLabel')

  try {
    const r = await fetch('/api/installer')
    const data = await r.json()
    if (!data.ok) {
      err.hidden = false
      err.textContent = data.message
      return
    }
    btn.hidden = false
    btn.href = data.downloadUrl
    btn.download = data.fileName
    meta.textContent = `${data.fileName} · ${data.sizeLabel}`
    const m = /Setup\s+([\d.]+)/i.exec(data.fileName)
    versionLabel.textContent = m ? m[1] : 'local'
  } catch (e) {
    err.hidden = false
    err.textContent =
      'No se pudo contactar al servidor local. Ejecutá npm run website en la carpeta del proyecto.'
  }
}

loadInstaller()
