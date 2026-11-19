// Thick-slab projections (MIP / MinIP / average) along the active plane's normal. Display only: analysis and
// measurements keep using the single acquired slice.
import { renderSlice, type Volume, type VolumePlane, type VolumeSlice } from './volume.ts'

export type SlabMode = 'none' | 'mip' | 'minip' | 'avg'
export interface SlabSettings { mode: SlabMode; thicknessMm: number }
export const SLAB_LABELS: Record<SlabMode, string> = { none: 'Single slice', mip: 'MIP', minip: 'MinIP', avg: 'Average' }

/** Inclusive slice range covered by a slab of this thickness centred on index, clamped to the volume. */
export function slabRange(index: number, count: number, sliceSpacing: number, thicknessMm: number): [number, number] {
  const slices = Math.max(1, Math.round((Number.isFinite(thicknessMm) ? thicknessMm : 0) / (sliceSpacing > 0 ? sliceSpacing : 1)))
  const before = Math.floor((slices - 1) / 2), after = slices - 1 - before
  return [Math.max(0, index - before), Math.min(count - 1, index + after)]
}

export type SlabSlice = VolumeSlice & { slab?: { mode: SlabMode; from: number; to: number; thicknessMm: number } }

/** Caption for a rendered slab, e.g. " · MIP 10.0 mm (5–9)"; empty for a single slice. */
export const slabCaption = (slice: SlabSlice | null) => slice?.slab ? ` · ${SLAB_LABELS[slice.slab.mode]} ${slice.slab.thicknessMm.toFixed(1)} mm (${slice.slab.from + 1}–${slice.slab.to + 1})` : ''

/** Render a windowed slab projection; falls back to the plain slice when the slab covers one slice. */
export function renderSlab(volume: Volume, plane: VolumePlane, index: number, window: { center: number; width: number }, slab: SlabSettings): SlabSlice {
  const base = renderSlice(volume, plane, index, window)
  if (slab.mode === 'none') return base
  const [from, to] = slabRange(index, base.count, base.sliceSpacing, slab.thicknessMm)
  if (from === to) return base
  const { width, height } = base
  const s = [1, volume.dimensions[0], volume.dimensions[0] * volume.dimensions[1]]
  const low = window.center - window.width / 2, scale = 255 / window.width
  const pixels = new Uint8ClampedArray(width * height * 4)
  const n = to - from + 1
  for (let row = 0; row < height; row++) {
    const r = base.flipRow ? height - 1 - row : row
    for (let column = 0; column < width; column++) {
      const c = base.flipColumn ? width - 1 - column : column
      const offset = r * s[base.rowAxis] + c * s[base.columnAxis]
      let value = slab.mode === 'mip' ? -Infinity : slab.mode === 'minip' ? Infinity : 0
      for (let k = from; k <= to; k++) {
        const v = volume.data[offset + k * s[base.axis]]
        if (slab.mode === 'mip') { if (v > value) value = v } else if (slab.mode === 'minip') { if (v < value) value = v } else value += v
      }
      if (slab.mode === 'avg') value /= n
      const out = (row * width + column) * 4
      pixels[out] = pixels[out + 1] = pixels[out + 2] = Math.max(0, Math.min(255, Math.round((value - low) * scale))); pixels[out + 3] = 255
    }
  }
  return { ...base, pixels, slab: { mode: slab.mode, from, to, thicknessMm: n * base.sliceSpacing } }
}
