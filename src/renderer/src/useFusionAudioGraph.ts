import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Definición de cada banda. Para low/high-shelf el `q` es ignorado por el browser; lo dejo igual para simplificar la UI.
 * `defaultFreq` se asume fijo (no editable por el usuario) → presets sólo cambian `gainDb`.
 */
export type EqBandKind = 'lowshelf' | 'peaking' | 'highshelf'

export type EqBandConfig = {
  kind: EqBandKind
  freq: number
  q: number
  label: string
}

export const FUSION_EQ_BANDS: readonly EqBandConfig[] = [
  { kind: 'lowshelf', freq: 80, q: 0.7, label: '80 Hz' },
  { kind: 'peaking', freq: 250, q: 1.1, label: '250 Hz' },
  { kind: 'peaking', freq: 1000, q: 1.0, label: '1 kHz' },
  { kind: 'peaking', freq: 4000, q: 1.0, label: '4 kHz' },
  { kind: 'highshelf', freq: 10000, q: 0.7, label: '10 kHz' }
] as const

export type EqGains = number[] // 5 valores, dB, [-12, +12]

export const EQ_BAND_COUNT = FUSION_EQ_BANDS.length

export const EQ_PRESETS: { id: string; label: string; gains: EqGains }[] = [
  { id: 'flat', label: 'Plano', gains: [0, 0, 0, 0, 0] },
  { id: 'voice', label: 'Voz clara', gains: [-3, -3, 1.5, 3, 2] },
  { id: 'rumble', label: 'Quitar retumbe', gains: [-8, -4, 0, 0, 0] },
  { id: 'air', label: 'Aire / Brillo', gains: [0, 0, 0, 2.5, 4] },
  { id: 'warmth', label: 'Calidez', gains: [2, 1.5, 0, 0, 0] },
  { id: 'phone', label: 'Telefónico (efecto)', gains: [-10, -3, 3, 3, -10] }
]

const GAINS_STORAGE = 'studioLive.fusionEq.gains.v1'
const BYPASS_STORAGE = 'studioLive.fusionEq.bypass.v1'

function clampDb(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(-12, Math.min(12, v))
}

function readStoredGains(): EqGains {
  try {
    const raw = localStorage.getItem(GAINS_STORAGE)
    if (!raw) return [0, 0, 0, 0, 0]
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr) || arr.length !== EQ_BAND_COUNT) return [0, 0, 0, 0, 0]
    return arr.map((x) => clampDb(Number(x)))
  } catch {
    return [0, 0, 0, 0, 0]
  }
}

function writeStoredGains(g: EqGains) {
  try {
    localStorage.setItem(GAINS_STORAGE, JSON.stringify(g))
  } catch {
    /* vacío */
  }
}

function readStoredBypass(): boolean {
  try {
    return localStorage.getItem(BYPASS_STORAGE) === '1'
  } catch {
    return false
  }
}

function writeStoredBypass(b: boolean) {
  try {
    localStorage.setItem(BYPASS_STORAGE, b ? '1' : '0')
  } catch {
    /* vacío */
  }
}

export type FusionAudioGraph = {
  /** Pista de audio post-EQ para alimentar al MediaRecorder de fusión. Null si todavía no hay audio. */
  processedTrack: MediaStreamTrack | null
  /** Analyser conectado al bus de salida (refleja lo que se oye y se graba). */
  analyser: AnalyserNode | null
  gains: EqGains
  setBandGain: (index: number, dbValue: number) => void
  applyPreset: (gains: EqGains) => void
  bypass: boolean
  setBypass: (b: boolean) => void
  /** Sample rate del contexto (para dibujar la curva de respuesta a la escala correcta). */
  sampleRate: number
  /** Array de filtros si querés calcular la curva combinada con `getFrequencyResponse`. */
  filters: BiquadFilterNode[]
}

/**
 * Cadena fija para el audio de fusión:
 *   source(<audio>) ──┬→ eq1 → eq2 → eq3 → eq4 → eq5 → gainEQ ──┐
 *                     └→ gainDry ─────────────────────────────────┴→ outBus → audioCtx.destination (monitor)
 *                                                                            └→ mediaStreamDestination (grabador)
 * `bypass` cruza el switch: gainDry=1/gainEQ=0 o al revés.
 * `createMediaElementSource` sólo se llama UNA vez por elemento; mantenemos el contexto vivo durante todo el ciclo de vida del componente.
 */
