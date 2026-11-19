// Pointer/wheel helpers shared by the 2D and volume viewers. Pure, so the stepping and orientation maths are testable.

/** Pixels of trackpad scroll per slice/image step. */
export const WHEEL_STEP_PX = 30
/** A single event at least this large is a discrete mouse-wheel notch: exactly one step. */
const NOTCH_PX = 50

/** Accumulate wheel delta: a mouse notch steps once, trackpad deltas step in proportion to the distance scrolled. */
export function wheelSteps(accumulated: number, deltaY: number, deltaMode = 0): { steps: number; remainder: number } {
  const px = deltaMode === 1 ? deltaY * 20 : deltaMode === 2 ? deltaY * 800 : deltaY
  if (!Number.isFinite(px) || px === 0) return { steps: 0, remainder: Number.isFinite(accumulated) ? accumulated : 0 }
  if (Math.abs(px) >= NOTCH_PX) return { steps: Math.sign(px), remainder: 0 }
  // Reversing direction drops the leftover, so a change of mind is never swallowed by the opposite remainder.
  const total = (Math.sign(accumulated) === Math.sign(px) ? accumulated : 0) + px
  const steps = Math.trunc(total / WHEEL_STEP_PX) || 0
  return { steps, remainder: total - steps * WHEEL_STEP_PX }
}

export type Rotation = 0 | 90 | 180 | 270
export interface ImageOrientation { rotate: Rotation; flipH: boolean; flipV: boolean }
export const DEFAULT_ORIENTATION: ImageOrientation = { rotate: 0, flipH: false, flipV: false }

export const rotateBy = (o: ImageOrientation, degrees: 90 | -90): ImageOrientation => ({ ...o, rotate: (((o.rotate + degrees) % 360 + 360) % 360) as Rotation })
export const isDefaultOrientation = (o: ImageOrientation) => !o.rotate && !o.flipH && !o.flipV

/** CSS applied after the pan translate: flip in image space first, then rotate on screen. */
export const orientationTransform = (o: ImageOrientation) => `rotate(${o.rotate}deg) scale(${o.flipH ? -1 : 1}, ${o.flipV ? -1 : 1})`

/** Display box size on screen after rotation. */
export const orientedSize = (o: ImageOrientation, w: number, h: number) => o.rotate % 180 ? { w: h, h: w } : { w, h }

/** Screen offset from the image centre (px) to normalised image coordinates, undoing rotation and flips. */
export function screenToImage(o: ImageOrientation, dx: number, dy: number, w: number, h: number): { x: number; y: number } {
  const t = (o.rotate * Math.PI) / 180, cos = Math.round(Math.cos(t)), sin = Math.round(Math.sin(t))
  const ux = dx * cos + dy * sin, uy = -dx * sin + dy * cos
  return { x: (o.flipH ? -ux : ux) / w + .5, y: (o.flipV ? -uy : uy) / h + .5 }
}

/** Normalised image coordinates to a screen offset from the image centre (px). Inverse of screenToImage. */
export function imageToScreen(o: ImageOrientation, x: number, y: number, w: number, h: number): { x: number; y: number } {
  const t = (o.rotate * Math.PI) / 180, cos = Math.round(Math.cos(t)), sin = Math.round(Math.sin(t))
  const fx = (x - .5) * w * (o.flipH ? -1 : 1), fy = (y - .5) * h * (o.flipV ? -1 : 1)
  return { x: fx * cos - fy * sin, y: fx * sin + fy * cos }
}

/** Ids of the images that share the given image's DICOM series, in study order; empty without a series UID. */
export function seriesSiblings(images: { id: string; sourceSeriesUid?: string }[], imageId: string): string[] {
  const uid = images.find((image) => image.id === imageId)?.sourceSeriesUid
  return uid ? images.filter((image) => image.sourceSeriesUid === uid).map((image) => image.id) : []
}
