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
let userInitiatedCheck = false

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
    return 'Todavía no hay Release publicado en GitHub con latest.yml. Ejecutá npm run release:upload en el proyecto.'
  }
  return raw
}

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

  autoUpdater.on('checking-for-update', () => {
    if (userInitiatedCheck) sendUpdateEvent({ phase: 'checking' })
  })
  autoUpdater.on('update-available', (info) => {
    sendUpdateEvent({ phase: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    if (userInitiatedCheck) {
      sendUpdateEvent({ phase: 'not-available' })
      userInitiatedCheck = false
    }
  })
  autoUpdater.on('download-progress', (progress) => {
    sendUpdateEvent({ phase: 'downloading', percent: progress.percent })
  })
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateEvent({ phase: 'ready', version: info.version })
    userInitiatedCheck = false
  })
  autoUpdater.on('error', (err) => {
    if (!userInitiatedCheck) {
      console.warn('[studio-update]', friendlyUpdateError(err.message))
      return
    }
    sendUpdateEvent({ phase: 'error', message: friendlyUpdateError(err.message) })
    userInitiatedCheck = false
  })

  ipcMain.handle('studio:check-for-updates', async () => {
    userInitiatedCheck = true
    sendUpdateEvent({ phase: 'checking' })
    try {
      await autoUpdater.checkForUpdates()
      return { ok: true as const }
    } catch (e) {
      const message = friendlyUpdateError(e instanceof Error ? e.message : String(e))
      sendUpdateEvent({ phase: 'error', message })
      userInitiatedCheck = false
      return { ok: false as const, message }
    }
  })

  ipcMain.handle('studio:install-update', () => {
    autoUpdater.quitAndInstall(false, true)
    return true
  })

  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((e) => {
      console.warn('[studio-update]', friendlyUpdateError(e instanceof Error ? e.message : String(e)))
    })
  }, 8000)
}
