/** Shared display limits; these change presentation, never source pixels. */
export function clampZoom(value: number): number { return Number.isFinite(value) ? Math.max(.5, Math.min(8, value)) : 1 }
export function clampSliceIndex(value: number, count: number): number { return Number.isFinite(value) && Number.isFinite(count) ? Math.max(0, Math.min(Math.max(0, Math.floor(count) - 1), Math.round(value))) : 0 }
export function adjustWindowLevel(center: number, width: number, brighter: boolean): number {
  const step = Math.max(1, Math.abs(Number.isFinite(width) ? width : 1) * .05)
  return (Number.isFinite(center) ? center : 0) + (brighter ? -step : step)
}
