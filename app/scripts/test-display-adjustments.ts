import assert from 'node:assert/strict'
import { clampZoom, clampSliceIndex, adjustWindowLevel } from '../src/components/viewer/displayAdjustments.ts'

assert.equal(clampZoom(.1), .5)
assert.equal(clampZoom(16), 8)
assert.equal(clampZoom(1.25), 1.25)
assert.equal(clampZoom(NaN), 1)
assert.equal(clampZoom(Infinity), 1)
assert.equal(clampSliceIndex(-1, 256), 0)
assert.equal(clampSliceIndex(256, 256), 255)
assert.equal(clampSliceIndex(128.7, 256), 129)
assert.equal(clampSliceIndex(NaN, 256), 0)
assert.equal(clampSliceIndex(4, 1), 0)
assert.equal(clampSliceIndex(4, 0), 0)
assert.equal(adjustWindowLevel(40, 400, true), 20)
assert.equal(adjustWindowLevel(40, 400, false), 60)
assert.equal(adjustWindowLevel(0, 0, true), -1)
assert.equal(Number.isFinite(adjustWindowLevel(NaN, Infinity, true)), true)
let zoom = 1
for (let step = 0; step < 40; step++) zoom = clampZoom(zoom * 1.25)
assert.equal(zoom, 8)
for (let step = 0; step < 40; step++) zoom = clampZoom(zoom / 1.25)
assert.equal(zoom, .5)
console.log('Display controls: zoom bounds, slice endpoints, invalid values and window brightness direction passed')
