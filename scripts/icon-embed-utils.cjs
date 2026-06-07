const fs = require('node:fs')
const path = require('node:path')

async function embedIcon(exePath, iconPath) {
  if (!fs.existsSync(exePath)) {
    throw new Error(`[embed-icon] missing exe: ${exePath}`)
  }
  if (!fs.existsSync(iconPath)) {
    throw new Error(`[embed-icon] missing icon: ${iconPath}`)
  }

  const iconStat = fs.statSync(iconPath)
  const { default: rcedit } = await import('rcedit')
  await rcedit(exePath, { icon: iconPath })
  console.log(
    `[embed-icon] ${path.basename(iconPath)} (${iconStat.size} bytes) → ${exePath}`
  )
}

module.exports = { embedIcon }
