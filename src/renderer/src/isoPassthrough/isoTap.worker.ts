/** Copia los frames ya codificados y los deja seguir hacia el decoder de la vista previa. */

type TapMeta = {
  width?: number
  height?: number
  receiveTime?: number
}

type EncodedTapFrame = {
  type: 'key' | 'delta'
  timestamp: number
  data: ArrayBuffer
  getMetadata?: () => TapMeta
}

type TransformEvent = {
  transformer: {
    readable: ReadableStream<EncodedTapFrame>
    writable: WritableStream<EncodedTapFrame>
    options: { port?: MessagePort }
  }
}

const scope = self as unknown as {
  onrtctransform: ((event: TransformEvent) => void) | null
}

scope.onrtctransform = (event) => {
  const { readable, writable, options } = event.transformer
  const port = options.port
  let recording = false
  let paused = false

  if (port) {
    port.onmessage = (ev: MessageEvent<{ action?: string }>) => {
      const action = ev.data?.action
      if (action === 'start') {
        recording = true
        paused = false
      } else if (action === 'pause') paused = true
      else if (action === 'resume') paused = false
      else if (action === 'stop') {
        recording = false
        paused = false
      }
    }
    port.postMessage({ kind: 'ready' })
  }

  const reader = readable.getReader()
  const writer = writable.getWriter()

  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        if (port && recording && !paused && (value.type === 'key' || value.type === 'delta')) {
          const copy = value.data.slice(0)
          let meta: TapMeta = {}
          try {
            meta = value.getMetadata?.() ?? {}
          } catch {
            meta = {}
          }
          const receiveTimeMs =
            typeof meta.receiveTime === 'number' && Number.isFinite(meta.receiveTime)
              ? meta.receiveTime
              : performance.now()
          port.postMessage(
            {
              kind: 'frame',
              type: value.type,
              timestamp: value.timestamp,
              receiveTimeMs,
              width: meta.width ?? 0,
              height: meta.height ?? 0,
              data: copy
            },
            [copy]
          )
        }
        await writer.write(value)
      }
    } catch {
      /* el PeerConnection se cerró */
    } finally {
      try {
        await writer.close()
      } catch {
        /* ya cerrado */
      }
    }
  })()
}

export {}