export function useFusionAudioGraph(
  audioEl: HTMLAudioElement | null,
  audioReady: boolean
): FusionAudioGraph {
  const [gains, setGains] = useState<EqGains>(() => readStoredGains())
  const [bypass, setBypassState] = useState<boolean>(() => readStoredBypass())
  const [processedTrack, setProcessedTrack] = useState<MediaStreamTrack | null>(null)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [sampleRate, setSampleRate] = useState(48000)

  const ctxRef = useRef<AudioContext | null>(null)
  const filtersRef = useRef<BiquadFilterNode[]>([])
  const gainEqRef = useRef<GainNode | null>(null)
  const gainDryRef = useRef<GainNode | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const builtForElRef = useRef<HTMLAudioElement | null>(null)

  /** Resume del contexto en cualquier evento de usuario (autoplay policy). */
  const userActivityResume = useCallback(() => {
    const ctx = ctxRef.current
    if (ctx && ctx.state === 'suspended') void ctx.resume()
  }, [])

  useEffect(() => {
    window.addEventListener('mousedown', userActivityResume)
    window.addEventListener('keydown', userActivityResume)
    return () => {
      window.removeEventListener('mousedown', userActivityResume)
      window.removeEventListener('keydown', userActivityResume)
    }
  }, [userActivityResume])

  /** Construye la cadena una sola vez por elemento. */
  useEffect(() => {
    if (!audioEl || !audioReady) return
    if (builtForElRef.current === audioEl && ctxRef.current) return

    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return

    let ctx: AudioContext
    try {
      ctx = new AC()
    } catch {
      return
    }

    let source: MediaElementAudioSourceNode
    try {
      source = ctx.createMediaElementSource(audioEl)
    } catch {
      // `createMediaElementSource` ya invocado previamente para este elemento; no hay forma de recuperar el nodo.
      void ctx.close()
      return
    }

    const filters = FUSION_EQ_BANDS.map((b, i) => {
      const node = ctx.createBiquadFilter()
      node.type = b.kind
      node.frequency.value = b.freq
      node.Q.value = b.q
      node.gain.value = clampDb(gains[i] ?? 0)
      return node
    })

    const gainEQ = ctx.createGain()
    const gainDry = ctx.createGain()
    gainEQ.gain.value = bypass ? 0 : 1
    gainDry.gain.value = bypass ? 1 : 0

    const outBus = ctx.createGain()
    outBus.gain.value = 1

    const analyserNode = ctx.createAnalyser()
    analyserNode.fftSize = 2048
    analyserNode.smoothingTimeConstant = 0.55

    const mediaDest = ctx.createMediaStreamDestination()

    // Cadena EQ
    source.connect(filters[0]!)
    for (let i = 0; i < filters.length - 1; i++) filters[i]!.connect(filters[i + 1]!)
    filters[filters.length - 1]!.connect(gainEQ)
    gainEQ.connect(outBus)

    // Dry paralelo
    source.connect(gainDry)
    gainDry.connect(outBus)

    // Salidas
    outBus.connect(analyserNode)
    outBus.connect(ctx.destination)
    outBus.connect(mediaDest)

    ctxRef.current = ctx
    sourceRef.current = source
    filtersRef.current = filters
    gainEqRef.current = gainEQ
    gainDryRef.current = gainDry
    builtForElRef.current = audioEl
    setSampleRate(ctx.sampleRate)
    setAnalyser(analyserNode)
    setProcessedTrack(mediaDest.stream.getAudioTracks()[0] ?? null)
    void ctx.resume()

    return () => {
      try {
        analyserNode.disconnect()
      } catch {
        /* vacío */
      }
      try {
        mediaDest.disconnect()
      } catch {
        /* vacío */
      }
      try {
        for (const f of filters) f.disconnect()
      } catch {
        /* vacío */
      }
      try {
        gainEQ.disconnect()
        gainDry.disconnect()
        outBus.disconnect()
        source.disconnect()
      } catch {
        /* vacío */
      }
      void ctx.close()
      ctxRef.current = null
      sourceRef.current = null
      filtersRef.current = []
      gainEqRef.current = null
      gainDryRef.current = null
      builtForElRef.current = null
      setAnalyser(null)
      setProcessedTrack(null)
    }
    // gains/bypass se aplican abajo en efectos separados; aquí sólo construimos una vez por elemento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioEl, audioReady])

  /** Aplica ganancias a los biquads vivos. */
  useEffect(() => {
    const list = filtersRef.current
    if (!list.length) return
    for (let i = 0; i < list.length; i++) {
      const v = clampDb(gains[i] ?? 0)
      list[i]!.gain.value = v
    }
  }, [gains])

  /** Aplica bypass. */
  useEffect(() => {
    const eq = gainEqRef.current
    const dry = gainDryRef.current
    if (!eq || !dry) return
    const ctx = ctxRef.current
    const now = ctx?.currentTime ?? 0
    /** Rampa corta para evitar “click” al togglear bypass. */
    eq.gain.cancelScheduledValues(now)
    dry.gain.cancelScheduledValues(now)
    eq.gain.setTargetAtTime(bypass ? 0 : 1, now, 0.012)
    dry.gain.setTargetAtTime(bypass ? 1 : 0, now, 0.012)
  }, [bypass])

  const setBandGain = useCallback((index: number, dbValue: number) => {
    setGains((prev) => {
      const next = prev.slice()
      next[index] = clampDb(dbValue)
      writeStoredGains(next)
      return next
    })
  }, [])

  const applyPreset = useCallback((presetGains: EqGains) => {
    const next = Array.from({ length: EQ_BAND_COUNT }, (_, i) => clampDb(presetGains[i] ?? 0))
    setGains(next)
    writeStoredGains(next)
  }, [])

  const setBypass = useCallback((b: boolean) => {
    setBypassState(b)
    writeStoredBypass(b)
  }, [])

  return {
    processedTrack,
    analyser,
    gains,
    setBandGain,
    applyPreset,
    bypass,
    setBypass,
    sampleRate,
    filters: filtersRef.current
  }
}
