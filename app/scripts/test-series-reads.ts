import assert from 'node:assert/strict'
import { splitSeriesAnalysis, volumeCoverage } from '../src/lib/volumeAnalysis.ts'
import { normalizeAnalysis } from '../src/lib/parse.ts'

// A Skanda-V2 whole-series CT reply: findings carry 0-based sliceIndex / sliceRange (skanda-v2 skanda/v2/ct_series.py).
const reply = {
  modality: 'CT', bodyPart: 'Abdomen', view: 'axial', imageQuality: 'Read as a series of 10 slices.', series: true,
  findings: [
    { title: 'Liver lesion, right', description: 'Measured from the scan: long axis 59.0 mm.', severity: 'moderate', location: 'liver patient right', box_2d: [100, 100, 300, 300], sliceIndex: 7, sliceRange: [5, 9] },
    { title: 'Liver lesion, right', description: 'Second lesion.', severity: 'moderate', location: 'liver patient right', box_2d: [400, 400, 500, 500], sliceIndex: 7 },
    { title: 'Kidney lesion, left', description: 'x', severity: 'moderate', location: 'kidney', box_2d: [10, 10, 20, 20], sliceIndex: 2, sliceRange: [9, 3] },
    { title: 'No slice', description: 'x', severity: 'minor', location: '', box_2d: [10, 10, 20, 20] },
    { title: 'Out of range', description: 'x', severity: 'minor', location: '', box_2d: [10, 10, 20, 20], sliceIndex: 99 },
  ],
  pertinentNegatives: ['No free fluid.'], impression: '3 focal lesions.', recommendations: [], differential: [],
}
const a = normalizeAnalysis(reply, { rawText: JSON.stringify(reply), model: 'skanda-v2', durationMs: 5000, truncated: false })
assert.equal(a.findings[0].sliceIndex, 7)
assert.deepEqual(a.findings[0].sliceRange, [5, 9])
assert.equal(a.findings[2].sliceRange, undefined, 'reversed range dropped')
assert.equal(a.findings[3].sliceIndex, undefined)

const reads = splitSeriesAnalysis(a, 10, 5)
assert.equal(reads.length, 10)
assert.deepEqual(reads.map((r) => r.index), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
assert.equal(volumeCoverage(reads, 10).complete, true, 'a whole-series read covers every slice')
assert.deepEqual(reads[7].analysis!.findings.map((f) => f.description), ['Measured from the scan: long axis 59.0 mm.', 'Second lesion.'])
assert.deepEqual(reads[2].analysis!.findings.map((f) => f.title), ['Kidney lesion, left'])
// no usable sliceIndex (missing / out of range) -> the key slice the request was made from
assert.deepEqual(reads[5].analysis!.findings.map((f) => f.title), ['No slice', 'Out of range'])
// impression and stated negatives only once, on the key slice
assert.equal(reads[5].analysis!.impression, '3 focal lesions.')
assert.deepEqual(reads[5].analysis!.pertinentNegatives, ['No free fluid.'])
assert.deepEqual(reads[0].analysis!.pertinentNegatives, [])
assert.equal(reads[0].analysis!.findings.length, 0)
assert.match(reads[0].analysis!.impression, /whole series/)
// boxes stay on the finding (drawn on its own slice)
assert.ok(reads[7].analysis!.findings[0].bbox)
// key index is clamped
assert.equal(splitSeriesAnalysis(a, 4, 99).filter((r) => r.analysis!.impression === '3 focal lesions.')[0].index, 3)
console.log('series reads: ok')
