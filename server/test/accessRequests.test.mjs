import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAccessRequest } from '../src/accessRequests.mjs'

const valid = { name: '  Dr Ray ', email: 'Ray@Example.org', organization: 'City Hospital', role: 'Radiologist', useCase: 'Evaluate CT review for our residency teaching files.' }

test('accepts and normalizes a complete request', () => {
  const { value, error } = parseAccessRequest(valid)
  assert.equal(error, undefined)
  assert.equal(value.name, 'Dr Ray')
  assert.equal(value.email, 'ray@example.org')
})

test('flags the honeypot as spam without an error message', () => {
  assert.deepEqual(parseAccessRequest({ ...valid, website: 'http://spam.example' }), { spam: true })
})

test('rejects missing or oversized fields', () => {
  assert.match(parseAccessRequest({ ...valid, name: '' }).error, /name/)
  assert.match(parseAccessRequest({ ...valid, email: 'not-an-email' }).error, /email/)
  assert.match(parseAccessRequest({ ...valid, organization: ' ' }).error, /organization/)
  assert.match(parseAccessRequest({ ...valid, useCase: 'short' }).error, /10 characters/)
  assert.match(parseAccessRequest({ ...valid, useCase: 'x'.repeat(1001) }).error, /1000/)
  assert.match(parseAccessRequest(null).error, /JSON/)
})

test('strips control characters', () => {
  assert.equal(parseAccessRequest({ ...valid, name: 'Dr\u0000 Ray' }).value.name, 'Dr Ray')
})
