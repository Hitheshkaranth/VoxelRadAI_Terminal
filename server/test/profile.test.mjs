import test from 'node:test'
import assert from 'node:assert/strict'
import { parseImage, parseProfile } from '../src/profile.mjs'

const png = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]).toString('base64')
const jpeg = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]).toString('base64')

test('accepts and normalises profile text fields', () => {
  const { value } = parseProfile({ fullName: '  Dr  A   Rao ', centerName: 'City Imaging', centerLocation: 'Udupi, Karnataka', phone: '+91 98' })
  assert.deepEqual(value, { fullName: 'Dr A Rao', centerName: 'City Imaging', centerLocation: 'Udupi, Karnataka', phone: '+91 98' })
  assert.match(parseProfile({ fullName: 'x'.repeat(121) }).error, /120/)
  assert.match(parseProfile({}).error, /Nothing/)
})

test('validates the machine list', () => {
  const { value } = parseProfile({ equipment: [{ modality: 'CT', manufacturer: 'Siemens', model: 'SOMATOM go.Up', year: '2021' }, { modality: 'MRI', manufacturer: '', model: '' }] })
  assert.deepEqual(value.equipment, [{ modality: 'CT', manufacturer: 'Siemens', model: 'SOMATOM go.Up', year: '2021' }])
  assert.match(parseProfile({ equipment: [{ modality: 'PET', manufacturer: 'X' }] }).error, /modality/)
  assert.match(parseProfile({ equipment: [{ modality: 'CT', manufacturer: 'X', year: '21' }] }).error, /year/)
  assert.match(parseProfile({ equipment: Array(21).fill({ modality: 'CT', manufacturer: 'X' }) }).error, /20/)
})

test('accepts only real, small PNG/JPEG/WebP images; null clears', () => {
  assert.equal(parseImage(png, 'Logo').value, png)
  assert.equal(parseImage(jpeg, 'Logo').value, jpeg)
  assert.equal(parseImage(null, 'Logo').value, null)
  assert.equal(parseImage(undefined, 'Logo').value, undefined)
  assert.match(parseImage('data:image/png;base64,' + Buffer.from('<svg/>').toString('base64'), 'Logo').error, /not a valid/)
  assert.match(parseImage('data:image/svg+xml;base64,PHN2Zz4=', 'Logo').error, /PNG, JPEG or WebP/)
  assert.match(parseImage('data:image/png;base64,' + 'A'.repeat(420 * 1024), 'Logo').error, /300 KB/)
  assert.match(parseProfile({ avatar: 'javascript:alert(1)' }).error, /Profile photo/)
})
