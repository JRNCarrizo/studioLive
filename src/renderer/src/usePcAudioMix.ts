import { useEffect, useRef, useState } from 'react'

export type PcAudioMixResult = {
  /** Pista post-ganancia para grabar / mezclar; null si no hay mic o falló Web Audio. */
  processedStream: MediaStream | null
  analyser: AnalyserNode | null
}

export type PcProcessedGraph = {
  stream: MediaStream
  dispose: () => void
}

function readInputChannelCount(stream: MediaStream): number {
  const track = stream.getAudioTracks()[0]
  if (!track) return 1
  const n = track.getSettings().channelCount
  return typeof n === 'number' && n >= 2 ? n : 1
}

/**
 * Mono → duplica L+R (evita oír solo un auricular al reproducir).
 * Estéreo → pasa directo sin mezclar canales.
 */
function connectInputToGain(
  ctx: AudioContext,
  src: MediaStreamAudioSourceNode,
  inputChannels: number,
  gainNode: GainNode
): AudioNode[] {
  const wired: AudioNode[] = []
  if (inputChannels >= 2) {
    src.connect(gainNode)
    wired.push(src)
    return wired
  }

  const merger = ctx.createChannelMerger(2)
  src.connect(merger, 0, 0)
  src.connect(merger, 0, 1)
  merger.connect(gainNode)
  wired.push(src, merger)
  return wired
}

/** Grafo one-shot (p. ej. al pulsar Grabar sin mic abierto). */
export function createPcProcessedStream(
  rawStream: MediaStream,
  gainLinear: number
): PcProcessedGraph | null {
  const track = rawStream.getAudioTracks()[0]
  if (!track || track.readyState !== 'live') return null

  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null

  const ctx = new AC()
  const src = ctx.createMediaStreamSource(rawStream)
  const gainNode = ctx.createGain()
  gainNode.gain.value = gainLinear
  const dest = ctx.createMediaStreamDestination()
  const wired = connectInputToGain(ctx, src, readInputChannelCount(rawStream), gainNode)
  gainNode.connect(dest)
  void ctx.resume()

  return {
    stream: dest.stream,
    dispose: () => {
      wired.forEach((n) => n.disconnect())
      gainNode.disconnect()
      void ctx.close()
    }
  }
}

/**
 * Cadena: MediaStream → (mono→estéreo) → GainNode → MediaStreamDestination (+ Analyser en paralelo).
 * La ganancia se actualiza sin recrear el grafo (solo `gain.value`).
 */
export function usePcAudioMix(rawStream: MediaStream | null, gainLinear: number): PcAudioMixResult {
  const [processedStream, setProcessedStream] = useState<MediaStream | null>(null)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)

  useEffect(() => {
    const track = rawStream?.getAudioTracks()[0]
    const alive = Boolean(track && track.readyState === 'live')
    if (!alive) {
      gainRef.current = null
      setProcessedStream(null)
      setAnalyser(null)
      return
    }

    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) {
      gainRef.current = null
      setProcessedStream(null)
      setAnalyser(null)
      return
    }

    const ctx = new AC()
    const src = ctx.createMediaStreamSource(rawStream!)
    const gainNode = ctx.createGain()
    gainNode.gain.value = gainLinear
    const dest = ctx.createMediaStreamDestination()
    const analyserNode = ctx.createAnalyser()
    analyserNode.fftSize = 2048
    analyserNode.smoothingTimeConstant = 0.42

    const wired = connectInputToGain(ctx, src, readInputChannelCount(rawStream!), gainNode)
    gainNode.connect(dest)
    gainNode.connect(analyserNode)

    gainRef.current = gainNode
    void ctx.resume()
    setProcessedStream(dest.stream)
    setAnalyser(analyserNode)

    return () => {
      gainRef.current = null
      wired.forEach((n) => n.disconnect())
      gainNode.disconnect()
      analyserNode.disconnect()
      void ctx.close()
      setProcessedStream(null)
      setAnalyser(null)
    }
  }, [rawStream])

  useEffect(() => {
    const g = gainRef.current
    if (g) g.gain.value = gainLinear
  }, [gainLinear])

  return { processedStream, analyser }
}
