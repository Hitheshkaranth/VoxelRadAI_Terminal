import test from 'node:test'
import assert from 'node:assert/strict'
import { MRN_PATTERN, normaliseAadhaar, normaliseAbhaAddress, normaliseAbhaNumber, parsePatient, patientView, verhoeffValid } from '../src/patients.mjs'

// Append the Verhoeff check digit, so tests use well-formed (made-up) Aadhaar numbers.
const withCheck = (body) => { for (let d = 0; d < 10; d++) if (verhoeffValid(body + d)) return body + d }
const AADHAAR = withCheck('23456789012')

test('Aadhaar: 12 digits, no leading 0/1, valid checksum; spaces allowed', () => {
  assert.equal(normaliseAadhaar(AADHAAR), AADHAAR)
  assert.equal(normaliseAadhaar(`${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}`), AADHAAR)
  const wrong = AADHAAR.slice(0, 11) + ((Number(AADHAAR[11]) + 1) % 10)
  assert.equal(normaliseAadhaar(wrong), null)
  assert.equal(normaliseAadhaar('123456789012'), null)
  assert.equal(normaliseAadhaar('2345'), null)
})

test('ABHA number and address formats', () => {
  assert.equal(normaliseAbhaNumber('12345678901234'), '12-3456-7890-1234')
  assert.equal(normaliseAbhaNumber('12-3456-7890-1234'), '12-3456-7890-1234')
  assert.equal(normaliseAbhaNumber('1234'), null)
  assert.equal(normaliseAbhaAddress(' Asha.Rao@ABDM '), 'asha.rao@abdm')
  assert.equal(normaliseAbhaAddress('asha@gmail.com'), null)
  assert.ok(MRN_PATTERN.test('RG-26-000123'))
})

test('parsePatient validates and normalises; partial updates', () => {
  const ok = parsePatient({ name: '  Asha  Rao ', sex: 'F', birthDate: '1980-05-01', phone: '+91 98450 00000', abhaNumber: '12345678901234', aadhaar: AADHAAR })
  assert.deepEqual(ok.value, { name: 'Asha Rao', sex: 'F', birthDate: '1980-05-01', phone: '+91 98450 00000', abhaNumber: '12-3456-7890-1234', aadhaar: AADHAAR })
  assert.match(parsePatient({ name: '' }).error, /name/)
  assert.match(parsePatient({ name: 'A', aadhaar: '234567890123' }).error, /Aadhaar/)
  assert.match(parsePatient({ name: 'A', birthDate: '2999-01-01' }).error, /birth/)
  assert.match(parsePatient({ name: 'A', sex: 'X' }).error, /Sex/)
  assert.deepEqual(parsePatient({ abhaNumber: '' }, { partial: true }).value, { abhaNumber: null })
  assert.match(parsePatient({}, { partial: true }).error, /Nothing/)
})

test('the public view never carries the Aadhaar hash and masks Aadhaar', () => {
  const view = patientView({ id: 'x', mrn: 'RG-26-000001', name: 'A', sex: 'F', phone: '', birth_date: new Date('1980-05-01T00:00:00Z'), aadhaar_hash: 'secret', aadhaar_last4: '1234', created_at: 'now' })
  assert.equal(view.aadhaarMasked, 'XXXX XXXX 1234')
  assert.equal(view.birthDate, '1980-05-01')
  assert.ok(!JSON.stringify(view).includes('secret'))
})
