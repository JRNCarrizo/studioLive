import fs from 'fs'

const p = 'src/renderer/src/FusionPanel.tsx'
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/)

const start = lines.findIndex((l) => l.includes('const updateFramingTarget = useCallback'))
const end = lines.findIndex((l, i) => i > start && l.includes('const pauseAll = useCallback'))
if (start < 0 || end < 0) throw new Error(`markers not found: ${start} ${end}`)

const replacement = `  const applyFraming = useCallback((cameraId: string, next: CamFraming) => {
    const clamped = clampFraming(next)
    framingTargetRef.current.set(cameraId, clamped)
    framingCurrentRef.current.set(cameraId, clamped)
    setFramingTick((n) => n + 1)
  }, [])

  const updateFramingTarget = useCallback(
    (cameraId: string, mutator: (cur: CamFraming) => CamFraming) => {
      const cur = framingTargetRef.current.get(cameraId) ?? FRAMING_NEUTRAL
      applyFraming(cameraId, mutator(cur))
    },
    [applyFraming]
  )

  const resetFraming = useCallback(
    (cameraId: string | null) => {
      if (!cameraId) return
      applyFraming(cameraId, { ...FRAMING_NEUTRAL })
    },
    [applyFraming]
  )

  const programCrop = useMemo<CamCrop>(() => {
    if (!programCameraId) return CROP_FULL
    return cropTargetRef.current.get(programCameraId) ?? CROP_FULL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programCameraId, cropTick])

  const programRotateDeg = programCameraId ? (manualRotateDeg[programCameraId] ?? 0) : 0

  const updateCrop = useCallback((cameraId: string, next: CamCrop) => {
    cropTargetRef.current.set(cameraId, clampCrop(next))
    setCropTick((n) => n + 1)
  }, [])

  const resetCrop = useCallback((cameraId: string | null) => {
    if (!cameraId) return
    cropTargetRef.current.set(cameraId, { ...CROP_FULL })
    setCropTick((n) => n + 1)
  }, [])

  const toggleCropEdit = useCallback(() => {
    const next = !cropEditOpenRef.current
    cropEditOpenRef.current = next
    setCropEditOpen(next)
    if (programCameraId) {
      const neutral = { ...FRAMING_NEUTRAL }
      framingTargetRef.current.set(programCameraId, neutral)
      framingCurrentRef.current.set(programCameraId, neutral)
      setFramingTick((n) => n + 1)
    }
  }, [programCameraId])

  const bumpRotate = useCallback((cameraId: string) => {
    setManualRotateDeg((prev) => ({
      ...prev,
      [cameraId]: ((prev[cameraId] ?? 0) + 90) % 360
    }))
  }, [])

  const removeClipFromSession = useCallback(
    (cameraId: string) => {
      setClips((prev) => {
        const next = prev.filter((c) => c.cameraId !== cameraId)
        if (programCameraId === cameraId) {
          setProgramCameraId(next[0]?.cameraId ?? null)
        }
        return next
      })
      cropTargetRef.current.delete(cameraId)
      framingTargetRef.current.delete(cameraId)
      framingCurrentRef.current.delete(cameraId)
      setManualRotateDeg((prev) => {
        const n = { ...prev }
        delete n[cameraId]
        return n
      })
    },
    [programCameraId]
  )

  useEffect(() => {
    if (!programCameraId) return
    const v = videoRefs.current.get(programCameraId)
    if (!v?.videoWidth) return
    const want = aspectToOrientation(v.videoWidth, v.videoHeight)
    setProgramOrientation((cur) => (cur === want ? cur : want))
  }, [programCameraId, clips])

  const handleProgramWheel = useCallback(
    (clientX: number, clientY: number, deltaY: number) => {
      if (!programCameraId || cropEditOpen) return
      const canvas = canvasRef.current
      const v = videoRefs.current.get(programCameraId)
      if (!canvas || !v) return
      const crop = cropTargetRef.current.get(programCameraId) ?? CROP_FULL
      const cur = framingTargetRef.current.get(programCameraId) ?? FRAMING_NEUTRAL
      const next = wheelZoomFramingWithCrop({
        clientX,
        clientY,
        deltaY,
        canvas,
        video: v,
        crop,
        cur,
        rotateDeg: programRotateDeg
      })
      if (
        Math.abs(next.zoom - cur.zoom) < 1e-6 &&
        Math.abs(next.offsetX - cur.offsetX) < 1e-6 &&
        Math.abs(next.offsetY - cur.offsetY) < 1e-6
      ) {
        return
      }
      applyFraming(programCameraId, next)
    },
    [applyFraming, cropEditOpen, programCameraId, programRotateDeg]
  )

  const onProgramWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault()
      e.stopPropagation()
      handleProgramWheel(e.clientX, e.clientY, e.deltaY)
    },
    [handleProgramWheel]
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      if (!programCameraId || cropEditOpen) return
      e.preventDefault()
      e.stopPropagation()
      handleProgramWheel(e.clientX, e.clientY, e.deltaY)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [cropEditOpen, handleProgramWheel, programCameraId])

  const onProgramMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!programCameraId || cropEditOpen) return
      if (e.button !== 0) return
      programDragRef.current = { startX: e.clientX, startY: e.clientY, moved: false }
    },
    [cropEditOpen, programCameraId]
  )

  const onProgramMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const drag = programDragRef.current
      if (!drag || !programCameraId || cropEditOpen) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      if (!drag.moved && Math.hypot(dx, dy) < 3) return
      drag.moved = true
      drag.startX = e.clientX
      drag.startY = e.clientY
      const canvas = canvasRef.current
      const v = videoRefs.current.get(programCameraId)
      if (!canvas || !v) return
      const crop = cropTargetRef.current.get(programCameraId) ?? CROP_FULL
      const cur = framingTargetRef.current.get(programCameraId) ?? FRAMING_NEUTRAL
      const next = panFramingByCssDeltaWithCrop({
        dx,
        dy,
        canvas,
        video: v,
        crop,
        cur,
        rotateDeg: programRotateDeg
      })
      applyFraming(programCameraId, next)
    },
    [applyFraming, cropEditOpen, programCameraId, programRotateDeg]
  )

  const onProgramMouseUp = useCallback(() => {
    programDragRef.current = null
  }, [])

  const onProgramClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const drag = programDragRef.current
      if (drag?.moved) {
        programDragRef.current = null
        return
      }
      if (!programCameraId || cropEditOpen) return
      const canvas = canvasRef.current
      const v = videoRefs.current.get(programCameraId)
      if (!canvas || !v) return
      const crop = cropTargetRef.current.get(programCameraId) ?? CROP_FULL
      const cur = framingTargetRef.current.get(programCameraId) ?? FRAMING_NEUTRAL
      const ptr = clientToCropNormalized(
        e.clientX,
        e.clientY,
        canvas,
        v,
        crop,
        cur,
        programRotateDeg
      )
      if (!ptr) return
      applyFraming(programCameraId, { ...cur, offsetX: ptr.nx, offsetY: ptr.ny })
    },
    [applyFraming, cropEditOpen, programCameraId, programRotateDeg]
  )

  const onProgramDoubleClick = useCallback(() => {
    if (cropEditOpen) return
    resetFraming(programCameraId)
  }, [cropEditOpen, programCameraId, resetFraming])

`.split('\n')

const out = [...lines.slice(0, start), ...replacement, ...lines.slice(end)]
fs.writeFileSync(p, out.join('\n'), 'utf8')
console.log('Patched handlers', start, end, '->', replacement.length, 'lines')
