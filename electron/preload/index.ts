import { contextBridge, ipcRenderer } from 'electron'

export type StudioInfo = {
  port: number
  loopbackSignalingPort: number
  /** HTTP 127.0.0.1 — fetch pull/push sin IPC */
  hostPanelHttpPort: number
  ips: string[]
  platform: NodeJS.Platform
  hwAccelDisabled: boolean
}

contextBridge.exposeInMainWorld('studio', {
  getInfo: (): Promise<StudioInfo> => ipcRenderer.invoke('studio:get-info'),
  /** Señalización PC ← celulares: el main encola JSON; el renderer lo vacía con polling. */
  drainSigMsgs: (max?: number): Promise<string[]> =>
    ipcRenderer.invoke('studio:drain-signaling-messages', max),
  isSigReady: (): Promise<boolean> => ipcRenderer.invoke('studio:is-sig-ready'),
  sendSig: (raw: string): Promise<boolean> => ipcRenderer.invoke('studio:sig-send', raw),
  pickOutputDir: (): Promise<string | null> =>
    ipcRenderer.invoke('studio:pick-output-dir'),
  pickFusionFiles: (): Promise<string[] | null> =>
    ipcRenderer.invoke('studio:pick-fusion-files'),
  pickImageFile: (): Promise<string | null> => ipcRenderer.invoke('studio:pick-image-file'),
  readImageDataUrl: (absPath: string): Promise<string | null> =>
    ipcRenderer.invoke('studio:read-image-data-url', absPath),
  pathToFileUrl: (absPath: string): Promise<string | null> =>
    ipcRenderer.invoke('studio:path-to-file-url', absPath),
  saveVideo: (
    filePath: string,
    data: ArrayBuffer,
    trim?: { startSec: number; endSec: number }
  ): Promise<boolean> => ipcRenderer.invoke('studio:save-video', { filePath, data, trim }),
  saveFusionMp4: (
    outputPath: string,
    data: ArrayBuffer,
    trim?: { startSec: number; endSec: number }
  ): Promise<{ ok: true } | { ok: false; message: string }> =>
    ipcRenderer.invoke('studio:save-fusion-mp4', { outputPath, data, trim }),
  prepareRecordingFolder: (
    parentDir: string,
    folderName: string
  ): Promise<{ ok: true; destDir: string } | { ok: false; message: string }> =>
    ipcRenderer.invoke('studio:prepare-recording-folder', { parentDir, folderName }),
  copyText: (text: string): Promise<boolean> =>
    ipcRenderer.invoke('studio:copy-text', text),
  exportCert: (): Promise<boolean> => ipcRenderer.invoke('studio:export-cert'),
  minimizeMainWindow: (): Promise<boolean> => ipcRenderer.invoke('studio:minimize-main-window'),
  isExcludeFromCaptureSupported: (): Promise<boolean> =>
    ipcRenderer.invoke('studio:is-exclude-from-capture-supported'),
  setExcludeFromCapture: (
    enabled: boolean
  ): Promise<{ ok: boolean; supported: boolean }> =>
    ipcRenderer.invoke('studio:set-exclude-from-capture', enabled),
  setPendingDisplaySource: (sourceId: string): Promise<boolean> =>
    ipcRenderer.invoke('studio:set-pending-display-source', sourceId),
  listDisplaySources: (): Promise<
    Array<{
      id: string
      name: string
      thumbnailDataUrl: string
      kind: 'screen' | 'window'
    }>
  > => ipcRenderer.invoke('studio:list-display-sources'),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('studio:get-app-version'),
  checkForUpdates: (): Promise<{ ok: true } | { ok: false; reason?: 'dev'; message?: string }> =>
    ipcRenderer.invoke('studio:check-for-updates'),
  installUpdate: (): Promise<boolean> => ipcRenderer.invoke('studio:install-update'),
  onUpdateEvent: (callback: (payload: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('studio:update-event', handler)
    return () => ipcRenderer.removeListener('studio:update-event', handler)
  }
})
