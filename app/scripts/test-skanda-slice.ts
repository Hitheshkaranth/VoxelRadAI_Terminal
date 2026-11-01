import assert from 'node:assert/strict'
import { renderSlice, type Volume } from '../src/lib/volume.ts'
import { positivePercentiles, skandaSliceInput, sliceValues, SKANDA_CT_WINDOWS } from '../src/lib/skandaSlice.ts'

let checks = 0
const equal = (actual: unknown, expected: unknown, description: string) => { assert.deepEqual(actual, expected, description); checks++ }

// 4 (x: patient right → left) × 3 (y: anterior → posterior) × 2 slices, LPS identity directions, 0.7 × 0.9 mm pixels
const dims: [number, number, number] = [4, 3, 2]
const data = new Int16Array(24)
for (let z = 0; z < 2; z++) for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) data[x + 4 * y + 12 * z] = 100 * z + 10 * y + x
const volume: Volume = { data, dimensions: dims, spacing: [0.7, 0.9, 5], directions: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], origin: [0, 0, 0],
  space: 'LPS', range: [0, 123], worldBounds: { min: [0, 0, 0], max: [2.1, 1.8, 5] } }

const s = sliceValues(volume, 'axial', 1)
equal([s.width, s.height], [4, 3], 'axial slice is columns × rows of the acquired grid (no resampling)')
equal(s.values[0], 100, 'top-left pixel = patient right, anterior (as in Skanda training: image left = patient right)')
equal(s.values[3], 103, 'top-right pixel = patient left, anterior')
equal(s.values[8], 120, 'bottom-left pixel = patient right, posterior')
equal(s.pixelSpacing, [0.7, 0.9], 'pixel spacing is [column mm, row mm]')
const shown = renderSlice(volume, 'axial', 1, { center: 61.5, width: 123 })
equal(Array.from({ length: 12 }, (_, i) => shown.pixels[i * 4]), Array.from(s.values, (v) => Math.max(0, Math.min(255, Math.round((v - 0) * 255 / 123)))),
  'raw values follow the displayed slice pixel for pixel')

equal(positivePercentiles(volume), [1, 123], 'MRI normalisation: [1, 99] percentiles of positive voxels')
equal(SKANDA_CT_WINDOWS, [[-1350, 150], [-160, 240], [-500, 1300]], 'CT windows match skanda-grounding build_msd.CT_WINDOWS')

equal(skandaSliceInput(volume, 'coronal', 0, { modality: 'CT', title: 'x' }).input, null, 'non-axial planes are refused (Skanda trained on axial)')
equal(/axial/.test(skandaSliceInput(volume, 'coronal', 0, { modality: 'CT', title: 'x' }).reason ?? ''), true, 'with the reason')
equal(skandaSliceInput(volume, 'axial', 0, { modality: 'Volume', title: 'x' }).input, null, 'unknown modality is refused')

console.log(`skanda slice: ${checks} checks passed`)
