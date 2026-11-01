import assert from 'node:assert/strict'
import { renderSlice, type Volume } from '../src/lib/volume.ts'
import { findingIssues } from '../src/lib/volumeValidation.ts'
import type { Finding } from '../src/types.ts'
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

// claim checks: outline-measured sizes and supplied sequences pass; model-written ones are still flagged
const grey = new Uint8ClampedArray(64 * 64 * 4).fill(128)
const f = (description: string, measured = true): Finding => ({ id: 'f', title: 'Enhancing tumour, left cerebral hemisphere', description, severity: 'significant', confidence: 0.8,
  location: 'left cerebral hemisphere', ...(measured ? { measurements: { source: 'outline' as const, diameter_mm: 41 } } : {}) })
const has = (issues: string[], word: string) => issues.some((i) => i.includes(word))
equal(has(findingIssues(f('Irregular. Measured from the outline: about 41 mm across on this slice (area 766 mm²).'), grey, 64, 64), 'physical measurement'), false, 'size measured from the outline passes')
equal(has(findingIssues(f('Irregular, about 84 mm across. Measured from the outline: about 41 mm across on this slice.'), grey, 64, 64), 'physical measurement'), true, 'a model-written size is still flagged')
equal(has(findingIssues(f('Irregular, about 41 mm across.', false), grey, 64, 64), 'physical measurement'), true, 'no outline measurements: sizes flagged as before')
equal(has(findingIssues(f('Contrast-enhancing tumour rim on T1 post-contrast.'), grey, 64, 64, { sequence: 'T1 post-contrast' }), 'sequence'), false, 'T1c claim on a T1c volume passes')
equal(has(findingIssues(f('High FLAIR signal around the tumour.'), grey, 64, 64, { sequence: 'T1 post-contrast' }), 'sequence'), true, 'FLAIR claim on a T1c volume is flagged')
equal(has(findingIssues(f('Contrast-enhancing tumour rim.'), grey, 64, 64), 'sequence'), true, 'contrast claim without metadata is flagged as before')

console.log(`skanda slice: ${checks} checks passed`)
