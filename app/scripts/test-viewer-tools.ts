import assert from 'node:assert/strict'
import { OBLIQUE_TOLERANCE, renderSlice, type Volume } from '../src/lib/volume.ts'
import { ellipseStats, measurementsOnSlice, sliceLengthMm, valueUnit, volumeMeasurementText, voxelReadout, type VolumeMeasurement } from '../src/lib/volumeMeasure.ts'
import { renderSlab, slabRange } from '../src/lib/volumeSlab.ts'
import { CT_WINDOW_PRESETS, percentileWindow, volumeWindowPresets } from '../src/lib/volumeWindows.ts'
import { DEFAULT_ORIENTATION, imageToScreen, orientedSize, rotateBy, screenToImage, seriesSiblings, wheelSteps, type ImageOrientation } from '../src/lib/viewerInput.ts'

// 10 × 10 × 5 identity volume, 0.5 × 0.5 mm in-plane and 2 mm slices; each voxel holds 100·z + 10·y + x.
const dims: [number, number, number] = [10, 10, 5]
const data = new Int16Array(500)
for (let z = 0; z < 5; z++) for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) data[x + y * 10 + z * 100] = 100 * z + 10 * y + x
const volume: Volume = { data, dimensions: dims, spacing: [.5, .5, 2], directions: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], origin: [0, 0, 0], space: 'LPS', range: [0, 499], worldBounds: { min: [0, 0, 0], max: [4.5, 4.5, 8] } }

// Window presets: named CT pairs in key order, full range last; non-CT keeps range/percentile presets only.
const ct = volumeWindowPresets('CT', [-1024, 3000])
assert.equal(ct[0].name, 'Lung (1500/-600)')
assert.deepEqual([ct[0].width, ct[0].center], [1500, -600])
assert.ok(CT_WINDOW_PRESETS.some((p) => p.width === 40 && p.center === 40), 'stroke window')
assert.equal(ct.at(-1)!.name, 'Full range')
assert.ok(ct.length <= 9, 'every CT preset reachable by number keys 1–9')
const mr = volumeWindowPresets('MR', [0, 1000], { center: 50, width: 80 })
assert.equal(mr[0].name, 'Auto (1–99th percentile)')
assert.ok(!mr.some((p) => /Lung|Brain/.test(p.name)), 'no HU presets for MR')
const ramp = new Uint16Array(1001).map((_, i) => i)
assert.deepEqual(percentileWindow(ramp, 1, 99), { center: 500, width: 980 })
assert.equal(percentileWindow(new Uint8Array(0)), null)

// Value readout: displayed point → voxel value and LPS mm.
const readout = voxelReadout(volume, 'axial', 3, { x: .25, y: .55 })!
assert.equal(readout.value, 300 + 50 + 2)
assert.deepEqual(readout.voxel, [2, 5, 3])
assert.deepEqual(readout.world, [1, 2.5, 6])
assert.equal(voxelReadout(volume, 'axial', 3, { x: 1.2, y: .5 }), null, 'off the image')
// Coronal display flips rows (superior at top), so the top row is the last axial slice.
assert.equal(voxelReadout(volume, 'coronal', 0, { x: .05, y: .01 })!.value, 400)

// Lengths use in-plane spacing: 10 columns × 0.5 mm = 5 mm; coronal rows use 2 mm slice spacing.
assert.equal(sliceLengthMm(volume, 'axial', { x: 0, y: 0 }, { x: 1, y: 0 }), 5)
assert.equal(sliceLengthMm(volume, 'coronal', { x: 0, y: 0 }, { x: 0, y: 1 }), 10)
assert.equal(Math.round(sliceLengthMm(volume, 'axial', { x: 0, y: 0 }, { x: .6, y: .8 }) * 1000) / 1000, 5)

// Ellipse ROI covering the whole axial slice: pixel centres within the inscribed circle.
const roi = ellipseStats(volume, 'axial', 0, { x: 0, y: 0 }, { x: 1, y: 1 })!
assert.ok(roi.count > 60 && roi.count < 100, `${roi.count} pixels inside`)
assert.equal(roi.mean, 49.5, 'symmetric ROI mean equals the slice mean')
assert.ok(roi.min > 0 && roi.max < 99, 'corners excluded')
assert.equal(Math.round(roi.areaMm2 * 1000) / 1000, Math.round(Math.PI * 2.5 * 2.5 * 1000) / 1000)
// A one-pixel ROI has zero SD; an empty box yields no stats.
const single = ellipseStats(volume, 'axial', 2, { x: .3, y: .4 }, { x: .4, y: .5 })!
assert.deepEqual([single.count, single.mean, single.sd], [1, 243, 0])
assert.equal(ellipseStats(volume, 'axial', 2, { x: .3, y: .4 }, { x: .3, y: .4 }), null)

