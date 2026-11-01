// Skanda's own input for one CT/MRI slice: the image rendered the way Skanda was trained, plus the raw data its server
// needs to measure findings (skanda-grounding skanda/serve.py and skanda/ctmri.py).
// Why (docs/validation/2026-11-02-labeled-case-failure-report.md): CT/MRI slices were sent as one grey display window
// with the generic box_2d prompt. Skanda was trained on CT rendered as lung / soft-tissue / bone windows in R / G / B
// (skanda-grounding skanda/data/build_msd.py CT_WINDOWS) and on brain MRI as FLAIR / T1 post-contrast / T2, at the
// native pixel grid, axial, patient right on image left; its sizes and HU can only be measured with spacing and raw HU.

import { getSliceGeometry, type Volume, type VolumePlane } from './volume.ts'

/** = build_msd.CT_WINDOWS: [low, high] HU for R, G, B. */
export const SKANDA_CT_WINDOWS: [number, number][] = [[-1350, 150], [-160, 240], [-500, 1300]]

export interface SkandaSliceInput {
  /** PNG data URL at the native pixel grid (no aspect resampling: training slices were not resampled). */
  dataUrl: string
  width: number
  height: number
  /** Sent as the request's "skanda" field. */
  extension: {
    modality: 'ct' | 'mri'
    body: string
    pixel_spacing: [number, number]
    hu?: { b64: string; width: number; height: number }
    sequence?: string
    composite: boolean
  }
  /** Why the input differs from Skanda's training input, shown with the result. */
  limitations: string[]
}

/** Slice intensities in display orientation (the same traversal as renderSlice). */
export function sliceValues(volume: Volume, plane: VolumePlane, index: number): { values: Float32Array; width: number; height: number; pixelSpacing: [number, number] } {
  const g = getSliceGeometry(volume, plane)
  if (!Number.isInteger(index) || index < 0 || index >= g.count) throw new Error('Slice index is outside this volume.')
  const values = new Float32Array(g.width * g.height)
  const strides = [1, volume.dimensions[0], volume.dimensions[0] * volume.dimensions[1]]
  for (let row = 0; row < g.height; row++) {
    const r = g.flipRow ? g.height - 1 - row : row
    const rowOffset = index * strides[g.axis] + r * strides[g.rowAxis]
    for (let column = 0; column < g.width; column++) {
      const c = g.flipColumn ? g.width - 1 - column : column
      values[row * g.width + column] = volume.data[rowOffset + c * strides[g.columnAxis]]
    }
  }
  return { values, width: g.width, height: g.height, pixelSpacing: g.pixelSpacing }
}

/** [1, 99] percentiles of the positive voxels (build_msd per-volume MRI normalisation), from a strided sample. */
export function positivePercentiles(volume: Volume, maxSamples = 400_000): [number, number] {
  const step = Math.max(1, Math.floor(volume.data.length / maxSamples))
  const s: number[] = []
  for (let i = 0; i < volume.data.length; i += step) if (volume.data[i] > 0) s.push(volume.data[i])
  if (!s.length) return [volume.range[0], volume.range[1]]
  s.sort((a, b) => a - b)
  const at = (q: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]
  return [at(0.01), at(0.99)]
}

function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(out)
}

function pngDataUrl(rgb: (i: number) => [number, number, number], width: number, height: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(width, height)
  for (let i = 0; i < width * height; i++) {
    const [r, g, b] = rgb(i)
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

const unit = (v: number, lo: number, hi: number) => Math.round(255 * Math.min(1, Math.max(0, (v - lo) / (hi - lo || 1))))

/** Skanda input for one slice, or null with a reason when Skanda was not trained for it. */
export function skandaSliceInput(volume: Volume, plane: VolumePlane, index: number,
  source: { modality: string; title: string; bodyPart?: string; sequence?: string; intensityIsHU?: boolean },
  cache?: { mriRange?: [number, number] }): { input: SkandaSliceInput | null; reason?: string } {
  const modality = source.modality.toUpperCase().startsWith('CT') ? 'ct' : /^(MR|MRI)$/.test(source.modality.toUpperCase()) ? 'mri' : null
  if (!modality) return { input: null, reason: `Skanda reads CT and MRI volumes; this volume is ${source.modality}.` }
  if (plane !== 'axial') return { input: null, reason: 'Skanda was trained on axial slices only. Switch to the axial plane to analyze with Skanda.' }
  const { values, width, height, pixelSpacing } = sliceValues(volume, plane, index)
  const limitations: string[] = []
  const body = source.bodyPart || source.title
  if (modality === 'ct') {
    // NRRD/DICOM-derived CT here carries HU when the source stores rescaled values; say so when that is unknown
    if (source.intensityIsHU === false) limitations.push('CT intensities are not in HU: windows and attenuation are unreliable.')
    const hu = new Int16Array(width * height)
    for (let i = 0; i < hu.length; i++) hu[i] = Math.max(-32768, Math.min(32767, Math.round(values[i])))
    const dataUrl = pngDataUrl((i) => SKANDA_CT_WINDOWS.map(([lo, hi]) => unit(values[i], lo, hi)) as [number, number, number], width, height)
    return { input: { dataUrl, width, height, limitations, extension: { modality, body, pixel_spacing: pixelSpacing, composite: true,
      hu: { b64: toBase64(new Uint8Array(hu.buffer)), width, height } } } }
  }
  const [lo, hi] = cache?.mriRange ?? positivePercentiles(volume)
  if (cache) cache.mriRange = [lo, hi]
  limitations.push(`One MRI sequence${source.sequence ? ` (${source.sequence})` : ''}: Skanda was trained on FLAIR, T1 post-contrast and T2 together; single-sequence reads are outside its training data.`)
  const dataUrl = pngDataUrl((i) => { const v = unit(values[i], lo, hi); return [v, v, v] }, width, height)
  return { input: { dataUrl, width, height, limitations, extension: { modality, body, pixel_spacing: pixelSpacing, composite: false, sequence: source.sequence } } }
}
