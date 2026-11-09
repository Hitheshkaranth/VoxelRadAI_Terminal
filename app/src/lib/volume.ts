import type { VolumeAcquisition } from './volumeAcquisition.ts'
/** Scalar NRRD volumes. Geometry is patient LPS in millimetres; axis 0 is stored fastest. */
export type Vec3 = [number, number, number]
export type VolumePlane = 'axial' | 'coronal' | 'sagittal'
export type Plane = VolumePlane
export type VoxelData = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array
export interface Volume {
  /** Immutable acquisition context: changing this must create a new Volume object. */
  acquisition?: VolumeAcquisition
  data: VoxelData
  dimensions: Vec3
  spacing: Vec3
  /** Unit direction vector for each acquired/storage axis, in patient LPS coordinates. */
  directions: [Vec3, Vec3, Vec3]
  /** Centre of acquired voxel (0,0,0), in LPS millimetres. */
  origin: Vec3
  space: 'LPS'
  range: [number, number]
  /** Bounds of voxel centres, not inferred anatomical landmarks. */
  worldBounds: { min: Vec3; max: Vec3 }
}
export interface SliceGeometry {
  /** Native acquired plane, rather than a resampled canonical plane. */
  oblique: boolean
  plane: VolumePlane
  axis: number
  columnAxis: number
  rowAxis: number
  flipColumn: boolean
  flipRow: boolean
  width: number
  height: number
  count: number
  pixelSpacing: [number, number]
  sliceSpacing: number
  labels: { top: string; bottom: string; left: string; right: string }
}
export interface VolumeSlice extends SliceGeometry {
  pixels: Uint8ClampedArray
  /** Acquired/storage index along `axis`, matching the 3D locator. */
  index: number
  /** LPS position of the slice centre. */
  position: Vec3
}

const MAX_VOXELS = 256 * 1024 * 1024
const scalarTypes: Record<string, { bytes: 1 | 2 | 4; signed: boolean }> = {
  char: { bytes: 1, signed: true }, 'signed char': { bytes: 1, signed: true }, int8: { bytes: 1, signed: true }, int8_t: { bytes: 1, signed: true },
  uchar: { bytes: 1, signed: false }, 'unsigned char': { bytes: 1, signed: false }, uint8: { bytes: 1, signed: false }, uint8_t: { bytes: 1, signed: false },
  int: { bytes: 4, signed: true }, 'signed int': { bytes: 4, signed: true }, int32: { bytes: 4, signed: true }, int32_t: { bytes: 4, signed: true },
  uint: { bytes: 4, signed: false }, 'unsigned int': { bytes: 4, signed: false }, uint32: { bytes: 4, signed: false }, uint32_t: { bytes: 4, signed: false },
  short: { bytes: 2, signed: true }, 'short int': { bytes: 2, signed: true }, 'signed short': { bytes: 2, signed: true }, 'signed short int': { bytes: 2, signed: true }, int16: { bytes: 2, signed: true }, int16_t: { bytes: 2, signed: true },
  ushort: { bytes: 2, signed: false }, 'unsigned short': { bytes: 2, signed: false }, 'unsigned short int': { bytes: 2, signed: false }, uint16: { bytes: 2, signed: false }, uint16_t: { bytes: 2, signed: false },
}
function vector(text: string | undefined, field: string): Vec3 {
  if (!text || !/^\([^()]+\)$/.test(text.trim())) throw new Error(`NRRD ${field} must be a three-dimensional vector.`)
  const values = text.trim().slice(1, -1).split(',').map(Number)
  if (values.length !== 3 || !values.every(Number.isFinite)) throw new Error(`Invalid NRRD ${field}.`)
  return values as Vec3
}

/** Convert an acquired voxel coordinate to patient LPS millimetres. Fractional coordinates are allowed. */
export function voxelToWorld(volume: Pick<Volume, 'origin' | 'directions' | 'spacing'>, voxel: Vec3): Vec3 {
  return volume.origin.map((origin, worldAxis) => origin + voxel.reduce((sum, coordinate, axis) => sum + coordinate * volume.spacing[axis] * volume.directions[axis][worldAxis], 0)) as Vec3
}

