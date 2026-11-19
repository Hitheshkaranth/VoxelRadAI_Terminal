// DICOM CT/MR series → scalar Volume (the same shape decodeNrrd produces). DOM-free so Node can test it
// and a Web Worker can run it. Geometry is DICOM patient LPS, which is also the Volume convention.
import dicomParser from 'dicom-parser'
import { compressedDicomMessage, parseDicomBytes, parseSpacing, readNum, readPadding, UNCOMPRESSED } from './dicomIntake.ts'
import { isPaddingValue } from './dicomPixels.ts'
import { voxelToWorld, type Vec3, type Volume } from './volume.ts'
import type { VolumeAcquisition } from './volumeAcquisition.ts'

/** Fewer slices than this is treated as a handful of images, not a volume. */
export const MIN_VOLUME_SLICES = 8
const VOLUME_MODALITIES = new Set(['CT', 'MR'])
const MAX_VOXELS = 256 * 1024 * 1024
const MAX_AXIS = 4096

export interface DicomSliceHeader {
  /** Position in the caller's input list, so callers can map slices back to files. */
  index: number
  seriesUid?: string
  seriesDescription: string
  modality: string
  bodyPart: string
  rows: number
  cols: number
  frames: number
  /** ImagePositionPatient: centre of the first transmitted pixel, LPS mm. */
  position?: Vec3
  /** ImageOrientationPatient: direction of increasing column index (along a row), then of increasing row index. */
  rowCosines?: Vec3
  colCosines?: Vec3
  pixelSpacing?: { row: number; col: number }
  sliceThickness?: number
  spacingBetweenSlices?: number
  instanceNumber?: number
  slope: number
  intercept: number
  hasRescale: boolean
  rescaleType?: string
  paddingValue?: number
  paddingRangeLimit?: number
  windowCenter?: number
  windowWidth?: number
  bitsAllocated: number
  bitsStored: number
  signed: boolean
  bigEndian: boolean
  photometric: string
  /** Set to the transfer syntax when the pixel data is compressed (no codec is bundled). */
  compressed?: string
  /** Uncompressed single-frame pixel bytes (a view, not a copy). */
  pixels?: Uint8Array
}

function readVector(ds: dicomParser.DataSet, tag: string, length: number): number[] | undefined {
  const text = ds.string(tag)
  if (!text) return undefined
  const values = text.split('\\').map((value) => Number(value.trim()))
  return values.length === length && values.every(Number.isFinite) ? values : undefined
}

const text = (ds: dicomParser.DataSet, tag: string) => ds.string(tag)?.trim() ?? ''

/** Parse one DICOM file's geometry, rescale and pixel layout. Throws only when the header is unreadable. */
export function readDicomSlice(bytes: Uint8Array, index = 0): DicomSliceHeader {
  const ds = parseDicomBytes(bytes)
  const transferSyntax = text(ds, 'x00020010')
  const pixelEl = ds.elements.x7fe00010
  const compressed = pixelEl?.encapsulatedPixelData || (transferSyntax && !UNCOMPRESSED.has(transferSyntax)) ? transferSyntax || 'encapsulated' : undefined
  const rows = ds.uint16('x00280010') ?? 0
  const cols = ds.uint16('x00280011') ?? 0
  const frameText = text(ds, 'x00280008')
  const frames = /^\d+$/.test(frameText) ? Number(frameText) : 1
  const bitsAllocated = ds.uint16('x00280100') ?? 16
  const signed = ds.uint16('x00280103') === 1
  const position = readVector(ds, 'x00200032', 3) as Vec3 | undefined
  const orientation = readVector(ds, 'x00200037', 6)
  const slopeValue = readNum(ds, 'x00281053')
  const interceptValue = readNum(ds, 'x00281052')
  const uid = text(ds, 'x0020000e')
  let pixels: Uint8Array | undefined
  if (!compressed && pixelEl?.dataOffset != null && pixelEl.length && pixelEl.length !== 0xffffffff && rows && cols) {
    const needed = rows * cols * (bitsAllocated / 8)
    if (pixelEl.length >= needed && pixelEl.dataOffset + needed <= ds.byteArray.length) pixels = ds.byteArray.subarray(pixelEl.dataOffset, pixelEl.dataOffset + needed)
  }
  return {
    index,
    seriesUid: uid && uid.length <= 64 && /^\d+(?:\.\d+)*$/.test(uid) ? uid : undefined,
    seriesDescription: text(ds, 'x0008103e').slice(0, 120),
    modality: text(ds, 'x00080060').toUpperCase(),
    bodyPart: text(ds, 'x00180015').slice(0, 120),
    rows, cols, frames,
    position,
    rowCosines: orientation?.slice(0, 3) as Vec3 | undefined,
    colCosines: orientation?.slice(3, 6) as Vec3 | undefined,
    pixelSpacing: parseSpacing(ds.string('x00280030')),
    sliceThickness: readNum(ds, 'x00180050'),
    spacingBetweenSlices: readNum(ds, 'x00180088'),
    instanceNumber: readNum(ds, 'x00200013'),
    slope: slopeValue != null && slopeValue !== 0 ? slopeValue : 1,
    intercept: interceptValue ?? 0,
    hasRescale: slopeValue != null || interceptValue != null,
    rescaleType: text(ds, 'x00281054').toUpperCase() || undefined,
    ...readPadding(ds, signed),
    windowCenter: readNum(ds, 'x00281050'),
    windowWidth: readNum(ds, 'x00281051'),
    bitsAllocated,
    bitsStored: ds.uint16('x00280101') ?? bitsAllocated,
    signed,
    bigEndian: ds.byteArrayParser === dicomParser.bigEndianByteArrayParser,
    photometric: text(ds, 'x00280004') || 'MONOCHROME2',
    ...(compressed ? { compressed } : {}),
    ...(pixels ? { pixels } : {}),
  }
}

