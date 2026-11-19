// Manual measurements on volume slices. Points are normalised to the displayed (oriented) slice, 0..1, so they
// survive zoom/pan; physical size comes only from the volume's voxel spacing. Values are source scalars, never
// assumed to be calibrated HU.
import { getSliceGeometry, voxelToWorld, type SliceGeometry, type Vec3, type Volume, type VolumePlane } from './volume.ts'

export interface SlicePoint { x: number; y: number }
export type VolumeMeasurementKind = 'length' | 'ellipse'
export interface VolumeMeasurement {
  id: string
  kind: VolumeMeasurementKind
  plane: VolumePlane
  /** Acquired slice index along the plane's normal. */
  index: number
  /** Length: the two end points. Ellipse: opposite corners of its bounding box. */
  a: SlicePoint
  b: SlicePoint
}
export interface RoiStats { mean: number; sd: number; min: number; max: number; count: number; areaMm2: number; widthMm: number; heightMm: number }

const strides = (volume: Volume) => [1, volume.dimensions[0], volume.dimensions[0] * volume.dimensions[1]]

/** Source scalar at a displayed slice pixel, or null outside the slice. */
function sampleDisplayed(volume: Volume, g: SliceGeometry, index: number, column: number, row: number): number | null {
  if (column < 0 || row < 0 || column >= g.width || row >= g.height || index < 0 || index >= g.count) return null
  const s = strides(volume)
  const c = g.flipColumn ? g.width - 1 - column : column, r = g.flipRow ? g.height - 1 - row : row
  return volume.data[index * s[g.axis] + r * s[g.rowAxis] + c * s[g.columnAxis]]
}

/** Voxel value and LPS position (mm) under a displayed slice point; null when the point is off the image. */
export function voxelReadout(volume: Volume, plane: VolumePlane, index: number, point: SlicePoint): { value: number; voxel: Vec3; world: Vec3 } | null {
  if (!(point.x >= 0 && point.x < 1 && point.y >= 0 && point.y < 1)) return null
  const g = getSliceGeometry(volume, plane)
  const column = Math.floor(point.x * g.width), row = Math.floor(point.y * g.height)
  const value = sampleDisplayed(volume, g, index, column, row)
  if (value === null) return null
  const voxel: Vec3 = [0, 0, 0]
  voxel[g.axis] = index
  voxel[g.columnAxis] = g.flipColumn ? g.width - 1 - column : column
  voxel[g.rowAxis] = g.flipRow ? g.height - 1 - row : row
  return { value, voxel, world: voxelToWorld(volume, voxel) }
}

/** In-plane distance in mm between two displayed slice points. */
export function sliceLengthMm(volume: Volume, plane: VolumePlane, a: SlicePoint, b: SlicePoint): number {
  const g = getSliceGeometry(volume, plane)
  return Math.hypot((b.x - a.x) * g.width * g.pixelSpacing[0], (b.y - a.y) * g.height * g.pixelSpacing[1])
}

/** Statistics over pixels whose centres fall inside the ellipse inscribed in the a–b box, on the source slice. */
export function ellipseStats(volume: Volume, plane: VolumePlane, index: number, a: SlicePoint, b: SlicePoint): RoiStats | null {
  const g = getSliceGeometry(volume, plane)
  const x0 = Math.min(a.x, b.x) * g.width, x1 = Math.max(a.x, b.x) * g.width
  const y0 = Math.min(a.y, b.y) * g.height, y1 = Math.max(a.y, b.y) * g.height
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2
  const widthMm = (x1 - x0) * g.pixelSpacing[0], heightMm = (y1 - y0) * g.pixelSpacing[1]
  let count = 0, sum = 0, squares = 0, min = Infinity, max = -Infinity
  if (rx > 0 && ry > 0) {
    for (let row = Math.max(0, Math.floor(y0)); row < Math.min(g.height, Math.ceil(y1)); row++) {
      for (let column = Math.max(0, Math.floor(x0)); column < Math.min(g.width, Math.ceil(x1)); column++) {
        const nx = (column + .5 - cx) / rx, ny = (row + .5 - cy) / ry
        if (nx * nx + ny * ny > 1) continue
        const value = sampleDisplayed(volume, g, index, column, row)
        if (value === null) continue
        count++; sum += value; squares += value * value
        if (value < min) min = value
        if (value > max) max = value
      }
    }
  }
  if (!count) return null
  const mean = sum / count
  // Population SD of the sampled pixels; guards tiny negative variance from floating-point error.
  const sd = Math.sqrt(Math.max(0, squares / count - mean * mean))
  return { mean, sd, min, max, count, areaMm2: Math.PI * (widthMm / 2) * (heightMm / 2), widthMm, heightMm }
}

const cm = (mm: number) => (mm / 10).toFixed(1)
const fixed = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1)
/** Unit label for scalar values: CT values are only nominally HU because calibration is never verified here. */
export const valueUnit = (modality: string) => modality.toUpperCase() === 'CT' ? 'HU (unverified)' : 'units (uncalibrated)'

/** Plain text for the report, e.g. "1.2 cm (axial 34)" or "1.2 x 0.8 cm ROI, mean 34.0 … (axial 34)". */
export function volumeMeasurementText(volume: Volume, m: VolumeMeasurement, modality: string): string {
  const where = `(${m.plane} ${m.index + 1})`
  if (m.kind === 'length') return `${cm(sliceLengthMm(volume, m.plane, m.a, m.b))} cm ${where}`
  const stats = ellipseStats(volume, m.plane, m.index, m.a, m.b)
  if (!stats) return `Empty ROI ${where}`
  return `${cm(stats.widthMm)} x ${cm(stats.heightMm)} cm ROI, mean ${fixed(stats.mean)}, SD ${fixed(stats.sd)}, min ${fixed(stats.min)}, max ${fixed(stats.max)} ${valueUnit(modality)}, area ${(stats.areaMm2 / 100).toFixed(2)} cm² ${where}`
}

/** Measurements drawn on this plane and slice only; others stay listed but are not drawn. */
export const measurementsOnSlice = (list: VolumeMeasurement[], plane: VolumePlane, index: number) => list.filter((m) => m.plane === plane && m.index === index)

export const MAX_VOLUME_MEASUREMENTS = 100

/** One-line cursor readout: source value, LPS position and voxel index. */
export function readoutText(readout: { value: number; voxel: Vec3; world: Vec3 } | null, modality: string): string {
  if (!readout) return ''
  return `${readout.value} ${valueUnit(modality)} · LPS ${readout.world.map((n) => n.toFixed(1)).join(', ')} mm · voxel ${readout.voxel.join(', ')}`
}
