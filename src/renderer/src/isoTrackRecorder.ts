export type IsoRecordedPart = {
  parts: BlobPart[]
  mime: string
}

export type IsoTrackRecorder = {
  pause: () => void
  resume: () => void
  stop: () => Promise<IsoRecordedPart | null>
}

export function mediaRecorderTrack(rec: MediaRecorder, chunks: BlobPart[]): IsoTrackRecorder {
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  return {
    pause() {
      if (rec.state === 'recording') {
        try {
          rec.pause()
        } catch {
          /* vacío */
        }
      }
    },
    resume() {
      if (rec.state === 'paused') {
        try {
          rec.resume()
        } catch {
          /* vacío */
        }
      }
    },
    stop() {
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
  }
}
