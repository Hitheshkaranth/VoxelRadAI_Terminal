import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { decodeNrrd, getSliceGeometry, renderSlice, voxelToWorld, type Vec3 } from '../src/lib/volume.ts'

let checks = 0
const equal = (actual: unknown, expected: unknown, description: string) => { assert.deepEqual(actual, expected, description); checks++ }
const close = (actual: number[], expected: number[], description: string) => { assert.ok(actual.every((n, i) => Math.abs(n - expected[i]) < 1e-8), description); checks++ }
const values = Array.from({ length: 24 }, (_, i) => i % 2 + 4 * (Math.floor(i / 2) % 3) + 16 * Math.floor(i / 6))
function fixture(options: { type?: string; bytes?: 1 | 2 | 4; signed?: boolean; big?: boolean; gzip?: boolean; directions?: string; space?: string; extras?: string; values?: number[]; crlf?: boolean } = {}): ArrayBuffer {
  const raw = new Uint8Array(24 * (options.bytes ?? 2))
  const view = new DataView(raw.buffer)
  for (const [i, n] of (options.values ?? values).entries()) {
    if (options.bytes === 1) view.setUint8(i, n)
    else if (options.bytes === 4) options.signed === false ? view.setUint32(i * 4, n, !options.big) : view.setInt32(i * 4, n, !options.big)
    else options.signed === false ? view.setUint16(i * 2, n, !options.big) : view.setInt16(i * 2, n, !options.big)
  }
  const header = ['NRRD0005', `type: ${options.type ?? 'short'}`, 'dimension: 3', `space: ${options.space ?? 'left-posterior-superior'}`, 'sizes: 2 3 4', `space directions: ${options.directions ?? '(2,0,0) (0,3,0) (0,0,4)'}`, 'space origin: (10,20,30)', `endian: ${options.big ? 'big' : 'little'}`, `encoding: ${options.gzip ? 'gzip' : 'raw'}`, options.extras ?? '# synthetic non-cubic geometry', '', ''].join(options.crlf ? '\r\n' : '\n')
  const result = Buffer.concat([Buffer.from(header), options.gzip ? gzipSync(raw) : raw])
  return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength)
}
const greys = (pixels: Uint8ClampedArray) => Array.from(pixels).filter((_, index) => index % 4 === 0)
const window = { center: 127.5, width: 255 }
const volume = await decodeNrrd(fixture())
equal(volume.dimensions, [2, 3, 4], 'noncubic dimensions retained')
equal(volume.spacing, [2, 3, 4], 'physical spacing retained')
equal(volume.directions, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], 'direction vectors normalized')
equal(Array.from(volume.data), values, 'axis0 is fastest in source array')
equal(volume.worldBounds, { min: [10, 20, 30], max: [12, 26, 42] }, 'patient bounds use origin and spacing')
equal(voxelToWorld(volume, [1, 2, 3]), [12, 26, 42], 'voxel corner maps to world')
const axial = renderSlice(volume, 'axial', 1, window)
equal([axial.axis, axial.width, axial.height, axial.count], [2, 2, 3, 4], 'axial dimensions and raw locator axis')
equal(greys(axial.pixels), [16, 17, 20, 21, 24, 25], 'axial pixel order')
equal(axial.position, [11, 23, 34], 'axial centre in patient coordinates')
equal(axial.labels, { right: 'L', left: 'R', bottom: 'P', top: 'A' }, 'radiological axial orientation')
const coronal = renderSlice(volume, 'coronal', 1, window)
equal([coronal.axis, coronal.width, coronal.height, coronal.count], [1, 2, 4, 3], 'coronal dimensions')
equal(greys(coronal.pixels), [52, 53, 36, 37, 20, 21, 4, 5], 'coronal shows superior at top')
const sagittal = renderSlice(volume, 'sagittal', 1, window)
equal([sagittal.axis, sagittal.width, sagittal.height, sagittal.count], [0, 3, 4, 2], 'sagittal dimensions')
equal(greys(sagittal.pixels), [49, 53, 57, 33, 37, 41, 17, 21, 25, 1, 5, 9], 'sagittal shows anterior left, superior top')
equal(sagittal.pixelSpacing, [3, 4], 'slice display aspect retains anisotropy')

