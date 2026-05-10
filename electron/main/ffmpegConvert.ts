import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const ffmpegBin = require('ffmpeg-static') as string | undefined | null

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

/** WebM (fusión) → MP4 H.264 + AAC, compatible con el Reproductor de Windows. */
export async function convertWebmFileToMp4(inputWebm: string, outputMp4: string): Promise<void> {
  const normOut = path.normalize(outputMp4)
  if (!normOut.toLowerCase().endsWith('.mp4')) {
    throw new Error('La salida debe ser un archivo .mp4.')
  }

  /** Si no hay pista de audio, `-map 0:a:0` falla y probamos solo vídeo. */
  const attemptWithAudio = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputWebm,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '22',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    normOut
  ]

  let r = await runFfmpeg(attemptWithAudio)
  if (r.code === 0) return

  const attemptVideoOnly = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputWebm,
    '-map',
    '0:v:0',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '22',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    normOut
  ]

  r = await runFfmpeg(attemptVideoOnly)
  if (r.code === 0) return

  const hint = r.stderr.trim() ? `\n${r.stderr.trim()}` : ''
  throw new Error(`FFmpeg falló al crear MP4 (código ${r.code}).${hint}`)
}

export function getFFmpegPath(): string | null {
  return ffmpegBin && ffmpegBin.length > 0 ? ffmpegBin : null
}
