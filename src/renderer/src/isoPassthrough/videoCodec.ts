export type PassthroughVideoCodec = 'vp8' | 'vp9' | 'h264'

function asPassthrough(name: string): PassthroughVideoCodec | null {
  if (name === 'vp8' || name === 'vp9' || name === 'h264') return name
  return null
}

function orderVideoCodecs(codecs: readonly RTCRtpCodec[]): RTCRtpCodec[] {
  const want = ['video/vp8', 'video/h264', 'video/vp9', 'video/av1']
  const picked = new Set<RTCRtpCodec>()
  const out: RTCRtpCodec[] = []
  for (const mime of want) {
    for (const codec of codecs) {
      if (codec.mimeType.toLowerCase() !== mime || picked.has(codec)) continue
      picked.add(codec)
      out.push(codec)
    }
  }
  for (const codec of codecs) {
    if (!picked.has(codec)) out.push(codec)
  }
  return out
}

/** Reordena códecs para que el celular mande VP8 o H.264, que podemos guardar sin recomprimir. */
export function preferPassthroughVideoCodecs(pc: RTCPeerConnection): void {
  if (typeof RTCRtpReceiver === 'undefined' || typeof RTCRtpReceiver.getCapabilities !== 'function') return
  const caps = RTCRtpReceiver.getCapabilities('video')
  if (!caps?.codecs?.length) return
  const codecs = orderVideoCodecs(caps.codecs)
  for (const transceiver of pc.getTransceivers()) {
    const kind = transceiver.receiver.track?.kind ?? transceiver.sender.track?.kind
    if (kind !== 'video') continue
    try {
      transceiver.setCodecPreferences(codecs)
    } catch {
      /* lista rechazada por este navegador */
    }
  }
}

export function primaryVideoCodecFromSdp(sdp: string): PassthroughVideoCodec | null {
  const media = sdp.split(/\r?\n/).find((line) => line.startsWith('m=video'))
  if (!media) return null
  const pts = media.trim().split(/\s+/).slice(3)
  const rtpmap = new Map<string, string>()
  for (const line of sdp.split(/\r?\n/)) {
    const match = /^a=rtpmap:(\d+)\s+([A-Za-z0-9-]+)/.exec(line.trim())
    if (match) rtpmap.set(match[1], match[2].toLowerCase())
  }
  for (const pt of pts) {
    const name = rtpmap.get(pt)
    if (!name || name === 'rtx' || name === 'red' || name === 'ulpfec' || name === 'flexfec-03') continue
    const codec = asPassthrough(name)
    if (codec) return codec
  }
  return null
}

export async function inboundPassthroughCodec(pc: RTCPeerConnection): Promise<PassthroughVideoCodec | null> {
  try {
    const stats = await pc.getStats()
    for (const report of stats.values()) {
      if (report.type !== 'inbound-rtp' || report.kind !== 'video') continue
      const codecId = report.codecId
      if (!codecId) continue
      const codec = stats.get(codecId)
      if (!codec || codec.type !== 'codec' || !codec.mimeType) continue
      const name = codec.mimeType.toLowerCase().replace('video/', '')
      const parsed = asPassthrough(name)
      if (parsed) return parsed
    }
  } catch {
    /* SDP más abajo */
  }
  const sdp = pc.remoteDescription?.sdp ?? pc.currentRemoteDescription?.sdp ?? ''
  return sdp ? primaryVideoCodecFromSdp(sdp) : null
}
