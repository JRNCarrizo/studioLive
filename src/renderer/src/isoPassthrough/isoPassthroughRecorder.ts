import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from 'mp4-muxer'
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from 'webm-muxer'
import {
  avcCodecString,
  buildAvcDecoderConfig,
  prepareH264AccessUnit,
  spropParameterSets,
  type H264Config
} from './h264Bitstream'
import type { IsoTapFrame, IsoVideoTap } from './isoVideoTap'
import type { PassthroughVideoCodec } from './videoCodec'
import type { IsoRecordedPart, IsoTrackRecorder } from '../isoTrackRecorder'

type PendingFrame = {
  data: Uint8Array
  type: 'key' | 'delta'
  timestamp: number
  meta?: EncodedVideoChunkMetadata
}

type WebmWriter = {
  kind: 'webm'
  muxer: WebmMuxer<WebmTarget>
  target: WebmTarget
}

type Mp4Writer = {
  kind: 'mp4'
  muxer: Mp4Muxer<Mp4Target>
  target: Mp4Target
}

/**
 * Guarda el video que ya llegó codificado por WebRTC, sin volver a comprimirlo.
 * El archivo arranca en el primer keyframe (se pide uno al celular al dar Grabar).
 */
export function startIsoPassthroughRecorder(opts: {
  tap: IsoVideoTap
  codec: PassthroughVideoCodec
  sdp: string
  widthHint: number
  heightHint: number
  onCommittedKeyframe?: () => void
}): IsoTrackRecorder {
  const { tap, codec, sdp, onCommittedKeyframe } = opts
  let widthHint = opts.widthHint
  let heightHint = opts.heightHint
  let writer: WebmWriter | Mp4Writer | null = null
  let h264Config: H264Config | null = null
  let pending: PendingFrame | null = null
  let lastTimestamp = -1
  let originMs: number | null = null
  let pauseShiftMs = 0
  let pauseBeganMs: number | null = null
  let paused = false
  let armed = true
  let committed = false
  let sentDecoderConfig = false
  let failed = false

  if (codec === 'h264') {
    const sprop = spropParameterSets(sdp)
    if (sprop) {
      h264Config = {
        sps: sprop.sps,
        pps: sprop.pps,
        avcC: buildAvcDecoderConfig(sprop.sps, sprop.pps),
        codec: avcCodecString(sprop.sps)
      }
    }
  }

  function mapTimestamp(receiveTimeMs: number): number {
    if (originMs == null) originMs = receiveTimeMs
    let us = Math.round((receiveTimeMs - originMs - pauseShiftMs) * 1000)
    if (us <= lastTimestamp) us = lastTimestamp + 1
    lastTimestamp = us
    return us
  }

  function write(frame: PendingFrame, durationUs: number): void {
    if (!writer) return
    if (writer.kind === 'webm') {
      writer.muxer.addVideoChunkRaw(frame.data, frame.type, frame.timestamp, frame.meta)
      return
    }
    writer.muxer.addVideoChunkRaw(frame.data, frame.type, frame.timestamp, durationUs, frame.meta)
  }

  function enqueue(frame: PendingFrame): void {
    if (pending) write(pending, Math.max(1, frame.timestamp - pending.timestamp))
    pending = frame
    if (frame.type === 'key' && !committed) {
      committed = true
      onCommittedKeyframe?.()
    }
  }

  function accept(frame: IsoTapFrame): void {
    if (!armed || paused || failed || pauseBeganMs != null) return
    try {
      const width = frame.width || widthHint || 1280
      const height = frame.height || heightHint || 720
      const timestamp = mapTimestamp(frame.receiveTimeMs)

      if (codec === 'h264') {
        const prepared = prepareH264AccessUnit(frame.data, h264Config)
        if (prepared?.config) h264Config = prepared.config
        if (!prepared || !prepared.data.byteLength || !h264Config) return
        if (!writer) {
          if (frame.type !== 'key') return
          widthHint = width
          heightHint = height
          const target = new Mp4Target()
          writer = {
            kind: 'mp4',
            target,
            muxer: new Mp4Muxer({
              target,
              fastStart: 'in-memory',
              firstTimestampBehavior: 'offset',
              video: { codec: 'avc', width, height }
            })
          }
        }
        const meta: EncodedVideoChunkMetadata | undefined =
          !sentDecoderConfig && frame.type === 'key'
            ? {
                decoderConfig: {
                  codec: h264Config.codec,
                  description: h264Config.avcC,
                  codedWidth: width,
                  codedHeight: height
                }
              }
            : undefined
        if (meta) sentDecoderConfig = true
        enqueue({ data: prepared.data, type: frame.type, timestamp, meta })
        return
      }

      if (!writer) {
        if (frame.type !== 'key') return
        widthHint = width
        heightHint = height
        const target = new WebmTarget()
        writer = {
          kind: 'webm',
          target,
          muxer: new WebmMuxer({
            target,
            firstTimestampBehavior: 'offset',
            video: { codec: codec === 'vp9' ? 'V_VP9' : 'V_VP8', width, height }
          })
        }
      }
      enqueue({ data: frame.data, type: frame.type, timestamp })
    } catch (e) {
      failed = true
      console.warn('[studio-live] copia directa de video interrumpida', e)
    }
  }

  tap.setHandler(accept)
  tap.setRecording(true)

  return {
    pause() {
      if (!armed || paused) return
      paused = true
      pauseBeganMs = performance.now()
      tap.setPaused(true)
    },
    resume() {
      if (!armed || !paused) return
      if (pauseBeganMs != null) {
        pauseShiftMs += performance.now() - pauseBeganMs
        pauseBeganMs = null
      }
      paused = false
      tap.setPaused(false)
    },
    stop() {
      armed = false
      tap.setRecording(false)
      tap.setHandler(null)
      if (failed || !writer || !committed) {
        pending = null
        return Promise.resolve(null)
      }
      try {
        if (pending) {
          write(pending, 33_333)
          pending = null
        }
        writer.muxer.finalize()
        const mime = writer.kind === 'mp4' ? 'video/mp4' : 'video/webm'
        return Promise.resolve({ parts: [writer.target.buffer], mime })
      } catch (e) {
        console.warn('[studio-live] no se pudo cerrar el archivo de copia directa', e)
        return Promise.resolve(null)
      }
    }
  }
}