const length: VolumeMeasurement = { id: 'a', kind: 'length', plane: 'axial', index: 33, a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }
assert.equal(volumeMeasurementText({ ...volume, dimensions: [10, 10, 50], data: new Int16Array(5000) }, length, 'CT'), '0.5 cm (axial 34)')
const ellipse: VolumeMeasurement = { id: 'b', kind: 'ellipse', plane: 'axial', index: 2, a: { x: .3, y: .4 }, b: { x: .4, y: .5 } }
assert.match(volumeMeasurementText(volume, ellipse, 'CT'), /^0\.1 x 0\.1 cm ROI, mean 243, SD 0, min 243, max 243 HU \(unverified\), area 0\.00 cm² \(axial 3\)$/)
assert.equal(valueUnit('MR'), 'units (uncalibrated)')
assert.deepEqual(measurementsOnSlice([length, ellipse], 'axial', 2), [ellipse])

// Slabs: thickness in mm → slice range centred on the index, clamped; projections per pixel.
assert.deepEqual(slabRange(2, 5, 2, 6), [1, 3])
assert.deepEqual(slabRange(0, 5, 2, 6), [0, 1])
assert.deepEqual(slabRange(2, 5, 2, 1), [2, 2])
assert.deepEqual(slabRange(2, 5, 2, 4), [2, 3])
const win = { center: 250, width: 510 } // value v maps to round(v / 2) for 0 ≤ v ≤ 510
const grey = (slice: { pixels: Uint8ClampedArray }, x: number, y: number) => slice.pixels[(x + y * 10) * 4]
const mip = renderSlab(volume, 'axial', 2, win, { mode: 'mip', thicknessMm: 6 })
assert.deepEqual(mip.slab && [mip.slab.from, mip.slab.to, mip.slab.thicknessMm], [1, 3, 6])
assert.equal(grey(mip, 4, 0), Math.round((304 - -5) / 2), 'MIP takes the brightest slice')
assert.equal(grey(renderSlab(volume, 'axial', 2, win, { mode: 'minip', thicknessMm: 6 }), 4, 0), Math.round((104 + 5) / 2))
assert.equal(grey(renderSlab(volume, 'axial', 2, win, { mode: 'avg', thicknessMm: 6 }), 4, 0), Math.round((204 + 5) / 2))
assert.deepEqual(renderSlab(volume, 'axial', 2, win, { mode: 'none', thicknessMm: 6 }).pixels, renderSlice(volume, 'axial', 2, win).pixels)

// Wheel: a mouse notch steps exactly once; trackpad deltas accumulate; reversing drops the remainder.
assert.deepEqual(wheelSteps(0, 120), { steps: 1, remainder: 0 })
assert.deepEqual(wheelSteps(0, -400), { steps: -1, remainder: 0 })
assert.deepEqual(wheelSteps(0, 3, 1), { steps: 1, remainder: 0 }, 'Firefox line mode')
let acc = 0, total = 0
for (let i = 0; i < 20; i++) { const r = wheelSteps(acc, 6); acc = r.remainder; total += r.steps }
assert.equal(total, 4, '120 px of trackpad scroll → 4 steps')
assert.deepEqual(wheelSteps(25, -10), { steps: 0, remainder: -10 })
assert.deepEqual(wheelSteps(5, 0), { steps: 0, remainder: 5 })

// 2D orientation: screenToImage inverts imageToScreen for every rotation/flip.
const orientations: ImageOrientation[] = []
for (const rotate of [0, 90, 180, 270] as const) for (const flipH of [false, true]) for (const flipV of [false, true]) orientations.push({ rotate, flipH, flipV })
for (const o of orientations) {
  const s = imageToScreen(o, .2, .7, 200, 100), back = screenToImage(o, s.x, s.y, 200, 100)
  assert.ok(Math.abs(back.x - .2) < 1e-9 && Math.abs(back.y - .7) < 1e-9, JSON.stringify(o))
}
// Rotating 90° clockwise puts the image's top-left corner at the screen's top-right.
assert.deepEqual(imageToScreen({ rotate: 90, flipH: false, flipV: false }, 0, 0, 200, 100), { x: 50, y: -100 })
assert.deepEqual(imageToScreen({ rotate: 0, flipH: true, flipV: false }, 0, 0, 200, 100), { x: 100, y: -50 })
assert.deepEqual(orientedSize({ ...DEFAULT_ORIENTATION, rotate: 270 }, 200, 100), { w: 100, h: 200 })
assert.equal(rotateBy(DEFAULT_ORIENTATION, -90).rotate, 270)
assert.equal(rotateBy({ ...DEFAULT_ORIENTATION, rotate: 270 }, 90).rotate, 0)

const images = [{ id: 'a', sourceSeriesUid: '1' }, { id: 'b' }, { id: 'c', sourceSeriesUid: '1' }, { id: 'd', sourceSeriesUid: '2' }]
assert.deepEqual(seriesSiblings(images, 'c'), ['a', 'c'])
assert.deepEqual(seriesSiblings(images, 'b'), [])

assert.equal(OBLIQUE_TOLERANCE, 0.99999)
console.log('viewer tools: ok')
