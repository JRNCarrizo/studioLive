import { createRequire } from 'node:module'

import { app, BrowserWindow, ipcMain } from 'electron'

import type { AppUpdater } from 'electron-updater'

export type UpdateEventPayload =
  | { phase: 'checking' }
  | { phase: 'available'; version: string }
  | { phase: 'not-available' }
  | { phase: 'downloading'; percent: number }
  | { phase: 'ready'; version: string }
  | { phase: 'error'; message: string }

const requireUpdater = createRequire(import.meta.url)

let mainWindow: BrowserWindow | null = null

function sendUpdateEvent(payload: UpdateEventPayload): void {
  mainWindow?.webContents.send('studio:update-event', payload)
}

function friendlyUpdateError(raw: string): string {
  const lower = raw.toLowerCase()
  if (
    lower.includes('404') ||
    lower.includes('406') ||
    lower.includes('latest.yml') ||
    lower.includes('cannot find') ||
    lower.includes('no published versions')
  ) {
    return [
      'No se encontró un Release válido en GitHub (falta latest.yml o el tag v0.x.x).',
      'Publicá el Release con npm run dist:publish o subí latest.yml + el .exe al Release.'
    ].join(' ')
  }
  return raw
}

/** electron-updater es CJS; import ESM falla en el .exe empaquetado. */
function loadAutoUpdater(): AppUpdater | null {
  try {
    return requireUpdater('electron-updater').autoUpdater as AppUpdater
  } catch (e) {
    console.error('[studio-update] No se pudo cargar electron-updater', e)
    return null
  }
}

export function bindAutoUpdateWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

export function setupAutoUpdater(): void {
  ipcMain.handle('studio:get-app-version', () => app.getVersion())

  if (!app.isPackaged) {
    ipcMain.handle('studio:check-for-updates', async () => ({
      ok: false as const,
      reason: 'dev' as const
    }))
    ipcMain.handle('studio:install-update', () => false)
    return
  }

  const autoUpdater = loadAutoUpdater()
  if (!autoUpdater) {
    ipcMain.handle('studio:check-for-updates', async () => ({
      ok: false as const,
      message: 'Actualizaciones no disponibles en esta instalación.'
    }))
    ipcMain.handle('studio:install-update', () => false)
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => sendUpdateEvent({ phase: 'checking' }))
  autoUpdater.on('update-available', (info) => {
    sendUpdateEvent({ phase: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => sendUpdateEvent({ phase: 'not-available' }))
  autoUpdater.on('download-progress', (progress) => {
    sendUpdateEvent({ phase: 'downloading', percent: progress.percent })
  })
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateEvent({ phase: 'ready', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    sendUpdateEvent({ phase: 'error', message: friendlyUpdateError(err.message) })
  })

  ipcMain.handle('studio:check-for-updates', async () => {
    try {
      await autoUpdater.checkForUpdates()
      return { ok: true as const }
    } catch (e) {
      const message = friendlyUpdateError(e instanceof Error ? e.message : String(e))
      sendUpdateEvent({ phase: 'error', message })
      return { ok: false as const, message }
    }
  })

  ipcMain.handle('studio:install-update', () => {
    autoUpdater.quitAndInstall(false, true)
    return true
  })

  /** No bloquear el arranque (signaling + UI primero). */
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((e) => {
      const message = friendlyUpdateError(e instanceof Error ? e.message : String(e))
      console.warn('[studio-update]', message)
      sendUpdateEvent({ phase: 'error', message })
    })
  }, 8000)
}
