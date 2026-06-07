const path = require('node:path')
const { embedIcon } = require('./icon-embed-utils.cjs')

/** Embed app icon when signAndEditExecutable is false (avoids winCodeSign symlink issues). */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const exeName = `${context.packager.appInfo.productFilename}.exe`
  const exePath = path.join(context.appOutDir, exeName)
  const iconPath = path.join(context.packager.projectDir, 'build', 'icon.ico')
  await embedIcon(exePath, iconPath)
}
