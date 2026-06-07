import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const winUnpacked = path.join(root, 'release', 'win-unpacked')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function killStudioLive() {
  for (const image of ['Studio Live.exe']) {
    try {
      execSync(`taskkill /F /T /IM "${image}"`, { stdio: 'ignore' })
      console.log(`[pre-dist] closed ${image}`)
    } catch {
      /* not running */
    }
  }

  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'electron.exe\'\\" | Where-Object { $_.ExecutablePath -like \'*studioLive*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    )
    if (out.trim()) console.log('[pre-dist] closed dev electron processes')
  } catch {
    /* ignore */
  }
}

function tryRemoveWinUnpacked() {
  if (!fs.existsSync(winUnpacked)) return true
  try {
    fs.rmSync(winUnpacked, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 })
    console.log('[pre-dist] cleared release/win-unpacked')
    return true
  } catch {
    return false
  }
}

killStudioLive()
await sleep(1500)

if (tryRemoveWinUnpacked()) {
  process.exit(0)
}

console.error('')
console.error('[pre-dist] release/win-unpacked is locked (app.asar in use).')
console.error('  1. Close Studio Live completely (tray too).')
console.error('  2. Close any Explorer window open on release/.')
console.error('  3. Retry: npm run dist:win')
console.error('')
console.error('The build will continue in release-build/ and copy the installer to release/.')
process.exit(0)
