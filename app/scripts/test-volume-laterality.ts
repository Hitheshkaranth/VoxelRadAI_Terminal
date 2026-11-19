// Left/right regression: a voxel on the patient's RIGHT must draw on the viewer's LEFT, under the 'R' label, in axial
// and coronal views (radiological convention), for every way the geometry can reach the viewer: NRRD in LPS or RAS
// space with any direction matrix (including the Slicer samples' real headers and SOOP sub-47's real NIfTI affine),
// and DICOM series (IPP/IOP, LPS) through the NRRD hand-off.
//
// Ground truth here is computed independently of volume.ts: world = origin + Σ index · column vector, in the file's own
// space; RAS (NIfTI) becomes LPS by negating x and y. In LPS, +x points to the patient's LEFT, so of two points the one
// with the smaller LPS x is further to the patient's right. (In RAS/NIfTI it is the opposite: +x is the patient's RIGHT.)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decodeNrrd, getSliceGeometry, renderSlice, type Vec3, type Volume, type VolumePlane } from '../src/lib/volume.ts'
import { buildDicomVolume, readDicomSlice, volumeToNrrd } from '../src/lib/dicomSeries.ts'

let checks = 0
type Space = 'left-posterior-superior' | 'right-anterior-superior'
interface Case { name: string; space: Space; columns: [Vec3, Vec3, Vec3]; origin: Vec3; sizes: Vec3 }

/** Patient-left coordinate (LPS x, mm) of a voxel, from the header alone. */
function lpsX(c: Case, voxel: Vec3): number {
  const x = c.origin[0] + voxel.reduce((sum, index, axis) => sum + index * c.columns[axis][0], 0)
  return c.space === 'right-anterior-superior' ? -x : x
}

function nrrd(c: Case, marker: Vec3): ArrayBuffer {
  const vec = (v: number[]) => `(${v.join(',')})`
  const header = ['NRRD0004', 'type: short', 'dimension: 3', `space: ${c.space}`, `sizes: ${c.sizes.join(' ')}`,
    `space directions: ${c.columns.map(vec).join(' ')}`, 'kinds: domain domain domain', 'endian: little', 'encoding: raw',
    `space origin: ${vec(c.origin)}`, '', ''].join('\n')
  const data = new Int16Array(c.sizes[0] * c.sizes[1] * c.sizes[2])
  data[marker[0] + c.sizes[0] * (marker[1] + c.sizes[1] * marker[2])] = 1000
  const out = Buffer.concat([Buffer.from(header), Buffer.from(data.buffer)])
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
}

/** Where the marker lands on screen: mean column/row of the bright pixels, plus the slice's labels. */
function onScreen(volume: Volume, plane: VolumePlane, marker: Vec3) {
  const axis = getSliceGeometry(volume, plane).axis
  const slice = renderSlice(volume, plane, marker[axis], { center: 500, width: 1000 })
  const hits: [number, number][] = []
  for (let i = 0; i < slice.width * slice.height; i++) if (slice.pixels[i * 4] > 200) hits.push([i % slice.width, Math.floor(i / slice.width)])
  assert.equal(hits.length, 1, `${plane}: marker voxel must render exactly once`)
  return { column: hits[0][0], width: slice.width, labels: slice.labels, oblique: slice.oblique }
}

/** Assert radiological laterality for one marker: patient right → viewer left under 'R'; patient left → viewer right under 'L'. */
function expectSide(volume: Volume, marker: Vec3, side: 'right' | 'left', name: string) {
  for (const plane of ['axial', 'coronal'] as const) {
    const { column, width, labels } = onScreen(volume, plane, marker)
    assert.match(labels.left, /^R/, `${name} ${plane}: viewer-left label is R (got ${labels.left})`)
    assert.match(labels.right, /^L/, `${name} ${plane}: viewer-right label is L (got ${labels.right})`)
    const viewerSide = column < (width - 1) / 2 ? 'left' : column > (width - 1) / 2 ? 'right' : 'centre'
    assert.equal(viewerSide, side === 'right' ? 'left' : 'right',
      `${name} ${plane}: patient-${side} voxel ${marker.join(',')} drew at column ${column}/${width} (viewer ${viewerSide})`)
    checks += 3
  }
}

/** Two markers mirrored across the volume's x extent; the header alone says which one is on the patient's right. */
async function checkCase(c: Case, a: Vec3, b: Vec3, expectedRightOfPatient: 'a' | 'b') {
  const [xa, xb] = [lpsX(c, a), lpsX(c, b)]
  assert.notEqual(xa, xb, `${c.name}: markers must differ in patient x`)
  const right = xa < xb ? 'a' : 'b'
  assert.equal(right, expectedRightOfPatient, `${c.name}: hand-derived patient side agrees with the header arithmetic`)
  checks++
  for (const [marker, id] of [[a, 'a'], [b, 'b']] as const) {
    expectSide(await decodeNrrd(nrrd(c, marker)), marker, id === right ? 'right' : 'left', `${c.name} marker ${id}`)
  }
}

