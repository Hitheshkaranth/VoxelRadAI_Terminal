// Classifier heatmap rendering shared by the viewer overlay and the printed report, so both show the same picture.
// Maps come from app/server/txrv_server.py (32×32 uint8, already rescaled so the in-lung median is 0). They are coarse:
// on the held-out ChestX-Det test split the peak fell inside the radiologist-boxed lesion 17% of the time
// (benchmark/localise.py), so every place that shows one says so.
import type { Finding, Heatmap } from '../types'

export const HEAT_RES = 256 // smoothed resolution; the maps themselves are 7×7 class activations upsampled to 32×32
export const HEAT_FLOOR = 0.2 // below this the film stays clear
export const HEAT_CONTOUR = 0.6 // outline of the hot region
export const HEAT_ACCURACY = '17%' // peak inside the lesion, held-out test (benchmark/localise.py)

/** Jet colour map, t in 0..1 → [r, g, b]. */
export function jet(t: number): [number, number, number] {
  const c = (x: number) => Math.round(255 * Math.min(1, Math.max(0, x)))
  return [c(1.5 - Math.abs(4 * t - 3)), c(1.5 - Math.abs(4 * t - 2)), c(1.5 - Math.abs(4 * t - 1))]
}

const upsampled = new WeakMap<Heatmap, Float32Array>()
/** Bilinear upsample of one map to HEAT_RES², 0..1. Cached per map (maps live in the store). */
export function upsample(heat: Heatmap): Float32Array {
  const hit = upsampled.get(heat)
  if (hit) return hit
  const src = Uint8Array.from(atob(heat.data), (ch) => ch.charCodeAt(0))
  const out = new Float32Array(HEAT_RES * HEAT_RES)
  for (let y = 0; y < HEAT_RES; y++) {
    const fy = Math.min(heat.h - 1, Math.max(0, ((y + 0.5) / HEAT_RES) * heat.h - 0.5))
    const y0 = Math.floor(fy), y1 = Math.min(heat.h - 1, y0 + 1), wy = fy - y0
    for (let x = 0; x < HEAT_RES; x++) {
      const fx = Math.min(heat.w - 1, Math.max(0, ((x + 0.5) / HEAT_RES) * heat.w - 0.5))
      const x0 = Math.floor(fx), x1 = Math.min(heat.w - 1, x0 + 1), wx = fx - x0
      const v =
        (src[y0 * heat.w + x0] * (1 - wx) + src[y0 * heat.w + x1] * wx) * (1 - wy) +
        (src[y1 * heat.w + x0] * (1 - wx) + src[y1 * heat.w + x1] * wx) * wy
      out[y * HEAT_RES + x] = v / 255
    }
  }
  upsampled.set(heat, out)
  return out
}

const peaks = new WeakMap<Heatmap, { x: number; y: number }>()
/** Peak of one map, in the map's own 0–1 coordinates (multiply into `heat.extent` for image coordinates). */
export function peakOf(heat: Heatmap): { x: number; y: number } {
  const hit = peaks.get(heat)
  if (hit) return hit
  const v = upsample(heat)
  let best = 0
  for (let i = 1; i < v.length; i++) if (v[i] > v[best]) best = i
  const p = { x: ((best % HEAT_RES) + 0.5) / HEAT_RES, y: (Math.floor(best / HEAT_RES) + 0.5) / HEAT_RES }
  peaks.set(heat, p)
  return p
}

/** Image area a finding claims, normalised: its box grown by 25%, else the lung zone named in its location text. */
export interface Region {
  x: number
  y: number
  w: number
  h: number
}
export function findingRegion(f: Pick<Finding, 'bbox' | 'location' | 'title'>): Region | null {
  const b = f.bbox
  if (b && b.w > 0 && b.h > 0) {
    const x = Math.max(0, b.x - b.w * 0.125), y = Math.max(0, b.y - b.h * 0.125)
    return { x, y, w: Math.min(1, b.x + b.w * 1.125) - x, h: Math.min(1, b.y + b.h * 1.125) - y }
  }
  const t = `${f.location ?? ''} ${f.title}`.toLowerCase()
  const right = /\bright\b/.test(t)
  const left = /\bleft\b/.test(t)
  // Radiographs are displayed with the patient's right on the image left.
  const xs: [number, number] = right === left ? [0, 1] : right ? [0, 0.55] : [0.45, 1]
  const ys: [number, number] = /apex|apical|upper/.test(t)
    ? [0, 0.5]
    : /base|basal|lower|costophrenic|hemidiaphragm/.test(t)
      ? [0.45, 1]
      : /mid|middle|hilar|perihilar|lingula/.test(t)
        ? [0.25, 0.75]
        : [0, 1]
  if (xs[1] - xs[0] === 1 && ys[1] - ys[0] === 1) return null
  return { x: xs[0], y: ys[0], w: xs[1] - xs[0], h: ys[1] - ys[0] }
}

