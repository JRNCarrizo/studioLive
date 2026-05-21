import { useEffect, useRef, useState } from 'react'

import {
  evaluateSourceHealth,
  resetSourceHealthSamples,
  SOURCE_HEALTH_SAMPLE_MS,
  type SourceHealthInfo
} from './sourceHealth'

export function useSourceHealthMonitor(params: {
  cameraIds: string[]
  streams: Record<string, MediaStream | undefined>
  rtcStates: Record<string, string | undefined>
  getVideo: (cameraId: string) => HTMLVideoElement | undefined
}): Record<string, SourceHealthInfo> {
  const { cameraIds, streams, rtcStates, getVideo } = params
  const [health, setHealth] = useState<Record<string, SourceHealthInfo>>({})
  const getVideoRef = useRef(getVideo)
  const prevIdsRef = useRef<string[]>([])
  getVideoRef.current = getVideo

  useEffect(() => {
    const prev = new Set(prevIdsRef.current)
    for (const id of cameraIds) prev.delete(id)
    for (const removed of prev) resetSourceHealthSamples(removed)
    prevIdsRef.current = cameraIds
  }, [cameraIds])

  useEffect(() => {
    const tick = () => {
      const next: Record<string, SourceHealthInfo> = {}
      for (const id of cameraIds) {
        next[id] = evaluateSourceHealth({
          cameraId: id,
          video: getVideoRef.current(id),
          stream: streams[id],
          rtcState: rtcStates[id]
        })
      }
      setHealth(next)
    }
    tick()
    const id = window.setInterval(tick, SOURCE_HEALTH_SAMPLE_MS)
    return () => window.clearInterval(id)
  }, [cameraIds, streams, rtcStates])

  return health
}
