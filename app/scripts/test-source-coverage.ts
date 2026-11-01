import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decodeNrrd } from '../src/lib/volume.ts'
import { sourceEdgeCoverage } from '../src/lib/volumeCoverage.ts'
const bytes = readFileSync(new URL('../public/samples/ct-brain.nrrd', import.meta.url))
const volume = await decodeNrrd(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
assert.deepEqual(sourceEdgeCoverage(volume,'axial',3), { rows:352,value:-3000,edge:'lower',totalRows:507 })
assert.equal(sourceEdgeCoverage(volume,'axial',38),null)
console.log('Source coverage: 2 checks passed (real CT source rows, middle slice)')
