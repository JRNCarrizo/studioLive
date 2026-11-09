export type IsoTapFrame = {
  type: 'key' | 'delta'
  timestamp: number
  receiveTimeMs: number
  width: number
  height: number
  data: Uint8Array
}

type FrameMessage = {
  kind: 'frame'
  type: 'key' | 'delta'
  timestamp: number
  receiveTimeMs: number
  width: number
  height: number
  data: ArrayBuffer
}

export function isoPassthroughSupported(): boolean {
  return typeof RTCRtpScriptTransform === 'function'
}

let sharedWorker: Worker | null = null

function tapWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL('./isoTap.worker.ts', import.meta.url), { type: 'module' })
  }
  return sharedWorker
}

/**
 * Se engancha al receptor WebRTC una vez. Mientras no se graba, los frames solo siguen de largo
 * (la miniatura no se entera). Al grabar, manda una copia del frame ya codificado.
 */
export class IsoVideoTap {
  ready = false
  private handler: ((frame: IsoTapFrame) => void) | null = null

  constructor(
    readonly cameraId: string,
    private readonly port: MessagePort
  ) {
    this.port.onmessage = (ev: MessageEvent<FrameMessage | { kind: 'ready' }>) => {
      const msg = ev.data
      if (!msg || typeof msg !== 'object') return
      if (msg.kind === 'ready') {
        this.ready = true
        return
      }
      if (msg.kind !== 'frame' || !this.handler) return
      if (!(msg.data instanceof ArrayBuffer) || !msg.data.byteLength) return
      this.handler({
        type: msg.type,
        timestamp: msg.timestamp,
        receiveTimeMs: msg.receiveTimeMs,
        width: msg.width,
        height: msg.height,
        data: new Uint8Array(msg.data)
      })
    }
  }

  setHandler(handler: ((frame: IsoTapFrame) => void) | null): void {
    this.handler = handler
  }

  setRecording(on: boolean): void {
    this.port.postMessage({ action: on ? 'start' : 'stop' })
  }

  setPaused(paused: boolean): void {
    this.port.postMessage({ action: paused ? 'pause' : 'resume' })
  }

  dispose(): void {
    this.handler = null
    try {
      this.port.postMessage({ action: 'stop' })
    } catch {
      /* puerto cerrado */
    }
    this.port.close()
  }
}

export function attachIsoVideoTap(cameraId: string, receiver: RTCRtpReceiver): IsoVideoTap | null {
  if (!isoPassthroughSupported()) return null
  if (receiver.track.kind !== 'video') return null
  try {
    const channel = new MessageChannel()
    const transform = new RTCRtpScriptTransform(tapWorker(), { port: channel.port1 }, [channel.port1])
    receiver.transform = transform
    return new IsoVideoTap(cameraId, channel.port2)
  } catch (e) {
    console.warn('[studio-live] no se pudo enganchar la copia directa del video', e)
    return null
  }
}
