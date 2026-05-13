import { useEffect, useRef, useState } from 'react'

export type PcAudioMixResult = {
  /** Pista post-ganancia para grabar / mezclar; null si no hay mic o falló Web Audio. */
  processedStream: MediaStream | null
  analyser: AnalyserNode | null
}

/**
 * Cadena: MediaStream → GainNode → MediaStreamDestination (+ Analyser en paralelo).
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

    src.connect(gainNode)
    gainNode.connect(dest)
    gainNode.connect(analyserNode)

    gainRef.current = gainNode
    void ctx.resume()
    setProcessedStream(dest.stream)
    setAnalyser(analyserNode)

    return () => {
      gainRef.current = null
      src.disconnect()
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