function anatomicalAxes(directions: [Vec3, Vec3, Vec3]): { axes: number[]; oblique: boolean } {
  for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
    const dot = directions[a].reduce((sum, value, axis) => sum + value * directions[b][axis], 0)
    if (Math.abs(dot) > 0.001) throw new Error('Sheared/non-orthogonal NRRD axes are not supported by this slice viewer.')
  }
  // Assign each acquired axis a distinct closest anatomical axis. Permutation search also handles
  // near-45-degree acquisitions without assigning two storage axes to the same anatomical plane.
  const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
  const score = (axes: number[]) => axes.reduce((sum, axis, storage) => sum + Math.abs(directions[storage][axis]), 0)
  const axes = permutations.reduce((best, candidate) => score(candidate) > score(best) ? candidate : best)
  return { axes, oblique: directions.some((direction, storage) => Math.abs(direction[axes[storage]]) < 0.99999) }
}

/** Dominant patient directions, retaining compound labels for oblique in-plane vectors. */
function directionLabel(vector: Vec3): string {
  return vector.map((value, axis) => ({ value, axis })).filter(({ value }) => Math.abs(value) > 0.1)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .map(({ value, axis }) => (value > 0 ? ['L', 'P', 'S'] : ['R', 'A', 'I'])[axis]).join('')
}

async function inflate(bytes: ArrayBuffer, expected: number): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decode gzip NRRD volumes.')
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader()
  const output = new Uint8Array(expected)
  let offset = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (offset + value.length > expected) {
        await reader.cancel()
        throw new Error('NRRD voxel data exceeds the declared volume dimensions.')
      }
      output.set(value, offset)
      offset += value.length
    }
  } catch (error) {
    throw new Error(`Could not decompress NRRD: ${error instanceof Error ? error.message : String(error)}`)
  } finally { reader.releaseLock() }
  if (offset !== expected) throw new Error('The NRRD voxel data is truncated.')
  return output.buffer
}

