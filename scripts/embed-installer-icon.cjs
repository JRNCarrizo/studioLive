const path = require('node:path')
const { embedIcon } = require('./icon-embed-utils.cjs')

/** Patch NSIS setup exe — installerIcon alone often leaves Electron's default icon. */
module.exports = async function afterAllArtifactBuild(context) {
  if (context.electronPlatformName !== 'win32') return

  const iconPath = path.join(context.packager.projectDir, 'build', 'icon.ico')
  for (const artifactPath of context.artifactPaths) {
    if (!artifactPath.toLowerCase().endsWith('.exe')) continue
    await embedIcon(artifactPath, iconPath)
  }
}