/** Cheap name-only screen: could this drop be a CT/MR series worth reading in full? */
export function mayContainDicomSeries(files: { name: string; type?: string }[]): boolean {
  // Exported series are often extensionless (IM0001, 1.2.840…); those are confirmed by the DICM magic later.
  const count = files.filter((file) => /\.(dcm|dicom)$/i.test(file.name) || file.type === 'application/dicom' || !/\.[a-z][a-z0-9]{1,4}$/i.test(file.name)).length
  return count >= MIN_VOLUME_SLICES
}

const isVolumeSlice = (slice: DicomSliceHeader) => VOLUME_MODALITIES.has(slice.modality) && slice.frames === 1

/** Group slices by SeriesInstanceUID; only CT/MR series with enough single-frame slices are volume candidates. */
export function groupDicomSeries(slices: DicomSliceHeader[]): { candidates: DicomSliceHeader[][]; other: DicomSliceHeader[] } {
  const groups = new Map<string, DicomSliceHeader[]>()
  const other: DicomSliceHeader[] = []
  for (const slice of slices) {
    if (!slice.seriesUid || !isVolumeSlice(slice)) { other.push(slice); continue }
    groups.set(slice.seriesUid, [...(groups.get(slice.seriesUid) ?? []), slice])
  }
  const candidates: DicomSliceHeader[][] = []
  for (const group of groups.values()) {
    if (group.length >= MIN_VOLUME_SLICES) candidates.push(group)
    else other.push(...group)
  }
  // Largest first: when several series are dropped together, the main acquisition usually has the most slices.
  candidates.sort((a, b) => b.length - a.length)
  return { candidates, other }
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
// `+ 0` turns -0 into 0 so exported direction vectors read cleanly.
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1] + 0, a[2] * b[0] - a[0] * b[2] + 0, a[0] * b[1] - a[1] * b[0] + 0]
const unit = (v: Vec3): Vec3 | undefined => { const length = Math.hypot(...v); return length > 1e-6 ? v.map((x) => x / length) as Vec3 : undefined }
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] }
const round = (value: number, digits = 2) => Number(value.toFixed(digits))

export interface DicomVolumeResult {
  volume: Volume
  title: string
  modality: 'CT' | 'MRI'
  /** WindowCenter/Width from the middle slice, already in rescaled (real-value) units. */
  window?: { center: number; width: number }
  acquisition: VolumeAcquisition
  warnings: string[]
  /** Input indexes of the slices that made up the volume, in stacking order. */
  used: number[]
  seriesUid?: string
}

