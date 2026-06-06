import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const ffmpegBin = require('ffmpeg-static') as string | undefined | null

export type FfmpegTrimRange = {
  startSec: number
  endSec: number
}

const MIN_TRIM_DURATION_SEC = 0.5

export function parseFfmpegTrim(raw: unknown): FfmpegTrimRange | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as { startSec?: unknown; endSec?: unknown }
  const startSec = Number(o.startSec)
  const endSec = Number(o.endSec)
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return undefined
  if (endSec - startSec < MIN_TRIM_DURATION_SEC) return undefined
  if (startSec < 0) return undefined
  return { startSec, endSec }
}

function trimFilterArgs(trim?: FfmpegTrimRange): string[] {
  if (!trim) return []
  return ['-ss', String(trim.startSec), '-to', String(trim.endSec)]
}

function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  const ffmpegPath = ffmpegBin ?? ''
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('FFmpeg embebido no disponible en esta plataforma.'))
      return
    }
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    let stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stderr: stderr.slice(-4000) })
    })
  })
}

/** True si el fallo se debe a que no hay pista de audio que mapear (WebM solo vídeo). */
function stderrIndicatesNoAudioStream(stderr: string): boolean {
  const s = stderr.toLowerCase()
  if (s.includes('matches no streams')) {
    if (s.includes('0:a') || s.includes('a:0') || s.includes('stream map')) return true
  }
  if (s.includes('could not find stream') && s.includes('audio')) return true
  return false
}

/** Recorta WebM (inicio/fin) con copia de streams; si falla, re-codifica VP8/Opus. */
export async function trimWebmFile(
  inputWebm: string,
  outputWebm: string,
  trim: FfmpegTrimRange
): Promise<void> {
  const normOut = path.normalize(outputWebm)
  const cut = trimFilterArgs(trim)

  const attemptCopy = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputWebm,
    ...cut,
    '-c',
    'copy',
    '-avoid_negative_ts',
    'make_zero',
    normOut
  ]

  let r = await runFfmpeg(attemptCopy)
  if (r.code === 0) return

  const attemptEncode = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputWebm,
    ...cut,
    '-c:v',
    'libvpx',
    '-crf',
    '12',
    '-b:v',
    '0',
    '-c:a',
    'libopus',
    '-b:a',
    '128k',
    normOut
  ]

  r = await runFfmpeg(attemptEncode)
  if (r.code === 0) return

  const hint = r.stderr.trim() ? `\n${r.stderr.trim().slice(-4000)}` : ''
  throw new Error(`FFmpeg no pudo recortar el WebM (código ${r.code}).${hint}`)
}

/** WebM (fusión) → MP4 H.264 + AAC, compatible con el Reproductor de Windows. */
export async function convertWebmFileToMp4(
  inputWebm: string,
  outputMp4: string,
  trim?: FfmpegTrimRange
): Promise<void> {
  const normOut = path.normalize(outputMp4)
  if (!normOut.toLowerCase().endsWith('.mp4')) {
    throw new Error('La salida debe ser un archivo .mp4.')
  }

  const baseVideo = [
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '22',
    '-pix_fmt',
    'yuv420p'
  ] as const

  const baseAudio = ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'] as const

  /**
   * 1) Sin `-map`: FFmpeg elige vídeo + audio por defecto (más tolerante con WebM/Opus de Chrome).
   * 2) Map explícito 0:v:0 + 0:a (todas las pistas de audio del primer input).
   * Antes se hacía fallback a solo-vídeo ante *cualquier* error del paso 1 → MP4 “exitoso” pero mudo.
   * Ahora solo-vídeo si el stderr indica claramente que no hay audio.
   */
  const cut = trimFilterArgs(trim)

  const attemptAutoMap = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputWebm,
    ...cut,
    ...baseVideo,
    ...baseAudio,
    normOut
  ]

  let r = await runFfmpeg(attemptAutoMap)
  if (r.code === 0) return

  let lastErr = r.stderr

  const attemptExplicitMap = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputWebm,
    ...cut,
    '-map',
    '0:v:0',
    '-map',
    '0:a',
    ...baseVideo,
    ...baseAudio,
    normOut
  ]

  r = await runFfmpeg(attemptExplicitMap)
  if (r.code === 0) return

  lastErr = `${lastErr}\n---\n${r.stderr}`

  const combined = lastErr
  if (!stderrIndicatesNoAudioStream(combined)) {
    const hint = combined.trim() ? `\n${combined.trim().slice(-6000)}` : ''
    throw new Error(
      `FFmpeg no pudo crear el MP4 con audio (código ${r.code}). No se generó un archivo silenciado a propósito.${hint}`
    )
  }

  const attemptVideoOnly = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputWebm,
    ...cut,
    '-map',
    '0:v:0',
    ...baseVideo,
    '-movflags',
    '+faststart',
    normOut
  ]

  r = await runFfmpeg(attemptVideoOnly)
  if (r.code === 0) return

  const hint = r.stderr.trim() ? `\n${r.stderr.trim()}` : ''
  throw new Error(`FFmpeg falló al crear MP4 solo vídeo (código ${r.code}).${hint}`)
}

export function getFFmpegPath(): string | null {
  return ffmpegBin && ffmpegBin.length > 0 ? ffmpegBin : null
}