function stopCompressedRecorder(rec: MediaRecorder, chunks: BlobPart[]): Promise<IsoRecordedPart | null> {
  if (rec.state === 'inactive') {
    return Promise.resolve(chunks.length ? { parts: [...chunks], mime: rec.mimeType || 'video/webm' } : null)
  }
  return new Promise((resolve) => {
    rec.onstop = () => {
      resolve(chunks.length ? { parts: [...chunks], mime: rec.mimeType || 'video/webm' } : null)
    }
    try {
      rec.stop()
    } catch {
      resolve(null)
    }
  })
}

/**
 * Graba en paralelo con MediaRecorder solo hasta el primer keyframe.
 * A partir de ahí se descarta esa copia recomprimida y queda el video original.
 * Si el keyframe nunca llega, se conserva la copia comprimida.
 */
export function startHybridCameraRecorder(opts: {
  tap: IsoVideoTap
  codec: PassthroughVideoCodec
  sdp: string
  widthHint: number
  heightHint: number
  compressed: MediaRecorder
  chunks: BlobPart[]
}): IsoTrackRecorder {
  let released = false
  const releaseCompressed = () => {
    if (released) return
    released = true
    opts.chunks.length = 0
    opts.compressed.ondataavailable = () => {}
    if (opts.compressed.state === 'recording' || opts.compressed.state === 'paused') {
      try {
        opts.compressed.stop()
      } catch {
        /* vacío */
      }
    }
  }

  const passthrough = startIsoPassthroughRecorder({
    tap: opts.tap,
    codec: opts.codec,
    sdp: opts.sdp,
    widthHint: opts.widthHint,
    heightHint: opts.heightHint,
    onCommittedKeyframe: releaseCompressed
  })

  return {
    pause() {
      passthrough.pause()
      if (!released && opts.compressed.state === 'recording') {
        try {
          opts.compressed.pause()
        } catch {
          /* vacío */
        }
      }
    },
    resume() {
      passthrough.resume()
      if (!released && opts.compressed.state === 'paused') {
        try {
          opts.compressed.resume()
        } catch {
          /* vacío */
        }
      }
    },
    async stop() {
      const passed = await passthrough.stop()
      if (passed) {
        releaseCompressed()
        return passed
      }
      if (released) return null
      return stopCompressedRecorder(opts.compressed, opts.chunks)
    }
  }
}
