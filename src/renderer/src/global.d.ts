export {}

declare global {
  interface Window {
    studio: {
      getInfo: () => Promise<{
        port: number
        loopbackSignalingPort: number
        hostPanelHttpPort: number
        ips: string[]
      }>
      drainSigMsgs: (max?: number) => Promise<string[]>
      isSigReady: () => Promise<boolean>
      sendSig: (raw: string) => Promise<boolean>
      pickOutputDir: () => Promise<string | null>
      pickFusionFiles: () => Promise<string[] | null>
      pickImageFile: () => Promise<string | null>
      readImageDataUrl: (absPath: string) => Promise<string | null>
      pathToFileUrl: (absPath: string) => Promise<string | null>
      saveVideo: (filePath: string, data: ArrayBuffer) => Promise<boolean>
      saveFusionMp4: (
        outputPath: string,
        data: ArrayBuffer
      ) => Promise<{ ok: true } | { ok: false; message: string }>
      prepareRecordingFolder: (
        parentDir: string,
        folderName: string
      ) => Promise<{ ok: true; destDir: string } | { ok: false; message: string }>
      copyText: (text: string) => Promise<boolean>
      exportCert: () => Promise<boolean>
      minimizeMainWindow: () => Promise<boolean>
      listDisplaySources: () => Promise<
        Array<{
          id: string
          name: string
          thumbnailDataUrl: string
          kind: 'screen' | 'window'
        }>
      >
    }
  }
}