/** Stored (pre-rescale) value of pixel i, honouring bits stored, sign and byte order. */
function storedReader(slice: DicomSliceHeader) {
  const pixels = slice.pixels!
  const stored = Math.min(Math.max(1, slice.bitsStored || slice.bitsAllocated), slice.bitsAllocated)
  const mask = stored >= 32 ? 0xffffffff : (1 << stored) - 1
  const signBit = 1 << (stored - 1)
  const wide = slice.bitsAllocated === 16
  return (i: number) => {
    let v = wide ? slice.bigEndian ? (pixels[i * 2] << 8) | pixels[i * 2 + 1] : (pixels[i * 2 + 1] << 8) | pixels[i * 2] : pixels[i]
    v &= mask
    if (slice.signed && v & signBit) v -= 1 << stored
    return v
  }
}

/** Sort one series along its slice normal and build a Volume with real (rescaled) intensities. */
export function buildDicomVolume(series: DicomSliceHeader[]): DicomVolumeResult {
  const warnings: string[] = []
  const compressed = series.find((slice) => slice.compressed)
  if (compressed) throw new Error(compressedDicomMessage(compressed.compressed!))
  const located = series.filter((slice) => slice.position && slice.rowCosines && slice.colCosines)
  if (located.length < MIN_VOLUME_SLICES) throw new Error('The series lacks Image Position/Orientation (Patient) on its slices, so slice order and spacing cannot be established.')
  if (located.length < series.length) warnings.push(`${series.length - located.length} image(s) without position/orientation were left out.`)

  // Keep the dominant orientation: a localizer or reformat stored in the same series must not join the stack.
  const orientationKey = (slice: DicomSliceHeader) => [...slice.rowCosines!, ...slice.colCosines!].map((v) => v.toFixed(3)).join(',')
  const byOrientation = new Map<string, DicomSliceHeader[]>()
  for (const slice of located) byOrientation.set(orientationKey(slice), [...(byOrientation.get(orientationKey(slice)) ?? []), slice])
  const stack = [...byOrientation.values()].sort((a, b) => b.length - a.length)[0]
  if (stack.length < MIN_VOLUME_SLICES) throw new Error('The series mixes image orientations; no single orientation has enough slices to form a volume.')
  if (stack.length < located.length) warnings.push(`${located.length - stack.length} image(s) with a different orientation (for example a localizer) were left out.`)

  const first = stack[0]
  if (stack.some((slice) => slice.rows !== first.rows || slice.cols !== first.cols)) throw new Error('The series slices have inconsistent image sizes, so they cannot be stacked into one volume.')
  if (stack.some((slice) => slice.bitsAllocated !== 8 && slice.bitsAllocated !== 16)) throw new Error('Only 8- or 16-bit DICOM pixel data can be stacked into a volume.')
  if (stack.some((slice) => !['MONOCHROME1', 'MONOCHROME2'].includes(slice.photometric))) throw new Error('Only monochrome DICOM series can be opened as a volume.')
  if (stack.some((slice) => !slice.pixels)) throw new Error('One or more slices have missing or truncated pixel data.')
  const spacing = first.pixelSpacing
  if (!spacing || stack.some((slice) => !slice.pixelSpacing || Math.abs(slice.pixelSpacing.row - spacing.row) > 1e-3 || Math.abs(slice.pixelSpacing.col - spacing.col) > 1e-3)) {
    throw new Error('The series lacks a consistent Pixel Spacing, so in-plane geometry is unknown.')
  }
  const row = unit(first.rowCosines!)
  const col = unit(first.colCosines!)
  if (!row || !col || Math.abs(dot(row, col)) > 1e-3) throw new Error('The series Image Orientation (Patient) is not a pair of perpendicular unit vectors.')
  const normal = cross(row, col)

  const sorted = stack.map((slice) => ({ slice, distance: dot(slice.position!, normal) })).sort((a, b) => a.distance - b.distance)
  const gaps = sorted.slice(1).map((entry, i) => entry.distance - sorted[i].distance)
  if (gaps.some((gap) => gap < 0.01)) throw new Error('Several images share one slice position (multi-phase, multi-echo or duplicate files). Export a single phase or echo to open it as a volume.')
  const count = sorted.length
  const extent = sorted[count - 1].distance - sorted[0].distance
  const sliceSpacing = extent / (count - 1)
  const typical = median(gaps)
  const missing = gaps.filter((gap) => gap > typical * 1.5).length
  if (missing) warnings.push(`Slice positions have ${missing} gap(s) (typical spacing ${round(typical)} mm). Slices are shown evenly spaced, so distances across a gap are approximate.`)
  else if (gaps.some((gap) => Math.abs(gap - typical) > Math.max(0.01, typical * 0.1))) warnings.push(`Slice spacing is not uniform (${round(Math.min(...gaps))}–${round(Math.max(...gaps))} mm); an average of ${round(sliceSpacing)} mm is used.`)
  const declared = first.spacingBetweenSlices
  if (declared && declared > 0 && Math.abs(declared - typical) > typical * 0.1) warnings.push(`Spacing Between Slices (${round(declared)} mm) disagrees with slice positions (${round(typical)} mm); positions are used.`)
  // Gantry tilt (or any shear): slice origins drift sideways as well as along the normal.
  const travel = sorted[count - 1].slice.position!.map((value, axis) => value - sorted[0].slice.position![axis]) as Vec3
  const tilt = Math.acos(Math.min(1, Math.abs(dot(travel, normal)) / (Math.hypot(...travel) || 1))) * 180 / Math.PI
  if (tilt > 0.5) warnings.push(`The slices are sheared by about ${round(tilt, 1)}° (gantry tilt). The volume is displayed without tilt correction, so reformatted planes and through-plane distances are approximate.`)

  const dimensions: Vec3 = [first.cols, first.rows, count]
  const voxels = first.cols * first.rows * count
  if (dimensions.some((size) => size > MAX_AXIS) || voxels > MAX_VOXELS) throw new Error('This series is larger than the supported volume size (4096 voxels per axis, 256 million voxels).')

  // Pass 1: real-value range of non-padding voxels, so the storage type and padding fill are known up front.
  const plane = first.rows * first.cols
  let min = Infinity
  let max = -Infinity
  let fractional = false
  for (const { slice } of sorted) {
    const read = storedReader(slice)
    if (!Number.isInteger(slice.slope) || !Number.isInteger(slice.intercept)) fractional = true
    for (let i = 0; i < plane; i++) {
      const stored = read(i)
      if (isPaddingValue(stored, slice.paddingValue, slice.paddingRangeLimit)) continue
      const value = stored * slice.slope + slice.intercept
      if (value < min) min = value
      if (value > max) max = value
    }
  }
  if (!Number.isFinite(min)) throw new Error('Every voxel in the series is marked as padding.')
  const fill = Math.round(min)
  const wide = Math.round(min) < -32768 || Math.round(max) > 32767
  const data = wide ? new Int32Array(voxels) : new Int16Array(voxels)
  if (fractional) warnings.push('Rescale slope/intercept produce fractional values; intensities are rounded to whole numbers.')

  // Pass 2: rescale per slice (slopes can differ slice to slice), padding becomes the lowest real value.
  sorted.forEach(({ slice }, z) => {
    const read = storedReader(slice)
    const offset = z * plane
    for (let i = 0; i < plane; i++) {
      const stored = read(i)
      data[offset + i] = isPaddingValue(stored, slice.paddingValue, slice.paddingRangeLimit) ? fill : Math.round(stored * slice.slope + slice.intercept)
    }
  })

  const directions: [Vec3, Vec3, Vec3] = [row, col, normal]
  const origin = sorted[0].slice.position!
  const voxelSpacing: Vec3 = [spacing.col, spacing.row, sliceSpacing]
  const geometry = { origin, directions, spacing: voxelSpacing }
  const corners = Array.from({ length: 8 }, (_, corner) => voxelToWorld(geometry, dimensions.map((size, axis) => corner & (1 << axis) ? size - 1 : 0) as Vec3))
  const volume: Volume = {
    data, dimensions, origin, directions, spacing: voxelSpacing, space: 'LPS', range: [fill, Math.round(max)],
    worldBounds: {
      min: [0, 1, 2].map((axis) => Math.min(...corners.map((point) => point[axis]))) as Vec3,
      max: [0, 1, 2].map((axis) => Math.max(...corners.map((point) => point[axis]))) as Vec3,
    },
  }

  const middle = sorted[Math.floor(count / 2)].slice
  const window = middle.windowCenter != null && middle.windowWidth != null && middle.windowWidth >= 1 ? { center: middle.windowCenter, width: middle.windowWidth } : undefined
  const modality = first.modality === 'CT' ? 'CT' : 'MRI'
  // CT rescale output is Hounsfield units unless the header says otherwise (PS3.3 C.8.2.1.1.7).
  const hu = modality === 'CT' && stack.every((slice) => slice.hasRescale) && (!first.rescaleType || first.rescaleType === 'HU')
  if (modality === 'CT' && !hu) warnings.push('The CT header does not establish Hounsfield-unit calibration; confirm it in Acquisition details if appropriate.')
  const acquisition: VolumeAcquisition = {
    modality, bodyPart: first.bodyPart, sequence: modality === 'MRI' ? first.seriesDescription : '', contrast: 'unknown', intensityIsHU: hu,
  }
  return {
    volume, modality, window, acquisition, warnings,
    title: first.seriesDescription || `${modality} series · ${count} slices`,
    used: sorted.map(({ slice }) => slice.index),
    seriesUid: first.seriesUid,
  }
}

