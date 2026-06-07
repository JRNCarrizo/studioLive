import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function run(cmd, args, extraEnv = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false', ...extraEnv }
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('node', ['scripts/generate-icon.mjs'])
spawnSync('node', ['scripts/pre-dist-win.mjs'], { cwd: root, stdio: 'inherit', shell: true })
run('npm', ['run', 'build'])

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outputDir = `release-${stamp}`
console.log(`[dist:win] building in ${outputDir}/ (avoids locked release/win-unpacked)`)

run('npx', ['electron-builder', '--win', `--config.directories.output=${outputDir}`])

const releaseDir = path.join(root, 'release')
fs.mkdirSync(releaseDir, { recursive: true })
for (const name of fs.readdirSync(path.join(root, outputDir))) {
  const isInstaller = name.endsWith('.exe') || name.endsWith('.blockmap')
  const isLatest = name === 'latest.yml'
  if (!isInstaller && !isLatest) continue
  fs.copyFileSync(path.join(root, outputDir, name), path.join(releaseDir, name))
  console.log(`[dist:win] copied → release/${name}`)
}

// Drop old temp build folders (~400 MB each); keep only release/ with the installer.
for (const name of fs.readdirSync(root)) {
  if (name === 'release') continue
  if (!/^release(?:-build|-\d{4}-\d{2}-\d{2}T)/.test(name)) continue
  const dir = path.join(root, name)
  if (!fs.statSync(dir).isDirectory()) continue
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 })
  console.log(`[dist:win] removed temp folder ${name}/`)
}

console.log(`[dist:win] done → release/Studio-Live-Setup-0.1.0.exe`)