const FEATHER = 0.05 // soft edge of a finding's region, as a fraction of the image

export interface FindingHeat {
  /** HEAT_RES² values on the same scale as the type's map (not renormalised: weak evidence stays cold). */
  v: Float32Array
  /** Peak in the map's 0–1 coordinates. */
  peak: { x: number; y: number }
  /** Strongest value inside the finding's region, 0–1 of the type's peak over the whole film. */
  strength: number
  /** False when the finding has no box and no zone, so the whole type map is shown. */
  regional: boolean
}

const perFinding = new Map<string, FindingHeat>()
/** The finding type's map restricted (softly) to the finding's own region: a different map per finding. */
export function findingHeat(heat: Heatmap, f: Pick<Finding, 'id' | 'bbox' | 'location' | 'title'>): FindingHeat {
  const region = findingRegion(f)
  const key = `${heat.data.slice(0, 24)}:${f.id}:${region ? [region.x, region.y, region.w, region.h].map((n) => n.toFixed(3)).join(',') : 'all'}`
  const hit = perFinding.get(key)
  if (hit) return hit
  const base = upsample(heat)
  const v = new Float32Array(base.length)
  const e = heat.extent
  let best = 0
  for (let i = 0; i < v.length; i++) {
    let wgt = 1
    if (region) {
      const ix = e.x + (((i % HEAT_RES) + 0.5) / HEAT_RES) * e.w
      const iy = e.y + ((Math.floor(i / HEAT_RES) + 0.5) / HEAT_RES) * e.h
      const dx = Math.max(region.x - ix, 0, ix - (region.x + region.w))
      const dy = Math.max(region.y - iy, 0, iy - (region.y + region.h))
      const d = Math.hypot(dx, dy)
      wgt = d === 0 ? 1 : Math.exp(-((d / FEATHER) ** 2))
    }
    v[i] = base[i] * wgt
    if (v[i] > v[best]) best = i
  }
  const out = {
    v,
    peak: { x: ((best % HEAT_RES) + 0.5) / HEAT_RES, y: (Math.floor(best / HEAT_RES) + 0.5) / HEAT_RES },
    strength: v[best],
    regional: !!region,
  }
  if (perFinding.size > 200) perFinding.delete(perFinding.keys().next().value!)
  perFinding.set(key, out)
  return out
}

/** A HEAT_RES² canvas with the value maps combined (max), jet-coloured, cold areas clear and hot regions outlined. */
export function heatCanvas(values: Float32Array[]): HTMLCanvasElement {
  const v = new Float32Array(HEAT_RES * HEAT_RES)
  for (const m of values) for (let i = 0; i < v.length; i++) v[i] = Math.max(v[i], m[i])
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = HEAT_RES
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(HEAT_RES, HEAT_RES)
  for (let i = 0; i < v.length; i++) {
    const t = v[i]
    const x = i % HEAT_RES
    const y = Math.floor(i / HEAT_RES)
    // Contour: a hot pixel next to a cooler one.
    const edge =
      t >= HEAT_CONTOUR &&
      ((x > 0 && v[i - 1] < HEAT_CONTOUR) || (x < HEAT_RES - 1 && v[i + 1] < HEAT_CONTOUR) ||
        (y > 0 && v[i - HEAT_RES] < HEAT_CONTOUR) || (y < HEAT_RES - 1 && v[i + HEAT_RES] < HEAT_CONTOUR))
    const [r, g, b] = edge ? [255, 255, 255] : jet(t)
    img.data[i * 4] = r
    img.data[i * 4 + 1] = g
    img.data[i * 4 + 2] = b
    img.data[i * 4 + 3] = edge ? 230 : t < HEAT_FLOOR ? 0 : Math.round(60 + 130 * ((t - HEAT_FLOOR) / (1 - HEAT_FLOOR)))
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

const overlays = new Map<string, string>()
/** heatCanvas as a PNG data URL, cached by `key` (the viewer re-renders on hover and pan). */
export function heatOverlayUrl(key: string, values: Float32Array[]): string {
  const hit = overlays.get(key)
  if (hit) return hit
  const url = heatCanvas(values).toDataURL()
  if (overlays.size > 40) overlays.delete(overlays.keys().next().value!)
  overlays.set(key, url)
  return url
}