/** Raw little-endian NRRD for a Volume, so the existing NRRD-based viewer, storage and analysis reuse it unchanged. */
export function volumeToNrrd(volume: Volume): Uint8Array {
  const type = volume.data instanceof Int16Array ? 'int16' : volume.data instanceof Int32Array ? 'int32' : volume.data instanceof Uint16Array ? 'uint16'
    : volume.data instanceof Uint32Array ? 'uint32' : volume.data instanceof Int8Array ? 'int8' : 'uint8'
  const vector = (v: number[]) => `(${v.map((x) => String(x)).join(',')})`
  const header = [
    'NRRD0004', `type: ${type}`, 'dimension: 3', 'space: left-posterior-superior', `sizes: ${volume.dimensions.join(' ')}`,
    `space directions: ${volume.directions.map((direction, axis) => vector(direction.map((x) => x * volume.spacing[axis]))).join(' ')}`,
    'kinds: domain domain domain', 'endian: little', 'encoding: raw', `space origin: ${vector(volume.origin)}`, 'space units: "mm" "mm" "mm"', '', '',
  ].join('\n')
  const head = new TextEncoder().encode(header)
  const body = new Uint8Array(volume.data.buffer, volume.data.byteOffset, volume.data.byteLength)
  const out = new Uint8Array(head.length + body.length)
  out.set(head)
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 || volume.data.BYTES_PER_ELEMENT === 1) out.set(body, head.length)
  else {
    // Big-endian host: write each sample explicitly.
    const view = new DataView(out.buffer, head.length)
    const size = volume.data.BYTES_PER_ELEMENT
    for (let i = 0; i < volume.data.length; i++) {
      if (size === 2) view.setInt16(i * 2, volume.data[i], true)
      else view.setInt32(i * 4, volume.data[i], true)
    }
  }
  return out
}

