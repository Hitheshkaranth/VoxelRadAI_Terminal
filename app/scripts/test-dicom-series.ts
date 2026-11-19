import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildDicomVolume, dicomBuffersToVolume, groupDicomSeries, mayContainDicomSeries, readDicomSlice, volumeToNrrd } from '../src/lib/dicomSeries.ts'
import { createDicomFrameDecoder } from '../src/lib/dicomIntake.ts'
import { dicomPixelsToGray, isPaddingValue, linearVoi } from '../src/lib/dicomPixels.ts'
import { decodeNrrd, getSliceGeometry } from '../src/lib/volume.ts'

// Synthetic raw implicit-VR little-endian slices (no preamble), like test-dicom-frames.
function element(group: number, tag: number, value: Buffer) {
  const header = Buffer.alloc(8)
  header.writeUInt16LE(group); header.writeUInt16LE(tag, 2); header.writeUInt32LE(value.length, 4)
  return Buffer.concat([header, value])
}
const text = (value: string) => Buffer.from(value.length % 2 ? `${value} ` : value)
const us = (value: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b }
const ss = (value: number) => { const b = Buffer.alloc(2); b.writeInt16LE(value); return b }
// Part 10 file with an explicit-VR meta header: needed to declare a (compressed) transfer syntax.
function explicit(group: number, tag: number, vr: string, value: Buffer) {
  const long = ['OB', 'OW', 'UN', 'SQ'].includes(vr)
  const header = Buffer.alloc(long ? 12 : 8)
  header.writeUInt16LE(group); header.writeUInt16LE(tag, 2); header.write(vr, 4, 'latin1')
  if (long) header.writeUInt32LE(value.length, 8); else header.writeUInt16LE(value.length, 6)
  return Buffer.concat([header, value])
}
function compressedSlice(z: number) {
  const meta = explicit(0x0002, 0x0010, 'UI', text('1.2.840.10008.1.2.4.50'))
  return new Uint8Array(Buffer.concat([
    Buffer.alloc(128), Buffer.from('DICM'), explicit(0x0002, 0x0000, 'UL', (() => { const b = Buffer.alloc(4); b.writeUInt32LE(meta.length); return b })()), meta,
    explicit(0x0008, 0x0060, 'CS', text('CT')), explicit(0x0020, 0x000e, 'UI', text('1.2.3.4')),
    explicit(0x0020, 0x0032, 'DS', text(`0\\0\\${z}`)), explicit(0x0020, 0x0037, 'DS', text('1\\0\\0\\0\\1\\0')),
    explicit(0x0028, 0x0010, 'US', us(4)), explicit(0x0028, 0x0011, 'US', us(3)), explicit(0x0028, 0x0100, 'US', us(16)),
    explicit(0x7fe0, 0x0010, 'OW', Buffer.alloc(24)),
  ]))
}
interface SliceOptions {
  position: number[]; orientation?: number[]; rows?: number; cols?: number; series?: string; modality?: string; description?: string
  slope?: string; intercept?: string; padding?: number; values: (i: number) => number; frames?: string
}
function slice(o: SliceOptions) {
  const rows = o.rows ?? 4, cols = o.cols ?? 3
  const pixels = Buffer.alloc(rows * cols * 2)
  for (let i = 0; i < rows * cols; i++) pixels.writeInt16LE(o.values(i), i * 2)
  return new Uint8Array(Buffer.concat([
    element(0x0008, 0x0060, text(o.modality ?? 'CT')),
    element(0x0008, 0x103e, text(o.description ?? 'Axial 2.5')),
    element(0x0018, 0x0015, text('CHEST')),
    element(0x0020, 0x000e, text(o.series ?? '1.2.3.4')),
    element(0x0020, 0x0032, text(o.position.join('\\'))),
    element(0x0020, 0x0037, text((o.orientation ?? [1, 0, 0, 0, 1, 0]).join('\\'))),
    element(0x0028, 0x0002, us(1)), element(0x0028, 0x0004, text('MONOCHROME2')),
    ...(o.frames ? [element(0x0028, 0x0008, text(o.frames))] : []),
    element(0x0028, 0x0010, us(rows)), element(0x0028, 0x0011, us(cols)),
    element(0x0028, 0x0030, text('0.7\\0.8')),
    element(0x0028, 0x0100, us(16)), element(0x0028, 0x0101, us(16)), element(0x0028, 0x0103, us(1)),
    ...(o.padding != null ? [element(0x0028, 0x0120, ss(o.padding))] : []),
    element(0x0028, 0x1050, text('40')), element(0x0028, 0x1051, text('400')),
    element(0x0028, 0x1052, text(o.intercept ?? '-1024')), element(0x0028, 0x1053, text(o.slope ?? '1')),
    element(0x7fe0, 0x0010, pixels),
  ]))
}
// Ten axial CT slices 2.5 mm apart, given in shuffled order; pixel 0 is bore padding.
const order = [3, 7, 0, 9, 1, 5, 2, 8, 4, 6]
const ct = order.map((k) => slice({ position: [-10, -20, -50 + 2.5 * k], padding: -2000, values: (i) => i === 0 ? -2000 : k * 10 + i }))

