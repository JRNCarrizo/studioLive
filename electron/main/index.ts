import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, app, clipboard, dialog, ipcMain, net, protocol, session } from 'electron'
import {
  HOST_PANEL_HTTP_OFFSET,
  cameraClientDir,
  createSignalingServer,
  getLanIPv4s,
  type SignalingMsg,
  type SignalingRuntime
} from './signaling'
import { convertWebmFileToMp4, getFFmpegPath } from './ffmpegConvert'
import { ensureStudioCerts } from './tls'

/** Debe registrarse antes de app.ready — permite `<video src>` desde dev server sin file:// bloqueado. */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'studio-webm',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

function isPrivateOrLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1')
    return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 127) return true
  return false
}

const DEFAULT_SIGNAL_PORT = 8788
const PORT_TRIES = 10

let mainWindow: BrowserWindow | null = null
let signalingPort = DEFAULT_SIGNAL_PORT
let loopbackSignalingPort = DEFAULT_SIGNAL_PORT
let hostPanelHttpPort = DEFAULT_SIGNAL_PORT + HOST_PANEL_HTTP_OFFSET

let signalingRuntime: SignalingRuntime | null = null

async function ensureCameraClientDir(): Promise<string> {
  const dir = cameraClientDir()
  await mkdir(dir, { recursive: true })
  return dir
}

function createWindow(): void {
  const viteDev = Boolean(process.env.ELECTRON_RENDERER_URL)
  const devToolsOptOut =
    process.env.STUDIO_DEVTOOLS === '0' || process.env.STUDIO_DEVTOOLS === 'false'
  const openDevTools =
    !devToolsOptOut &&
    (viteDev || process.env.STUDIO_DEVTOOLS === '1' || process.env.STUDIO_DEVTOOLS === 'true')

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      allowRunningInsecureContent: viteDev
    }
  })

  /** Consola del renderer: siempre en dev; en build solo con STUDIO_DEVTOOLS=1 */
  if (openDevTools) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.openDevTools({ mode: 'detach' })
    })
  }

  /** Ctrl+Shift+I — abrir/cerrar DevTools (útil si la cerraste o en build sin variable). */
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

ipcMain.handle('studio:get-info', () => ({
  port: signalingPort,
  loopbackSignalingPort,
  hostPanelHttpPort,
  ips: getLanIPv4s()
}))

ipcMain.handle('studio:is-sig-ready', () => signalingRuntime != null)

ipcMain.handle('studio:drain-signaling-messages', (_evt, max?: number) => {
  return signalingRuntime?.drainHostOutbound(typeof max === 'number' ? max : 80) ?? []
})

ipcMain.handle('studio:sig-send', (_evt, raw: string) => {
  try {
    const msg = JSON.parse(raw) as SignalingMsg
    if (msg.type !== 'answer' && msg.type !== 'ice') return false
    signalingRuntime?.injectHostMessage(msg)
    return true
  } catch {
    return false
  }
})

function dialogParentWindow(): BrowserWindow | undefined {
  // DevTools u otras ventanas pueden robar el foco; sin padre, en Windows el diálogo a veces falla o no filtra bien.
  return BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined
}

ipcMain.handle('studio:pick-output-dir', async () => {
  const r = await dialog.showOpenDialog(dialogParentWindow(), {
    properties: ['openDirectory', 'createDirectory']
  })
  if (r.canceled || !r.filePaths[0]) return null
  return r.filePaths[0]
})

/** Selección múltiple de WebM exportados por Studio Live (cam-*, audio-*). */
ipcMain.handle('studio:pick-fusion-files', async () => {
  const r = await dialog.showOpenDialog(dialogParentWindow(), {
    title: 'Pistas ISO para fusión',
    defaultPath: app.getPath('documents'),
    properties: ['openFile', 'multiSelections'],
    // Dos entradas: en Windows el desplegable "Tipo" permite ver todos los archivos si hace falta.
    filters: [
      { name: 'WebM (cam-*, audio-*)', extensions: ['webm'] },
      { name: 'Todos los archivos', extensions: ['*'] }
    ]
  })
  if (r.canceled || !r.filePaths.length) return null
  return r.filePaths
})

/**
 * URL para `<video>` / `<audio>` en el renderer. No usamos file:// directo: con la ventana en http://localhost
 * Chromium bloquea la carga; servimos el mismo archivo vía protocolo privado.
 */
ipcMain.handle('studio:path-to-file-url', async (_evt, absPath: unknown) => {
  if (typeof absPath !== 'string' || !path.isAbsolute(absPath)) return null
  try {
    await stat(absPath)
    return `studio-webm://studio/?path=${encodeURIComponent(absPath)}`
  } catch {
    return null
  }
})

ipcMain.handle(
  'studio:save-video',
  async (_evt, payload: { filePath: string; data: ArrayBuffer }) => {
    await writeFile(payload.filePath, Buffer.from(payload.data))
    return true
  }
)

