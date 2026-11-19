// Named display windows for volume slices. CT presets use conventional HU width/level pairs, but the source
// calibration is never verified here, so callers keep the "not verified HU" note beside them.
import type { VoxelData } from './volume.ts'

export interface DisplayWindow { center: number; width: number }
export interface WindowPreset extends DisplayWindow { name: string }

/** Conventional CT width/level pairs, in the order number keys 1–8 apply them. */
export const CT_WINDOW_PRESETS: WindowPreset[] = [
  { name: 'Lung (1500/-600)', width: 1500, center: -600 },
  { name: 'Mediastinum (350/50)', width: 350, center: 50 },
  { name: 'Abdomen soft tissue (400/50)', width: 400, center: 50 },
  { name: 'Liver (150/60)', width: 150, center: 60 },
  { name: 'Brain (80/40)', width: 80, center: 40 },
  { name: 'Subdural (200/75)', width: 200, center: 75 },
  { name: 'Stroke (40/40)', width: 40, center: 40 },
  { name: 'Bone (2000/500)', width: 2000, center: 500 },
]

/** Window spanning the given lower/upper percentiles of a (strided) voxel sample. Robust to background and hot pixels. */
export function percentileWindow(data: VoxelData, low = 1, high = 99, maxSamples = 200_000): DisplayWindow | null {
  if (!data.length) return null
  const stride = Math.max(1, Math.floor(data.length / maxSamples))
  const sample = new Float64Array(Math.ceil(data.length / stride))
  let n = 0
  for (let i = 0; i < data.length; i += stride) sample[n++] = data[i]
  const sorted = sample.subarray(0, n).sort()
  const at = (p: number) => sorted[Math.min(n - 1, Math.max(0, Math.round((p / 100) * (n - 1))))]
  const lo = at(low), hi = at(high)
  return { center: (lo + hi) / 2, width: Math.max(1, hi - lo) }
}

/** Presets for this modality. Non-CT intensities have no standard scale, so only range/percentile presets apply. */
export function volumeWindowPresets(modality: string, range: [number, number], auto?: DisplayWindow | null): WindowPreset[] {
  const full = { name: 'Full range', center: (range[0] + range[1]) / 2, width: Math.max(1, range[1] - range[0]) }
  if (modality.toUpperCase() === 'CT') return [...CT_WINDOW_PRESETS, full]
  return [
    ...(auto ? [{ name: 'Auto (1–99th percentile)', ...auto }] : []),
    full,
    { name: 'Medium display (50% range)', center: full.center, width: Math.max(1, full.width * .5) },
    { name: 'Narrow display (25% range)', center: full.center, width: Math.max(1, full.width * .25) },
  ]
}
