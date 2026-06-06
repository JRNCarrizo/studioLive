import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'

export type UpdateEventPayload =
  | { phase: 'checking' }
  | { phase: 'available'; version: string }
  | { phase: 'not-available' }
  | { phase: 'downloading'; percent: number }
  | { phase: 'ready'; version: string }
  | { phase: 'error'; message: string }

let mainWindow: BrowserWindow | null = null

function sendUpdateEvent(payload: UpdateEventPayload): void {
  mainWindow?.webContents.send('studio:update-event', payload)
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
    sendUpdateEvent({ phase: 'error', message: err.message })
  })

  ipcMain.handle('studio:check-for-updates', async () => {
    try {
      await autoUpdater.checkForUpdates()
      return { ok: true as const }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      sendUpdateEvent({ phase: 'error', message })
      return { ok: false as const, message }
    }
  })

  ipcMain.handle('studio:install-update', () => {
    autoUpdater.quitAndInstall(false, true)
    return true
  })

  /** No bloquear el arranque (signaling + UI primero). */
  window.setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((e) => {
      const message = e instanceof Error ? e.message : String(e)
      sendUpdateEvent({ phase: 'error', message })
    })
  }, 8000)
}
