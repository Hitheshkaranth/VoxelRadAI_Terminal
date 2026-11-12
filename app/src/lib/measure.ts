// Manual length and angle measurements on a 2D image. Points are stored normalised to the image (0..1), so they
// survive the display downscale; physical size comes only from DICOM pixel spacing, never from a guess.
import type { ImageMeasurement, MeasurePoint, StudyImage } from '../types.ts'

export const MAX_MEASUREMENTS = 50

type Sized = Pick<StudyImage, 'width' | 'height' | 'pixelSpacing' | 'sourceRows' | 'sourceColumns'>

/** Pixel grid the points refer to: the original source grid when known, otherwise the stored image. */
function grid(image: Sized) {
  const cols = image.sourceColumns ?? image.width
  const rows = image.sourceRows ?? image.height
  return { cols, rows }
}

/** Offset between two normalised points in mm (with spacing) or source pixels (without). */
function delta(image: Sized, a: MeasurePoint, b: MeasurePoint) {
  const { cols, rows } = grid(image)
  const s = image.pixelSpacing
  // DICOM Pixel Spacing is [row spacing (vertical), column spacing (horizontal)].
  return { dx: (b.x - a.x) * cols * (s ? s.col : 1), dy: (b.y - a.y) * rows * (s ? s.row : 1) }
}

export type LengthUnit = 'mm' | 'px'

export function measuredLength(image: Sized, a: MeasurePoint, b: MeasurePoint): { value: number; unit: LengthUnit } {
  const { dx, dy } = delta(image, a, b)
  return { value: Math.hypot(dx, dy), unit: image.pixelSpacing ? 'mm' : 'px' }
}

/** Angle at the middle point, in degrees (0..180), using physical geometry when spacing is known. */
export function measuredAngle(image: Sized, a: MeasurePoint, vertex: MeasurePoint, c: MeasurePoint): number {
  const u = delta(image, vertex, a), v = delta(image, vertex, c)
  const lu = Math.hypot(u.dx, u.dy), lv = Math.hypot(v.dx, v.dy)
  if (!lu || !lv) return 0
  const cos = Math.min(1, Math.max(-1, (u.dx * v.dx + u.dy * v.dy) / (lu * lv)))
  return (Math.acos(cos) * 180) / Math.PI
}

export function formatLength(value: number, unit: LengthUnit): string {
  return unit === 'mm' ? (value >= 100 ? `${(value / 10).toFixed(1)} cm` : `${value.toFixed(1)} mm`) : `${Math.round(value)} px`
}

export function measurementText(image: Sized, m: ImageMeasurement): string {
  if (m.kind === 'angle') return `${measuredAngle(image, m.points[0], m.points[1], m.points[2]).toFixed(1)}°`
  const { value, unit } = measuredLength(image, m.points[0], m.points[1])
  return formatLength(value, unit)
}

/** Plain-language note on what a length means for this image. */
export function spacingNote(image: Sized): string {
  const s = image.pixelSpacing
  if (!s) return 'No pixel spacing in this image, so lengths are in source pixels, not millimetres.'
  if (s.source === 'imager') return 'Lengths use Imager Pixel Spacing (at the detector), not corrected for magnification.'
  return 'Lengths use the DICOM Pixel Spacing.'
}

export const pointsFor = (kind: ImageMeasurement['kind']) => (kind === 'length' ? 2 : 3)

export function validMeasurement(value: unknown): value is ImageMeasurement {
  if (!value || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  return typeof m.id === 'string' && m.id.length > 0 && m.id.length <= 64 &&
    (m.kind === 'length' || m.kind === 'angle') && typeof m.createdAt === 'number' && Number.isFinite(m.createdAt) &&
    Array.isArray(m.points) && m.points.length === pointsFor(m.kind) &&
    m.points.every((p) => !!p && typeof p === 'object' && [p.x, p.y].every((n) => typeof n === 'number' && n >= 0 && n <= 1))
}

export function clampPoint(x: number, y: number): MeasurePoint {
  const c = (n: number) => Math.min(1, Math.max(0, n))
  return { x: c(x), y: c(y) }
}
