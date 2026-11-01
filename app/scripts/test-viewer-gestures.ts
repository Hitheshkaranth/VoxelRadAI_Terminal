import assert from 'node:assert/strict'
import { pinchTransform, touchGeometry } from '../src/components/viewer/gestures.ts'

const anchor = { ...touchGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }), view: { zoom: 1, panX: 0, panY: 0 } }
const zoomed = pinchTransform(anchor, { x: -50, y: 0 }, { x: 150, y: 0 })
assert.equal(zoomed.zoom, 2)
assert.equal(zoomed.panX, -50, 'The image point under the initial centroid stays anchored')
assert.equal(zoomed.panY, 0)
const moved = pinchTransform(anchor, { x: 20, y: 30 }, { x: 120, y: 30 })
assert.deepEqual(moved, { zoom: 1, panX: 20, panY: 30 }, 'Two fingers can translate without zooming')
const capped = pinchTransform(anchor, { x: -5000, y: 0 }, { x: 5000, y: 0 })
assert.equal(capped.zoom, 8)
assert.equal(capped.panX, -400, 'Pan uses the capped scale, preventing a jump at zoom limits')
const minimum = pinchTransform(anchor, { x: 49, y: 0 }, { x: 51, y: 0 })
assert.equal(minimum.zoom, 0.5)
const coincident = touchGeometry({ x: 7, y: 9 }, { x: 7, y: 9 })
assert.equal(coincident.distance, 1, 'Coincident touch points cannot divide by zero')
const offset = pinchTransform({ ...anchor, view: { zoom: 2, panX: 30, panY: -20 } }, { x: -50, y: 10 }, { x: 150, y: 10 })
assert.deepEqual(offset, { zoom: 4, panX: 10, panY: -30 }, 'Pinching preserves an already-panned image position')
console.log('Viewer gestures: 9 assertions passed')