const permuted = await decodeNrrd(fixture({ directions: '(0,1,0) (0,0,-1) (-2,0,0)', gzip: true, big: true, crlf: true }))
const permutedAxial = renderSlice(permuted, 'axial', 1, window)
equal([permutedAxial.axis, permutedAxial.columnAxis, permutedAxial.rowAxis], [1, 2, 0], 'MR-style axis permutation')
equal(greys(permutedAxial.pixels), [52, 36, 20, 4, 53, 37, 21, 5], 'permuted/flipped raw pixels with gzip and big endian')
equal(permutedAxial.position, [7, 20.5, 29], 'locator position after permutation')
const ras = await decodeNrrd(fixture({ space: 'right-anterior-superior' }))
equal(ras.origin, [-10, -20, 30], 'RAS origin converts to LPS')
equal(greys(renderSlice(ras, 'axial', 1, window).pixels), [25, 24, 21, 20, 17, 16], 'RAS directions flip rows and columns')

const angle = Math.PI / 12
const oblique = await decodeNrrd(fixture({ directions: `(1,0,0) (0,${Math.cos(angle)},${Math.sin(angle)}) (0,${-Math.sin(angle)},${Math.cos(angle)})` }))
equal(getSliceGeometry(oblique, 'axial').oblique, true, 'native oblique plane explicitly identified')
const obliqueSlice = renderSlice(oblique, 'axial', 2, window)
equal(greys(obliqueSlice.pixels), [32, 33, 36, 37, 40, 41], 'oblique view remains acquired plane without fake resampling')
close(obliqueSlice.position, [10.5, 20 + Math.cos(angle) - 2 * Math.sin(angle), 30 + Math.sin(angle) + 2 * Math.cos(angle)], 'oblique locator centre uses full direction matrix')
equal(obliqueSlice.labels.bottom, 'PS', 'compound orientation label reflects oblique row')

for (const config of [
  { type: 'int', bytes: 4 as const, values: values.map((n) => n - 1000), big: true },
  { type: 'uint32', bytes: 4 as const, signed: false, values: values.map((n) => n + 2 ** 31) },
  { type: 'uchar', bytes: 1 as const, signed: false },
  { type: 'char', bytes: 1 as const, values: values.map((n) => n - 70) },
  { type: 'ushort', signed: false, values: values.map((n) => n + 40000) },
]) {
  const decoded = await decodeNrrd(fixture(config))
  equal(Array.from(decoded.data), config.values ?? values, `${config.type} retains sign and precision`)
}
for (const [input, message] of [
  [fixture({ directions: '(1,0,0) (1,1,0) (0,0,1)' }), /non-orthogonal/],
  [fixture({ space: 'scanner-xyz' }), /anatomical/],
  [fixture({ type: 'float' }), /voxel type/],
  [fixture({ extras: 'data file: separate.raw' }), /Detached/],
  [fixture({ extras: 'dimension: 4' }), /three-dimensional/],
  [fixture({ extras: 'space units: "cm" "cm" "cm"' }), /millimetres/],
  [fixture({ extras: 'sizes: 2 3 5' }), /dimensions/],
  [fixture({ gzip: true, extras: 'sizes: 2 3 3' }), /exceeds/],
  [fixture({ extras: 'endian: unknown' }), /endian/],
] as const) { await assert.rejects(() => decodeNrrd(input), message); checks++ }
assert.throws(() => renderSlice(volume, 'axial', 4), /index/); checks++
assert.throws(() => renderSlice(volume, 'axial', -1), /index/); checks++
assert.throws(() => renderSlice(volume, 'axial', 0, { width: 0 }), /width/); checks++
equal(Array.from(renderSlice(volume, 'axial', 0, { center: 0, width: 1 }).pixels).filter((_, i) => i % 4 === 3), Array(6).fill(255), 'opaque pixel alpha')
console.log(`Volume decode, orientation and slicing: ${checks} checks passed`)