const identity: [Vec3, Vec3, Vec3] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
const sizes: Vec3 = [9, 9, 5]

// LPS, identity: i increases toward the patient's LEFT, so i = 1 is the patient's right.
await checkCase({ name: 'LPS identity', space: 'left-posterior-superior', columns: identity, origin: [0, 0, 0], sizes }, [1, 4, 2], [7, 4, 2], 'a')
// LPS with x reversed (how most CT headers and the Slicer CT sample store rows): i = 1 is now the patient's LEFT.
await checkCase({ name: 'LPS x-reversed', space: 'left-posterior-superior', columns: [[-1, 0, 0], [0, -1, 0], [0, 0, 1]], origin: [0, 0, 0], sizes }, [1, 4, 2], [7, 4, 2], 'b')
// RAS identity (NIfTI-style header): i increases toward the patient's RIGHT, so i = 7 is the patient's right.
await checkCase({ name: 'RAS identity', space: 'right-anterior-superior', columns: identity, origin: [0, 0, 0], sizes }, [1, 4, 2], [7, 4, 2], 'b')
// RAS with x reversed (typical scanner NIfTI, e.g. SOOP): i increases toward the patient's LEFT, so i = 1 is the right.
await checkCase({ name: 'RAS x-reversed', space: 'right-anterior-superior', columns: [[-1, 0, 0], [0, 1, 0], [0, 0, 1]], origin: [0, 0, 0], sizes }, [1, 4, 2], [7, 4, 2], 'a')

// The two bundled Slicer samples: their real space/direction/origin headers on a small synthetic grid.
for (const file of ['ct-brain', 'mr-head']) {
  const text = readFileSync(new URL(`../public/samples/${file}.nrrd`, import.meta.url)).subarray(0, 2048).toString('latin1')
  const field = (name: string) => text.match(new RegExp(`^${name}: (.+)$`, 'm'))?.[1] ?? ''
  const vectors = [...field('space directions').matchAll(/\(([^)]+)\)/g)].map((m) => m[1].split(',').map(Number) as Vec3)
  const origin = field('space origin').slice(1, -1).split(',').map(Number) as Vec3
  assert.equal(field('space'), 'left-posterior-superior')
  // The storage axis that runs most nearly along patient x; markers at its two ends, centred on the other axes.
  const xAxis = vectors.map((v) => Math.abs(v[0])).indexOf(Math.max(...vectors.map((v) => Math.abs(v[0]))))
  const small: Vec3 = [9, 9, 9]
  const a = [4, 4, 4] as Vec3, b = [4, 4, 4] as Vec3
  a[xAxis] = 1; b[xAxis] = 7
  // Increasing along xAxis moves toward patient left when its LPS x component is positive.
  await checkCase({ name: `${file} header`, space: 'left-posterior-superior', columns: vectors as [Vec3, Vec3, Vec3], origin, sizes: small }, a, b, vectors[xAxis][0] > 0 ? 'a' : 'b')
}

// SOOP sub-47 (OpenNeuro ds004889) DWI TRACE: its real NIfTI sform (RAS, qform = sform, code 2), 256 x 256 x 26.
// Lesion-mask centroid is voxel (165.6, 100.9, 13.7) = RAS (-33.7, -28.1, 16.7) mm: NEGATIVE RAS x is the patient's
// LEFT (the brain centre on axial 16 is at RAS x = +2.0). The app showed it on the viewer's right under 'L', which is
// correct. Marker a = lesion centroid on axial 16 (index 15); marker b = its mirror across i = 127.5.
const soopRas = [
  [-0.936753511428833, 0.005872368812561035, 0.23644083738327026, 117.61927032470703],
  [0.008885204792022705, 0.9343081116676331, 0.4914141297340393, -130.5891876220703],
  [0.036337077617645264, -0.07707250118255615, 5.975165367126465, -63.51103210449219],
]
const soopColumns = [0, 1, 2].map((axis) => soopRas.map((row) => row[axis])) as [Vec3, Vec3, Vec3]
const soopOrigin = soopRas.map((row) => row[3]) as Vec3
const lesion: Vec3 = [165, 101, 15], mirror: Vec3 = [90, 101, 15]
const soop: Case = { name: 'SOOP sub-47 as RAS NRRD', space: 'right-anterior-superior', columns: soopColumns, origin: soopOrigin, sizes: [256, 256, 26] }
assert.ok(lpsX(soop, lesion) > 30, 'SOOP lesion is ~33 mm to the patient\'s left (LPS x > 0)')
await checkCase(soop, lesion, mirror, 'b')
// The same volume written the way a correct NIfTI → NRRD converter writes LPS: negate x and y of every vector.
const lps = (v: Vec3) => [-v[0], -v[1], v[2]] as Vec3
await checkCase({ ...soop, name: 'SOOP sub-47 as LPS NRRD', space: 'left-posterior-superior', columns: soopColumns.map(lps) as [Vec3, Vec3, Vec3], origin: lps(soopOrigin) }, lesion, mirror, 'b')
const soopVolume = await decodeNrrd(nrrd(soop, lesion))
const soopAxial = onScreen(soopVolume, 'axial', lesion)
assert.equal(soopAxial.oblique, true, 'SOOP axial is flagged as the acquired oblique plane, as in the recording')
assert.equal(soopAxial.column, 165, 'SOOP lesion column on screen matches the recording (lesion right of midline, under L)')
checks += 2

