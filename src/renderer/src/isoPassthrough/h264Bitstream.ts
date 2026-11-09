/** NAL de H.264 tal como llega por WebRTC (Annex-B o AVCC) → muestra AVCC + avcC para MP4. */

export type H264Config = {
  sps: Uint8Array
  pps: Uint8Array
  avcC: Uint8Array
  codec: string
}

export type H264Sample = {
  data: Uint8Array
  config: H264Config | null
}

function nalType(nal: Uint8Array): number {
  return nal.length ? nal[0] & 0x1f : 0
}

function isVcl(type: number): boolean {
  return type === 1 || type === 5
}

function hexByte(n: number): string {
  return n.toString(16).padStart(2, '0')
}

export function avcCodecString(sps: Uint8Array): string {
  return `avc1.${hexByte(sps[1] ?? 0x42)}${hexByte(sps[2] ?? 0)}${hexByte(sps[3] ?? 0x1f)}`
}

export function buildAvcDecoderConfig(sps: Uint8Array, pps: Uint8Array): Uint8Array {
  const out = new Uint8Array(11 + sps.length + pps.length)
  const view = new DataView(out.buffer)
  out[0] = 1
  out[1] = sps[1] ?? 0x42
  out[2] = sps[2] ?? 0
  out[3] = sps[3] ?? 0x1f
  out[4] = 0xff
  out[5] = 0xe1
  view.setUint16(6, sps.length)
  out.set(sps, 8)
  const ppsAt = 8 + sps.length
  out[ppsAt] = 1
  view.setUint16(ppsAt + 1, pps.length)
  out.set(pps, ppsAt + 3)
  return out
}

function nalsToAvcc(nals: Uint8Array[]): Uint8Array {
  let size = 0
  for (const nal of nals) size += 4 + nal.length
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  let offset = 0
  for (const nal of nals) {
    view.setUint32(offset, nal.length)
    out.set(nal, offset + 4)
    offset += 4 + nal.length
  }
  return out
}

function startCodeLength(data: Uint8Array, index: number): number {
  if (
    index + 4 <= data.length &&
    data[index] === 0 &&
    data[index + 1] === 0 &&
    data[index + 2] === 0 &&
    data[index + 3] === 1
  ) {
    return 4
  }
  if (
    index + 3 <= data.length &&
    data[index] === 0 &&
    data[index + 1] === 0 &&
    data[index + 2] === 1
  ) {
    return 3
  }
  return 0
}

export function splitAnnexB(data: Uint8Array): Uint8Array[] | null {
  const marks: Array<{ at: number; len: number }> = []
  for (let i = 0; i < data.length - 2; i++) {
    const len = startCodeLength(data, i)
    if (!len) continue
    marks.push({ at: i, len })
    i += len - 1
  }
  if (!marks.length) return null
  const nals: Uint8Array[] = []
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].at + marks[i].len
    const end = i + 1 < marks.length ? marks[i + 1].at : data.length
    if (end > start) nals.push(data.subarray(start, end))
  }
  return nals.length ? nals : null
}

function splitAvcc(data: Uint8Array): Uint8Array[] | null {
  if (data.length < 5) return null
  if (startCodeLength(data, 0)) return null
  const nals: Uint8Array[] = []
  let offset = 0
  while (offset + 4 <= data.length) {
    const len =
      (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
    if (len <= 0 || offset + 4 + len > data.length) return null
    nals.push(data.subarray(offset + 4, offset + 4 + len))
    offset += 4 + len
  }
  if (offset !== data.length || !nals.length) return null
  return nals
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const bin = atob(value)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff
    return out.length ? out : null
  } catch {
    return null
  }
}

/** `sprop-parameter-sets` del SDP (SPS,PPS en base64, sin start codes). */
export function spropParameterSets(sdp: string): { sps: Uint8Array; pps: Uint8Array } | null {
  const match = /sprop-parameter-sets=([^;\s]+)/i.exec(sdp)
  if (!match) return null
  const parts = match[1].split(',')
  if (parts.length < 2) return null
  const sps = decodeBase64(parts[0])
  const pps = decodeBase64(parts[1])
  if (!sps || !pps || nalType(sps) !== 7 || nalType(pps) !== 8) return null
  return { sps, pps }
}

function configFrom(sps: Uint8Array, pps: Uint8Array): H264Config {
  return {
    sps,
    pps,
    avcC: buildAvcDecoderConfig(sps, pps),
    codec: avcCodecString(sps)
  }
}

/**
 * Separa VCL (lo que va en la muestra) de SPS/PPS (van al avcC, una sola vez).
 * `cached` cubre keyframes que no repiten el SPS.
 */
export function prepareH264AccessUnit(data: Uint8Array, cached: H264Config | null): H264Sample | null {
  const nals = splitAnnexB(data) ?? splitAvcc(data)
  if (!nals) return null

  let sps = cached?.sps ?? null
  let pps = cached?.pps ?? null
  const vcl: Uint8Array[] = []
  for (const nal of nals) {
    const type = nalType(nal)
    if (type === 7) sps = nal
    else if (type === 8) pps = nal
    else if (isVcl(type)) vcl.push(nal)
  }

  let next: H264Config | null = cached
  if (sps && pps && (!cached || sps !== cached.sps || pps !== cached.pps)) {
    next = configFrom(sps, pps)
  }
  if (!vcl.length) {
    if (next && next !== cached) return { data: new Uint8Array(), config: next }
    return null
  }
  if (!next) return null
  return { data: nalsToAvcc(vcl), config: next }
}
