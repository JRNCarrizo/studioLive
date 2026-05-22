/**
 * Arranca Studio Live sin aceleración por hardware (ayuda con YouTube en captura de pantalla).
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const child = spawn(npmCmd, ['run', 'dev'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, STUDIO_DISABLE_HW_ACCEL: '1' },
  shell: process.platform === 'win32'
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