/** WebM en memoria → MP4 H.264/AAC en disco (FFmpeg embebido). */
ipcMain.handle(
  'studio:save-fusion-mp4',
  async (_evt, payload: { outputPath: unknown; data: unknown }) => {
    try {
      if (typeof payload?.outputPath !== 'string' || !path.isAbsolute(payload.outputPath)) {
        return { ok: false as const, message: 'Ruta de salida inválida.' }
      }
      if (!(payload.data instanceof ArrayBuffer)) {
        return { ok: false as const, message: 'Datos inválidos.' }
      }
      const out = payload.outputPath
      if (!out.toLowerCase().endsWith('.mp4')) {
        return { ok: false as const, message: 'El archivo debe terminar en .mp4.' }
      }
      if (!getFFmpegPath()) {
        return { ok: false as const, message: 'FFmpeg no está disponible en esta plataforma.' }
      }
      const tmpWebm = path.join(app.getPath('temp'), `studio-fusion-${randomUUID()}.webm`)
      await writeFile(tmpWebm, Buffer.from(payload.data))
      try {
        await convertWebmFileToMp4(tmpWebm, out)
      } finally {
        await unlink(tmpWebm).catch(() => {})
      }
      return { ok: true as const }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false as const, message: msg }
    }
  }
)

function sanitizeRecordingFolderName(name: string): string {
  let s = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\.+$/u, '')
    .trim()
  if (s.length > 120) s = s.slice(0, 120)
  return s
}

/** Carpeta destino para una grabación ISO con nombre elegido por el usuario; evita duplicados (misma carpeta con .webm). */
ipcMain.handle(
  'studio:prepare-recording-folder',
  async (_evt, payload: { parentDir: unknown; folderName: unknown }) => {
    if (typeof payload?.parentDir !== 'string' || typeof payload.folderName !== 'string') {
      return { ok: false as const, message: 'Datos inválidos.' }
    }
    const parentDir = payload.parentDir
    const safe = sanitizeRecordingFolderName(payload.folderName)
    if (!safe) {
      return { ok: false as const, message: 'Elegí un nombre con letras o números (sin solo puntos ni símbolos prohibidos).' }
    }

    let parentStat
    try {
      parentStat = await stat(parentDir)
    } catch {
      return { ok: false as const, message: 'No se encontró la carpeta de grabación.' }
    }
    if (!parentStat.isDirectory()) {
      return { ok: false as const, message: 'La ruta de grabación no es una carpeta.' }
    }

    try {
      const entries = await readdir(parentDir, { withFileTypes: true })
      const wantedLower = safe.toLowerCase()
      const existingDir = entries.find(
        (e) => e.isDirectory() && e.name.toLowerCase() === wantedLower
      )
      if (existingDir) {
        const destDir = path.join(parentDir, existingDir.name)
        const inner = await readdir(destDir).catch(() => [])
        const hasWebm = inner.some((f) => f.toLowerCase().endsWith('.webm'))
        if (hasWebm) {
          return {
            ok: false as const,
            message:
              'Ya existe una grabación con ese nombre (hay archivos .webm en esa carpeta). Elegí otro nombre.'
          }
        }
        return { ok: true as const, destDir }
      }

      const destDir = path.join(parentDir, safe)
      await mkdir(destDir, { recursive: true })
      return { ok: true as const, destDir }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false as const, message: `No se pudo crear la carpeta: ${msg}` }
    }
  }
)

ipcMain.handle('studio:copy-text', (_evt, text: string) => {
  clipboard.writeText(text)
  return true
})

ipcMain.handle('studio:export-cert', async () => {
  const certPath = path.join(app.getPath('userData'), 'certs', 'studio-live-cert.pem')
  try {
    await readFile(certPath)
  } catch {
    return false
  }
  const r = await dialog.showSaveDialog(dialogParentWindow(), {
    title: 'Guardar certificado para el celular',
    defaultPath: 'studio-live-cert.crt',
    filters: [
      { name: 'Certificado', extensions: ['crt', 'pem'] },
      { name: 'Todos los archivos', extensions: ['*'] }
    ]
  })
  if (r.canceled || !r.filePath) return false
  const pem = await readFile(certPath)
  await writeFile(r.filePath, pem)
  return true
})

app.whenReady().then(async () => {
  protocol.handle('studio-webm', async (request) => {
    try {
      const u = new URL(request.url)
      const filePath = u.searchParams.get('path')
      if (!filePath) return new Response(null, { status: 400 })
      await stat(filePath)
      return net.fetch(pathToFileURL(filePath).href)
    } catch (e) {
      console.error('[studio-webm]', request.url, e)
      return new Response(null, { status: 404 })
    }
  })

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })

  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    if (isPrivateOrLoopbackHostname(request.hostname)) {
      callback(0)
      return
    }
    callback(-3)
  })

  const lanIps = getLanIPv4s()
  const certDir = path.join(app.getPath('userData'), 'certs')
  let tls: { key: string; cert: string }
  try {
    tls = await ensureStudioCerts(certDir, lanIps)
  } catch (e) {
    console.error('No se pudieron crear certificados HTTPS', e)
    app.quit()
    return
  }

  const staticDir = await ensureCameraClientDir()
  let started = false
  let lastErr: unknown
  for (let i = 0; i < PORT_TRIES; i++) {
    const port = DEFAULT_SIGNAL_PORT + i
    try {
      const rt = await createSignalingServer({
        port,
        cameraStaticDir: staticDir,
        tls
      })
      signalingRuntime = rt
      signalingPort = rt.port
      loopbackSignalingPort = rt.port
      hostPanelHttpPort = rt.hostPanelHttpPort
      started = true
      break
    } catch (e) {
      lastErr = e
    }
  }
  if (!started) {
    console.error('No se pudo abrir un puerto para señalización', lastErr)
    app.quit()
    return
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
