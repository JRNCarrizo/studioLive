import { useCallback, useEffect, useMemo, useState } from 'react'

import { normalizeTrimRange, trimRangeForExport } from './videoTrim'

export function useRecordingTrim(active: boolean) {
  const [durationSec, setDurationSec] = useState(0)
  const [trimInSec, setTrimInSec] = useState(0)
  const [trimOutSec, setTrimOutSec] = useState(0)

  useEffect(() => {
    if (!active) {
      setDurationSec(0)
      setTrimInSec(0)
      setTrimOutSec(0)
    }
  }, [active])

  const onVideoDuration = useCallback((d: number) => {
    if (!Number.isFinite(d) || d <= 0) return
    setDurationSec(d)
    setTrimInSec(0)
    setTrimOutSec(d)
  }, [])

  const getTrimForExport = useCallback(
    () => trimRangeForExport(durationSec, trimInSec, trimOutSec),
    [durationSec, trimInSec, trimOutSec]
  )

  const exportMeta = useMemo(
    () => normalizeTrimRange(durationSec, trimInSec, trimOutSec),
    [durationSec, trimInSec, trimOutSec]
  )

  return {
    durationSec,
    trimInSec,
    trimOutSec,
    setTrimInSec,
    setTrimOutSec,
    onVideoDuration,
    getTrimForExport,
    exportDurationSec: exportMeta.exportDurationSec,
    isFullRange: exportMeta.isFullRange
  }
}