const header = readDicomSlice(ct[0])
assert.deepEqual(header.position, [-10, -20, -42.5])
assert.deepEqual([header.rowCosines, header.colCosines], [[1, 0, 0], [0, 1, 0]])
assert.deepEqual(header.pixelSpacing, { row: 0.7, col: 0.8 })
assert.equal(header.paddingValue, -2000)
assert.equal(header.modality, 'CT')

const built = buildDicomVolume(ct.map((bytes, index) => readDicomSlice(bytes, index)))
const { volume } = built
assert.deepEqual(volume.dimensions, [3, 4, 10])
assert.deepEqual(volume.spacing, [0.8, 0.7, 2.5])
assert.deepEqual(volume.origin, [-10, -20, -50])
assert.deepEqual(volume.directions, [[1, 0, 0], [0, 1, 0], [0, 0, 1]])
assert.ok(volume.data instanceof Int16Array)
// Sorted along the normal, rescaled to HU; padding filled with the lowest real value (k=0, i=1 → -1023).
assert.equal(volume.data[0], -1023)
assert.equal(volume.data[1], 1 - 1024)
assert.equal(volume.data[5 * 12 + 7], 50 + 7 - 1024)
assert.deepEqual(volume.range, [-1023, 90 + 11 - 1024])
assert.deepEqual(built.used, [2, 4, 6, 0, 8, 5, 9, 1, 7, 3])
assert.deepEqual(built.window, { center: 40, width: 400 })
assert.equal(built.acquisition.intensityIsHU, true)
assert.equal(built.acquisition.modality, 'CT')
assert.equal(built.acquisition.bodyPart, 'CHEST')
assert.deepEqual(built.warnings, [])
assert.deepEqual(volume.worldBounds, { min: [-10, -20, -50], max: [-10 + 1.6, -20 + 2.1, -27.5].map((v) => Number(v.toFixed(10))) as [number, number, number] } as typeof volume.worldBounds)

// The NRRD hand-off decodes back to the identical volume, so the viewer path is unchanged.
const roundTrip = await decodeNrrd(volumeToNrrd(volume).slice().buffer)
assert.deepEqual(roundTrip.dimensions, volume.dimensions)
assert.deepEqual(roundTrip.origin, volume.origin)
assert.deepEqual(roundTrip.directions, volume.directions)
roundTrip.spacing.forEach((value, axis) => assert.ok(Math.abs(value - volume.spacing[axis]) < 1e-9))
assert.deepEqual([...roundTrip.data], [...volume.data])
assert.deepEqual(roundTrip.range, volume.range)
assert.equal(getSliceGeometry(roundTrip, 'axial').count, 10)

// Coronal acquisition: normal = row × col = (0, 1, 0); positions advance along y.
const coronal = buildDicomVolume(Array.from({ length: 9 }, (_, k) => readDicomSlice(slice({ position: [0, 30 - 3 * k, 0], orientation: [1, 0, 0, 0, 0, -1], values: () => 100 }), k)))
assert.deepEqual(coronal.volume.directions[2], [0, 1, 0])
assert.deepEqual(coronal.volume.origin, [0, 6, 0])
assert.equal(coronal.volume.spacing[2], 3)
assert.equal(getSliceGeometry(coronal.volume, 'coronal').count, 9)

// Gap, non-uniform spacing, gantry tilt.
const gapped = buildDicomVolume([0, 1, 2, 3, 5, 6, 7, 8, 9].map((k, i) => readDicomSlice(slice({ position: [0, 0, 2 * k], values: () => 0 }), i)))
assert.match(gapped.warnings.join(' '), /1 gap/)
const uneven = buildDicomVolume([0, 2, 4.4, 6, 8, 10.3, 12, 14].map((z, i) => readDicomSlice(slice({ position: [0, 0, z], values: () => 0 }), i)))
assert.match(uneven.warnings.join(' '), /not uniform/)
const tilted = buildDicomVolume(Array.from({ length: 8 }, (_, k) => readDicomSlice(slice({ position: [0, 0.5 * k, 2.5 * k], values: () => 0 }), k)))
assert.match(tilted.warnings.join(' '), /gantry tilt/)

// Refusals: inconsistent sizes, duplicate positions, compressed pixel data, missing geometry.
assert.throws(() => buildDicomVolume(Array.from({ length: 8 }, (_, k) => readDicomSlice(slice({ position: [0, 0, k], rows: k === 3 ? 5 : 4, values: () => 0 }), k))), /inconsistent image sizes/)
assert.throws(() => buildDicomVolume(Array.from({ length: 8 }, (_, k) => readDicomSlice(slice({ position: [0, 0, k % 4], values: () => 0 }), k))), /share one slice position/)
const compressed = Array.from({ length: 8 }, (_, k) => readDicomSlice(compressedSlice(k), k))
assert.equal(compressed[0].compressed, '1.2.840.10008.1.2.4.50')
assert.throws(() => buildDicomVolume(compressed), /uncompressed DICOM \(Explicit VR Little Endian\).*Orthanc/)