/** Decode attached raw/gzip, scalar 8/16/32-bit NRRD; no diagnosis or intensity-unit inference. */
export async function decodeNrrd(input: ArrayBuffer): Promise<Volume> {
  const bytes = new Uint8Array(input)
  let headerEnd = -1
  let payloadOffset = -1
  for (let i = 0; i < Math.min(bytes.length - 1, 1024 * 1024); i++) {
    if (bytes[i] === 10 && bytes[i + 1] === 10) { headerEnd = i; payloadOffset = i + 2; break }
    if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) { headerEnd = i; payloadOffset = i + 4; break }
  }
  if (headerEnd < 0) throw new Error('NRRD header is missing its blank-line separator or is too large.')
  const lines = new TextDecoder().decode(bytes.subarray(0, headerEnd)).split(/\r?\n/)
  if (!/^NRRD000[1-5]$/.test(lines.shift()?.trim() ?? '')) throw new Error('This file is not a supported NRRD volume.')
  const fields: Record<string, string> = {}
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const separator = line.indexOf(':')
    if (separator < 1 || line[separator + 1] === '=') continue
    fields[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim()
  }
  if (fields.dimension !== '3') throw new Error('Only three-dimensional scalar NRRD volumes are supported.')
  if (fields['data file'] || fields.datafile) throw new Error('Detached NRRD data is not supported. Import a single attached .nrrd file.')
  if (Number(fields['byte skip'] ?? 0) !== 0 || Number(fields['line skip'] ?? 0) !== 0) throw new Error('NRRD byte/line skipping is not supported.')
  const type = scalarTypes[fields.type?.toLowerCase()]
  if (!type) throw new Error('NRRD voxel type must be signed or unsigned 8-bit, 16-bit or 32-bit integer.')
  const sizes = (fields.sizes ?? '').split(/\s+/).map(Number)
  if (sizes.length !== 3 || sizes.some((size) => !Number.isSafeInteger(size) || size < 1)) throw new Error('NRRD sizes must contain three positive integers.')
  const dimensions = sizes as Vec3
  const length = sizes.reduce((count, size) => count * size, 1)
  if (!Number.isSafeInteger(length) || length > MAX_VOXELS) throw new Error('NRRD volume exceeds the supported 256-million-voxel limit.')
  const space = fields.space?.toLowerCase()
  const signs: Vec3 | undefined = ({
    'left-posterior-superior': [1, 1, 1], lps: [1, 1, 1],
    'right-anterior-superior': [-1, -1, 1], ras: [-1, -1, 1],
    'left-anterior-superior': [1, -1, 1], las: [1, -1, 1],
    'right-posterior-superior': [-1, 1, 1], rps: [-1, 1, 1],
  } as Record<string, Vec3>)[space ?? '']
  if (!signs) throw new Error('NRRD must declare an anatomical LPS, RAS, LAS or RPS space for orientation labels.')
  const directionStrings = fields['space directions']?.match(/\([^()]+\)|none/gi)
  if (!directionStrings || directionStrings.length !== 3) throw new Error('NRRD must provide three spatial direction vectors.')
  const vectors = directionStrings.map((text) => vector(text, 'space directions').map((value, index) => value * signs[index]) as Vec3)
  const spacing = vectors.map((direction) => Math.hypot(...direction)) as Vec3
  if (spacing.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error('NRRD spacing must be positive and finite.')
  const directions = vectors.map((direction, axis) => direction.map((value) => value / spacing[axis]) as Vec3) as [Vec3, Vec3, Vec3]
  anatomicalAxes(directions)
  const origin = vector(fields['space origin'], 'space origin').map((value, axis) => value * signs[axis]) as Vec3
  const units = fields['space units']?.match(/"[^"]*"/g)?.map((unit) => unit.slice(1, -1).toLowerCase())
  if (fields['space units'] && (units?.length !== 3 || units.some((unit) => !['mm', 'millimeter', 'millimeters'].includes(unit)))) {
    throw new Error('NRRD spatial units must be millimetres.')
  }
  if (type.bytes > 1 && !['little', 'big'].includes(fields.endian)) throw new Error('A multi-byte NRRD must declare little or big endian.')
  const encoding = fields.encoding?.toLowerCase()
  const expected = length * type.bytes
  if (expected > 512 * 1024 * 1024) throw new Error('NRRD data exceeds the supported 512 MB decoded-volume limit.')
  let raw: ArrayBuffer
  if (encoding === 'raw') {
    if (bytes.length - payloadOffset !== expected) throw new Error('NRRD raw voxel data does not match its declared dimensions.')
    raw = input.slice(payloadOffset)
  } else if (encoding === 'gzip' || encoding === 'gz') raw = await inflate(input.slice(payloadOffset), expected)
  else throw new Error('Only raw or gzip NRRD encoding is supported.')
  const data: VoxelData = type.bytes === 1
    ? type.signed ? new Int8Array(raw) : new Uint8Array(raw)
    : type.bytes === 2 ? type.signed ? new Int16Array(length) : new Uint16Array(length)
      : type.signed ? new Int32Array(length) : new Uint32Array(length)
  const view = new DataView(raw)
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < length; i++) {
    if (type.bytes === 2) data[i] = type.signed ? view.getInt16(i * 2, fields.endian === 'little') : view.getUint16(i * 2, fields.endian === 'little')
    if (type.bytes === 4) data[i] = type.signed ? view.getInt32(i * 4, fields.endian === 'little') : view.getUint32(i * 4, fields.endian === 'little')
    min = Math.min(min, data[i]); max = Math.max(max, data[i])
  }
  const geometry = { origin, directions, spacing }
  const corners = Array.from({ length: 8 }, (_, corner) => voxelToWorld(geometry, dimensions.map((size, axis) => corner & (1 << axis) ? size - 1 : 0) as Vec3))
  return { data, dimensions, origin, directions, spacing, space: 'LPS', range: [min, max], worldBounds: {
    min: [0, 1, 2].map((axis) => Math.min(...corners.map((point) => point[axis]))) as Vec3,
    max: [0, 1, 2].map((axis) => Math.max(...corners.map((point) => point[axis]))) as Vec3,
  } }
}

