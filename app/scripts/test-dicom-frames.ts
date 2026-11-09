import assert from 'node:assert/strict'
import { createDicomFrameDecoder } from '../src/lib/dicomIntake.ts'

// A conventional, raw implicit-VR little-endian monochrome image stack.
function element(group: number, tag: number, value: Buffer) {
  const header = Buffer.alloc(8)
  header.writeUInt16LE(group); header.writeUInt16LE(tag, 2); header.writeUInt32LE(value.length, 4)
  return Buffer.concat([header, value])
}
const text = (value: string) => Buffer.from(value.length % 2 ? `${value} ` : value)
const us = (value: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b }
function stack(frames = '2', pixels = Buffer.from([0, 64, 128, 255, 255, 128, 64, 0]), enhanced = false) {
  return Buffer.concat([
    element(0x0008, 0x0060, text('DX')),
    element(0x0008, 0x0018, text('1.2.3.4')),
    element(0x0020, 0x000e, text('1.2.3')),
    element(0x0028, 0x0002, us(1)), element(0x0028, 0x0004, text('MONOCHROME2')),
    element(0x0028, 0x0008, text(frames)), element(0x0028, 0x0010, us(2)), element(0x0028, 0x0011, us(2)),
    element(0x0028, 0x0100, us(8)), element(0x0028, 0x0101, us(8)),
    ...(enhanced ? [element(0x5200, 0x9230, Buffer.alloc(0))] : []),
    element(0x7fe0, 0x0010, pixels),
  ])
}
const decoder = createDicomFrameDecoder(stack())
assert.equal(decoder.frameCount, 2)
assert.equal(decoder.decode(1).sourceFrameCount, 2)
assert.equal(decoder.decode(1).sourceFrameIndex, 1)
assert.equal(decoder.decode(0).sourceSopInstanceUid, decoder.decode(1).sourceSopInstanceUid)
assert.equal(decoder.decode(1).sourceSeriesUid, '1.2.3')
assert.deepEqual([...decoder.decode(0).gray], [0, 64, 128, 255])
assert.deepEqual([...decoder.decode(1).gray], [255, 128, 64, 0])
assert.throws(() => decoder.decode(2), /outside/)
assert.throws(() => decoder.decode(-1), /outside/)
assert.throws(() => decoder.decode(0.5), /outside/)
assert.throws(() => createDicomFrameDecoder(stack('2', Buffer.from([0, 64, 128, 255]))), /truncated/)
assert.throws(() => createDicomFrameDecoder(stack('0')), /frame count/)
assert.throws(() => createDicomFrameDecoder(stack('1.5')), /frame count/)
assert.throws(() => createDicomFrameDecoder(stack('513')), /too large/)
assert.throws(() => createDicomFrameDecoder(stack('2', undefined, true)), /functional groups/)
console.log('DICOM frames: complete frame access, bounds, truncated stack and unsupported functional-group checks passed')
