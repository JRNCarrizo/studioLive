import { contextBridge, ipcRenderer } from 'electron'

export type StudioInfo = {
  port: number
  loopbackSignalingPort: number
  /** HTTP 127.0.0.1 — fetch pull/push sin IPC */
  hostPanelHttpPort: number
  ips: string[]
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
  pathToFileUrl: (absPath: string): Promise<string | null> =>
    ipcRenderer.invoke('studio:path-to-file-url', absPath),
  saveVideo: (filePath: string, data: ArrayBuffer): Promise<boolean> =>
    ipcRenderer.invoke('studio:save-video', { filePath, data }),
  saveFusionMp4: (
    outputPath: string,
    data: ArrayBuffer
  ): Promise<{ ok: true } | { ok: false; message: string }> =>
    ipcRenderer.invoke('studio:save-fusion-mp4', { outputPath, data }),
  prepareRecordingFolder: (
    parentDir: string,
    folderName: string
  ): Promise<{ ok: true; destDir: string } | { ok: false; message: string }> =>
    ipcRenderer.invoke('studio:prepare-recording-folder', { parentDir, folderName }),
  copyText: (text: string): Promise<boolean> =>
    ipcRenderer.invoke('studio:copy-text', text),
  exportCert: (): Promise<boolean> => ipcRenderer.invoke('studio:export-cert')
})