// A localizer stored in the same series is left out rather than stacked.
const withScout = buildDicomVolume([...Array.from({ length: 8 }, (_, k) => slice({ position: [0, 0, k], values: () => 0 })), slice({ position: [0, 0, 3.5], orientation: [1, 0, 0, 0, 0, -1], values: () => 0 })].map((bytes, i) => readDicomSlice(bytes, i)))
assert.equal(withScout.volume.dimensions[2], 8)
assert.match(withScout.warnings.join(' '), /different orientation/)

// MR with a fractional slope: rounded, not HU, description becomes the sequence.
const mr = buildDicomVolume(Array.from({ length: 8 }, (_, k) => readDicomSlice(slice({ position: [0, 0, 5 * k], modality: 'MR', description: 'T2 axial', slope: '1.5', intercept: '0', values: (i) => i }), k)))
assert.equal(mr.modality, 'MRI')
assert.equal(mr.acquisition.intensityIsHU, false)
assert.equal(mr.acquisition.sequence, 'T2 axial')
assert.equal(mr.volume.data[3], 5)
assert.match(mr.warnings.join(' '), /rounded/)

// Grouping and routing: CT series opens; X-ray, a short MR series and multi-frame files stay on the 2D path.
const dx = slice({ position: [0, 0, 0], modality: 'DX', series: '9.9', values: () => 0 })
const shortMr = [0, 1, 2].map((k) => slice({ position: [0, 0, k], modality: 'MR', series: '5.5', values: () => 0 }))
const multi = slice({ position: [0, 0, 0], series: '1.2.3.4', frames: '1', values: () => 0 })
const mixed = [dx, ...ct, ...shortMr, new Uint8Array([1, 2, 3])]
const outcome = dicomBuffersToVolume(mixed)
assert.ok(outcome.opened)
assert.deepEqual(outcome.opened.dimensions, [3, 4, 10])
assert.deepEqual(outcome.rest, [0, 11, 12, 13, 14])
assert.equal(outcome.opened.acquisition.intensityIsHU, true)
assert.equal(groupDicomSeries([readDicomSlice(multi)]).candidates.length, 0)
const twoSeries = dicomBuffersToVolume([...ct, ...Array.from({ length: 8 }, (_, k) => slice({ position: [0, 0, k], series: '7.7', values: () => 0 }))])
assert.equal(twoSeries.opened?.used.length, 10)
assert.match(twoSeries.warnings.join(' '), /1 other CT\/MR series was not opened/)
const failed = dicomBuffersToVolume(compressed.map((_, k) => compressedSlice(k)))
assert.equal(failed.opened, undefined)
assert.equal(failed.rest.length, 8)
assert.match(failed.warnings[0], /could not be opened as a volume/)

assert.equal(mayContainDicomSeries(Array.from({ length: 8 }, (_, i) => ({ name: `IM${i}` }))), true)
assert.equal(mayContainDicomSeries(Array.from({ length: 8 }, (_, i) => ({ name: `slice${i}.dcm` }))), true)
assert.equal(mayContainDicomSeries(Array.from({ length: 7 }, (_, i) => ({ name: `slice${i}.dcm` }))), false)
assert.equal(mayContainDicomSeries(Array.from({ length: 20 }, (_, i) => ({ name: `photo${i}.png` }))), false)

// Real pydicom fixture: explicit VR with preamble carries patient geometry.
const fixture = readDicomSlice(new Uint8Array(readFileSync(new URL('./fixtures/dicom/CT_small.dcm', import.meta.url))))
assert.equal(fixture.modality, 'CT')
assert.equal(fixture.position?.length, 3)
assert.equal(fixture.rowCosines?.length, 3)
assert.ok(fixture.pixels)

// 2D pixels: padding is excluded from the auto window and rendered black; PS3.3 linear VOI.
assert.equal(isPaddingValue(-2000, -2000), true)
assert.equal(isPaddingValue(-1500, -2000, -1000), true)
assert.equal(isPaddingValue(-999, -2000, -1000), false)
const padded = dicomPixelsToGray(new Uint8Array(Buffer.from(new Int16Array([-2000, 0, 100, 200]).buffer)), {
  rows: 1, cols: 4, bitsAllocated: 16, bitsStored: 16, pixelRepresentation: 1, bigEndian: false, slope: 1, intercept: 0, mono1: false, paddingValue: -2000,
})
assert.deepEqual([...padded], [0, 0, 128, 255])
assert.equal(linearVoi(40, 40, 400), (0.5 / 399 + 0.5) * 255)
assert.equal(linearVoi(-160, 40, 400), 0)
assert.equal(linearVoi(240, 40, 400), 255)
// The 2D decoder reads Pixel Padding Value from the header too.
const decoded = createDicomFrameDecoder(slice({ position: [0, 0, 0], padding: -2000, values: (i) => i === 0 ? -2000 : 0 })).decode(0)
assert.equal(decoded.gray[0], 0)
assert.throws(() => createDicomFrameDecoder(compressedSlice(0)), /Orthanc/)

console.log('DICOM series: geometry parsing, normal sort, spacing/gap/tilt warnings, refusals, HU rescale, padding, NRRD hand-off and routing checks passed')