export interface DicomSeriesOutcome {
  opened?: Omit<DicomVolumeResult, 'volume'> & { nrrd: Uint8Array; dimensions: Vec3 }
  /** Input indexes that should continue down the 2D image path. */
  rest: number[]
  warnings: string[]
}

/** Read many DICOM buffers, open the largest CT/MR series as a volume and hand everything else back. */
export function dicomBuffersToVolume(buffers: Uint8Array[]): DicomSeriesOutcome {
  const slices: DicomSliceHeader[] = []
  const rest: number[] = []
  buffers.forEach((bytes, index) => {
    try { slices.push(readDicomSlice(bytes, index)) } catch { rest.push(index) }
  })
  const { candidates, other } = groupDicomSeries(slices)
  rest.push(...other.map((slice) => slice.index))
  const warnings: string[] = []
  if (!candidates.length) return { rest: rest.sort((a, b) => a - b), warnings }
  const [main, ...more] = candidates
  // Several volumes cannot be open at once; flattening the extra series into hundreds of 2D images would bury the study.
  if (more.length) warnings.push(`${more.length} other CT/MR series ${more.length === 1 ? 'was' : 'were'} not opened. Drop ${more.length === 1 ? 'it' : 'each'} separately to view ${more.length === 1 ? 'it' : 'them'}.`)
  try {
    const { volume, ...result } = buildDicomVolume(main)
    const used = new Set(result.used)
    rest.push(...main.filter((slice) => !used.has(slice.index)).map((slice) => slice.index))
    return { opened: { ...result, nrrd: volumeToNrrd(volume), dimensions: volume.dimensions }, rest: rest.sort((a, b) => a - b), warnings: [...warnings, ...result.warnings] }
  } catch (error) {
    // Fall back to today's per-image path so nothing silently disappears.
    warnings.push(`The series could not be opened as a volume: ${error instanceof Error ? error.message : String(error)}`)
    rest.push(...main.map((slice) => slice.index))
    return { rest: rest.sort((a, b) => a - b), warnings }
  }
}