// A converter that forgets RAS → LPS (writes the NIfTI affine under an LPS label) DOES mirror the patient: guard the
// decoder against silently accepting that as correct — the patient-left lesion would draw under 'R'.
const forgotten = await decodeNrrd(nrrd({ ...soop, space: 'left-posterior-superior' }, lesion))
assert.ok(onScreen(forgotten, 'axial', lesion).column < 128, 'mislabelled RAS-as-LPS input mirrors (documents the failure mode)')
checks++

// DICOM series: IPP/IOP are LPS. Stored column c of a slice sits at IPP + c · colSpacing · rowCosine.
function element(group: number, tag: number, value: Buffer) {
  const header = Buffer.alloc(8)
  header.writeUInt16LE(group); header.writeUInt16LE(tag, 2); header.writeUInt32LE(value.length, 4)
  return Buffer.concat([header, value])
}
const text = (value: string) => Buffer.from(value.length % 2 ? `${value} ` : value)
const us = (value: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b }
function dicomSlice(position: Vec3, orientation: number[], marker?: { row: number; col: number }) {
  const rows = 7, cols = 7
  const pixels = Buffer.alloc(rows * cols * 2)
  if (marker) pixels.writeInt16LE(1000, (marker.row * cols + marker.col) * 2)
  return new Uint8Array(Buffer.concat([
    element(0x0008, 0x0060, text('MR')), element(0x0020, 0x000e, text('1.2.3.9')),
    element(0x0020, 0x0032, text(position.join('\\'))), element(0x0020, 0x0037, text(orientation.join('\\'))),
    element(0x0028, 0x0002, us(1)), element(0x0028, 0x0004, text('MONOCHROME2')),
    element(0x0028, 0x0010, us(rows)), element(0x0028, 0x0011, us(cols)), element(0x0028, 0x0030, text('1\\1')),
    element(0x0028, 0x0100, us(16)), element(0x0028, 0x0101, us(16)), element(0x0028, 0x0103, us(1)),
    element(0x7fe0, 0x0010, pixels),
  ]))
}
async function checkDicom(name: string, orientation: number[], step: Vec3, markerCol: number, side: 'right' | 'left') {
  const k0 = 4, row = 3
  const files = Array.from({ length: 9 }, (_, k) => readDicomSlice(dicomSlice(step.map((s) => s * k) as Vec3, orientation, k === k0 ? { row, col: markerCol } : undefined), k))
  // Independent truth: LPS x of the marker = IPP.x + col · rowCosine.x (IPP.x is 0 on every slice here).
  const x = markerCol * orientation[0]
  assert.equal(x < 3 * orientation[0] ? 'right' : 'left', side, `${name}: hand-derived side agrees with IPP/IOP`)
  const { volume } = buildDicomVolume(files)
  const marker: Vec3 = [markerCol, row, k0]
  expectSide(volume, marker, side, `${name} (DICOM)`)
  const handedOff = await decodeNrrd(volumeToNrrd(volume).slice().buffer)
  expectSide(handedOff, marker, side, `${name} (DICOM → NRRD hand-off)`)
  checks++
}
// Head-first axial: row cosine (1,0,0) → column 0 is the patient's right.
await checkDicom('axial HFS', [1, 0, 0, 0, 1, 0], [0, 0, 5], 0, 'right')
await checkDicom('axial HFS', [1, 0, 0, 0, 1, 0], [0, 0, 5], 6, 'left')
// Feet-first axial: row cosine (-1,0,0) → column 0 is the patient's LEFT.
await checkDicom('axial FFS', [-1, 0, 0, 0, 1, 0], [0, 0, -5], 0, 'left')
await checkDicom('axial FFS', [-1, 0, 0, 0, 1, 0], [0, 0, -5], 6, 'right')
// Coronal: row cosine (1,0,0), column cosine (0,0,-1).
await checkDicom('coronal', [1, 0, 0, 0, 0, -1], [0, -4, 0], 0, 'right')
await checkDicom('coronal', [1, 0, 0, 0, 0, -1], [0, -4, 0], 6, 'left')

console.log(`volume laterality checks passed (${checks})`)
