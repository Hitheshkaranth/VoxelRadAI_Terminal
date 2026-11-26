import assert from 'node:assert/strict'
import { nextPendingFinding, pendingCount, reviewOrder } from '../src/lib/findingReview.ts'
import type { Finding, FindingReview, Severity } from '../src/types.ts'

const f = (id: string, severity: Severity, review?: FindingReview): Finding => ({ id, title: id, description: '', severity, confidence: 0.5, location: '', category: 'Lungs', review })

// Model order a(minor) b(critical) c(normal) d(significant) e(critical) → panel order b, e, d, a; normal excluded.
const list = [f('a', 'minor'), f('b', 'critical'), f('c', 'normal'), f('d', 'significant'), f('e', 'critical')]
assert.deepEqual(reviewOrder(list), ['b', 'e', 'd', 'a'])
assert.equal(pendingCount(list), 4)

// No selection: J starts at the top, K at the bottom.
assert.equal(nextPendingFinding(list, null, 1), 'b')
assert.equal(nextPendingFinding(list, null, -1), 'a')
// Steps in panel order and wraps.
assert.equal(nextPendingFinding(list, 'b', 1), 'e')
assert.equal(nextPendingFinding(list, 'a', 1), 'b')
assert.equal(nextPendingFinding(list, 'b', -1), 'a')

// Reviewed findings are skipped, including when the current one was just decided.
const partly = [f('a', 'minor'), f('b', 'critical', 'accepted'), f('c', 'normal'), f('d', 'significant', 'dismissed'), f('e', 'critical')]
assert.equal(nextPendingFinding(partly, 'b', 1), 'e')
assert.equal(nextPendingFinding(partly, 'e', 1), 'a')
assert.equal(nextPendingFinding(partly, 'e', -1), 'a')
// A selected normal finding (not in the review order) starts from the top.
assert.equal(nextPendingFinding(partly, 'c', 1), 'e')

// Only the current finding pending → stays; nothing pending → null.
assert.equal(nextPendingFinding([f('x', 'minor'), f('y', 'minor', 'accepted')], 'x', 1), 'x')
assert.equal(nextPendingFinding([f('x', 'minor', 'accepted'), f('n', 'normal')], 'x', 1), null)
assert.equal(nextPendingFinding([], null, 1), null)

console.log('Finding review order: 15 checks passed')
