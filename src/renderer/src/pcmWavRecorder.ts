import type { IsoTrackRecorder } from './isoTrackRecorder'

function interleaveToInt16(channels: Float32Array[]): Int16Array {
  const count = channels.length
  const frames = channels[0]?.length ?? 0
  const out = new Int16Array(frames * count)
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      const sample = channels[c][i] ?? 0
      const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample
      out[i * count + c] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
    }
  }
  return out
}

function wavBlob(chunks: Int16Array[], sampleRate: number, channels: number): Blob {
  let samples = 0
  for (const chunk of chunks) samples += chunk.length
  const dataBytes = samples * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)
  const writeStr = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataBytes, true)
  const pcm = new Int16Array(buffer, 44)
  let offset = 0
  for (const chunk of chunks) {
    pcm.set(chunk, offset)
    offset += chunk.length
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

/**
 * PCM 16-bit del grafo de la PC (WASAPI compartido, ya sin AGC/eco).
 * Una sola codificación: la del driver. No se vuelve a comprimir a Opus.
 */
export async function startPcmWavRecorder(stream: MediaStream): Promise<IsoTrackRecorder> {
  const track = stream.getAudioTracks()[0]
  if (!track || track.readyState !== 'live') {
    throw new Error('no hay pista de audio')
  }
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) throw new Error('sin AudioContext')

  const ctx = new AC()
  await ctx.audioWorklet.addModule(new URL('./pcmCapture.worklet.js', import.meta.url))
  await ctx.resume()

  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'studio-pcm-capture')
  const silent = ctx.createGain()
  silent.gain.value = 0
  source.connect(node)
  node.connect(silent)
  silent.connect(ctx.destination)

  const chunks: Int16Array[] = []
  let channels = Math.max(1, source.channelCount || 1)
  let paused = false

  node.port.onmessage = (ev: MessageEvent<{ channels?: Float32Array[] }>) => {
    if (paused) return
    const incoming = ev.data?.channels
    if (!incoming?.length || !incoming[0]?.length) return
    channels = incoming.length
    chunks.push(interleaveToInt16(incoming))
  }

  return {
    pause() {
      paused = true
      node.port.postMessage({ action: 'pause' })
    },
    resume() {
      paused = false
      node.port.postMessage({ action: 'resume' })
    },
    async stop() {
      paused = true
      node.port.postMessage({ action: 'pause' })
      try {
        node.disconnect()
        source.disconnect()
        silent.disconnect()
      } catch {
        /* ya desconectado */
      }
      await new Promise((resolve) => setTimeout(resolve, 40))
      const blob = chunks.length ? wavBlob(chunks, ctx.sampleRate, channels) : null
      chunks.length = 0
      await ctx.close().catch(() => {})
      if (!blob || blob.size <= 44) return null
      return { parts: [blob], mime: 'audio/wav' }
    }
  }
}
