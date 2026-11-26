import assert from 'node:assert/strict'
import { sliceKeyTarget } from '../src/components/viewer/readingControls.ts'

let n = 0
const eq = (a: unknown, b: unknown, m = 'mismatch') => { assert.equal(a, b, m); n++ }
// 76-slice CT, on slice index 38.
eq(sliceKeyTarget('ArrowDown', 38, 76), 39); eq(sliceKeyTarget('ArrowRight', 38, 76), 39)
eq(sliceKeyTarget('ArrowUp', 38, 76), 37); eq(sliceKeyTarget('ArrowLeft', 38, 76), 37)
eq(sliceKeyTarget('ArrowDown', 38, 76, true), 43, 'Shift steps 5')
eq(sliceKeyTarget('PageDown', 38, 76), 46, 'a tenth of 76 ≈ 8'); eq(sliceKeyTarget('PageUp', 38, 76), 30)
eq(sliceKeyTarget('Home', 38, 76), 0); eq(sliceKeyTarget('End', 38, 76), 75)
// Clamped at both ends; tiny stacks page by at least one.
eq(sliceKeyTarget('ArrowUp', 0, 76), 0); eq(sliceKeyTarget('ArrowDown', 75, 76), 75)
eq(sliceKeyTarget('PageDown', 74, 76), 75); eq(sliceKeyTarget('PageDown', 0, 3), 1)
eq(sliceKeyTarget('End', 0, 1), 0)
// Other keys are not slice keys.
eq(sliceKeyTarget('a', 10, 76), null); eq(sliceKeyTarget(' ', 10, 76), null)
console.log(`Slice keys: ${n} checks passed`)
