import assert from 'node:assert/strict'
import { findingsReport } from '../src/lib/findingsReport.ts'
import type { Study } from '../src/types.ts'

const study = { images: [
  { name: 'source.png', analysis: { modality: 'X-ray', bodyPart: 'Chest', view: 'PA', findings: [
    { title: 'Reviewed candidate', description: 'Source evidence', review: 'accepted', location: 'Source location' },
    { title: 'Pending candidate', description: 'Unverified evidence', recommendation: 'Unverified suggestion' },
    { title: 'Dismissed candidate', description: 'Do not include this', review: 'dismissed', recommendation: 'Hidden suggestion' },
  ] } },
  { name: 'unread.png' },
] } as unknown as Study
const before = JSON.stringify(study)
const draft = findingsReport(study)
assert.match(draft.findings, /Reviewed finding: Reviewed candidate/)
assert.match(draft.findings, /Possible finding \(not reviewed\): Pending candidate/)
assert.doesNotMatch(draft.findings + draft.impression + draft.recommendations, /Dismissed candidate|Do not include this|Hidden suggestion/)
assert.match(draft.recommendations, /1 image\(s\) have not been analyzed/)
assert.match(draft.recommendations, /without an additional model request/)
assert.equal(JSON.stringify(study), before)

const empty = { images: [{ name: 'source.png', analysis: { modality: 'X-ray', findings: [
  { title: 'Discarded', review: 'dismissed' },
] } }] } as unknown as Study
assert.match(findingsReport(empty).impression, /requires source-image review/)
assert.doesNotMatch(findingsReport(empty).findings, /No acute abnormality/)
assert.throws(() => findingsReport({ images: [] } as unknown as Study), /Analyze at least one image/)
console.log('Findings draft: review labels, dismissed evidence, incomplete coverage, no false normal conclusion and immutable source passed')
