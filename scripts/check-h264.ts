import assert from 'node:assert/strict'
import {
  buildAvcDecoderConfig,
  prepareH264AccessUnit,
  spropParameterSets
} from '../src/renderer/src/isoPassthrough/h264Bitstream.ts'

function annexB(nals: number[][]): Uint8Array {
  const parts: number[] = []
  for (const nal of nals) {
    parts.push(0, 0, 0, 1, ...nal)
  }
  return Uint8Array.from(parts)
}

const sps = [0x67, 0x42, 0x00, 0x1f, 0xaa]
const pps = [0x68, 0xce, 0x06]
const idr = [0x65, 0x88, 0x84]

const prepared = prepareH264AccessUnit(annexB([sps, pps, idr]), null)
assert.ok(prepared)
assert.equal(prepared.config?.codec, 'avc1.42001f')
assert.ok(prepared.data.byteLength > 4)
assert.equal(prepared.data[4], 0x65)

const configOnly = prepareH264AccessUnit(annexB([sps, pps]), null)
assert.ok(configOnly)
assert.equal(configOnly.data.byteLength, 0)
assert.equal(configOnly.config?.codec, 'avc1.42001f')

const delta = prepareH264AccessUnit(annexB([[0x61, 0x00, 0x01]]), configOnly.config)
assert.ok(delta)
assert.equal(delta.data[4], 0x61)

const avcC = buildAvcDecoderConfig(Uint8Array.from(sps), Uint8Array.from(pps))
assert.equal(avcC[0], 1)
assert.equal(avcC[4], 0xff)

const spsB64 = Buffer.from([0x67, 0x42, 0x00, 0x1f, 0xaa]).toString('base64')
const ppsB64 = Buffer.from([0x68, 0xce, 0x06]).toString('base64')
const sprop = spropParameterSets(`a=fmtp:102 packetization-mode=1;sprop-parameter-sets=${spsB64},${ppsB64}`)
assert.ok(sprop)
assert.equal(sprop.sps[0] & 0x1f, 7)
assert.equal(sprop.pps[0] & 0x1f, 8)

console.log('h264 bitstream ok')