/** Anatomical planes mapped to acquired axes; the slice index remains in original acquisition order. */
export function getSliceGeometry(volume: Volume, plane: VolumePlane): SliceGeometry {
  const { axes, oblique } = anatomicalAxes(volume.directions)
  const mapping = {
    axial: { normal: 2, column: 0, row: 1, rowSign: 1, labels: { top: 'A', bottom: 'P', left: 'R', right: 'L' } },
    coronal: { normal: 1, column: 0, row: 2, rowSign: -1, labels: { top: 'S', bottom: 'I', left: 'R', right: 'L' } },
    sagittal: { normal: 0, column: 1, row: 2, rowSign: -1, labels: { top: 'S', bottom: 'I', left: 'A', right: 'P' } },
  }[plane]
  if (!mapping) throw new Error('Choose an axial, coronal or sagittal slice plane.')
  const axis = axes.indexOf(mapping.normal)
  const columnAxis = axes.indexOf(mapping.column)
  const rowAxis = axes.indexOf(mapping.row)
  const flipColumn = volume.directions[columnAxis][mapping.column] < 0
  const flipRow = volume.directions[rowAxis][mapping.row] * mapping.rowSign < 0
  const column = volume.directions[columnAxis].map((value) => value * (flipColumn ? -1 : 1)) as Vec3
  const row = volume.directions[rowAxis].map((value) => value * (flipRow ? -1 : 1)) as Vec3
  const labels = { right: directionLabel(column), left: directionLabel(column.map((value) => -value) as Vec3), bottom: directionLabel(row), top: directionLabel(row.map((value) => -value) as Vec3) }
  return { oblique, plane, axis, columnAxis, rowAxis, flipColumn, flipRow,
    width: volume.dimensions[columnAxis], height: volume.dimensions[rowAxis], count: volume.dimensions[axis],
    pixelSpacing: [volume.spacing[columnAxis], volume.spacing[rowAxis]], sliceSpacing: volume.spacing[axis], labels }
}

/** Window source intensities into RGBA. Intensity units are deliberately not assumed to be HU. */
export function renderSlice(volume: Volume, plane: VolumePlane, index: number, window: { center?: number; width?: number } = {}): VolumeSlice {
  const geometry = getSliceGeometry(volume, plane)
  if (!Number.isInteger(index) || index < 0 || index >= geometry.count) throw new Error('Slice index is outside this volume.')
  const width = window.width ?? Math.max(1, volume.range[1] - volume.range[0])
  const center = window.center ?? (volume.range[0] + volume.range[1]) / 2
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(center)) throw new Error('Window width must be positive and centre must be finite.')
  const low = center - width / 2
  const scale = 255 / width
  const pixels = new Uint8ClampedArray(geometry.width * geometry.height * 4)
  const strides = [1, volume.dimensions[0], volume.dimensions[0] * volume.dimensions[1]]
  for (let row = 0; row < geometry.height; row++) {
    const r = geometry.flipRow ? geometry.height - 1 - row : row
    const rowOffset = index * strides[geometry.axis] + r * strides[geometry.rowAxis]
    for (let column = 0; column < geometry.width; column++) {
      const c = geometry.flipColumn ? geometry.width - 1 - column : column
      const intensity = volume.data[rowOffset + c * strides[geometry.columnAxis]]
      const out = (row * geometry.width + column) * 4
      const grey = Math.max(0, Math.min(255, Math.round((intensity - low) * scale)))
      pixels[out] = pixels[out + 1] = pixels[out + 2] = grey; pixels[out + 3] = 255
    }
  }
  const voxel = volume.dimensions.map((size) => (size - 1) / 2) as Vec3
  voxel[geometry.axis] = index
  return { ...geometry, pixels, index, position: voxelToWorld(volume, voxel) }
}
