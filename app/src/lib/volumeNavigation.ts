import { getSliceGeometry, type Vec3, type Volume, type VolumePlane } from './volume.ts'

type Geometry = Pick<Volume, 'dimensions'>
const clamp = (value: number, count: number) => Math.max(0, Math.min(count - 1, Number.isFinite(value) ? value : 0))
export function centerVoxel(volume: Geometry): Vec3 {
  return volume.dimensions.map((count) => (count - 1) / 2) as Vec3
}
/** Keep a single acquired voxel position as the anchor for all three view planes. */
export function setSliceAnchor(volume: Volume, anchor: Vec3, plane: VolumePlane, index: number): Vec3 {
  const point = anchor.map((value, axis) => clamp(value, volume.dimensions[axis])) as Vec3
  const { axis, count } = getSliceGeometry(volume, plane)
  point[axis] = Math.round(clamp(index, count))
  return point
}
export function indexForPlane(volume: Volume, anchor: Vec3, plane: VolumePlane): number {
  const { axis, count } = getSliceGeometry(volume, plane)
  return Math.round(clamp(anchor[axis], count))
}
export function indexAcrossPlanes(volume: Volume, fromPlane: VolumePlane, fromIndex: number, toPlane: VolumePlane, anchor: Vec3 = centerVoxel(volume)): number {
  return indexForPlane(volume, setSliceAnchor(volume, anchor, fromPlane, fromIndex), toPlane)
}
/** Pixel-center coordinates in the oriented displayed image, normalized to its full extent. */
export function slicePointFromVoxel(volume: Volume, plane: VolumePlane, anchor: Vec3): { x: number; y: number } {
  const g = getSliceGeometry(volume, plane)
  const column = clamp(anchor[g.columnAxis], g.width)
  const row = clamp(anchor[g.rowAxis], g.height)
  return { x: ((g.flipColumn ? g.width - 1 - column : column) + .5) / g.width,
    y: ((g.flipRow ? g.height - 1 - row : row) + .5) / g.height }
}
export function voxelFromSlicePoint(volume: Volume, plane: VolumePlane, index: number, point: { x: number; y: number }): Vec3 {
  const g = getSliceGeometry(volume, plane), voxel = centerVoxel(volume)
  const column = clamp(point.x * g.width - .5, g.width), row = clamp(point.y * g.height - .5, g.height)
  voxel[g.axis] = Math.round(clamp(index, g.count))
  voxel[g.columnAxis] = g.flipColumn ? g.width - 1 - column : column
  voxel[g.rowAxis] = g.flipRow ? g.height - 1 - row : row
  return voxel
}
/** Inverse of voxelToWorld for the orthonormal acquired basis supported by the parser. */
export function worldToVoxel(volume: Pick<Volume, 'origin' | 'directions' | 'spacing'>, world: Vec3): Vec3 {
  return volume.directions.map((direction, axis) => direction.reduce((sum, value, worldAxis) => sum + value * (world[worldAxis] - volume.origin[worldAxis]), 0) / volume.spacing[axis]) as Vec3
}

export interface ContentBounds { x: number; y: number; width: number; height: number }
/** Fit displayed content only. Near-black display pixels are excluded; this is not anatomy segmentation.
 * Returns pixel-edge bounds, with a 2% image-size margin. The source image is never cropped or modified. */
export function visibleContentBounds(pixels: Uint8ClampedArray, width: number, height: number): ContentBounds | null {
  if (width < 1 || height < 1 || pixels.length !== width * height * 4) return null
  let left = width, top = height, right = -1, bottom = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (x + y * width) * 4
    if (pixels[offset + 3] === 0 || Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) <= 3) continue
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  if (right < left || bottom < top) return null
  const marginX = Math.ceil(width * .02), marginY = Math.ceil(height * .02)
  left = Math.max(0, left - marginX); right = Math.min(width, right + 1 + marginX)
  top = Math.max(0, top - marginY); bottom = Math.min(height, bottom + 1 + marginY)
  return { x: left, y: top, width: right - left, height: bottom - top }
}
