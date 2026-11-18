import test from 'node:test'
import assert from 'node:assert/strict'
import { validTemplate } from '../src/reportTemplates.mjs'
const base = () => ({ name: 'Default', header: { institution: 'Skanda Imaging', department: 'Radiology', lines: ['12 MG Road, Bengaluru'], align: 'left' },
  footer: { text: 'Reported by consultant radiologist', showPageNumbers: true, showDisclaimer: true }, sectionTitles: { impression: 'Conclusion' } })
test('accepts a plain-text template with a raster logo', () => {
  assert.ok(validTemplate(base()))
  assert.ok(validTemplate({ ...base(), header: { ...base().header, logoDataUrl: 'data:image/png;base64,iVBORw0KGgo=' } }))
})
test('rejects markup-capable or unknown content', () => {
  assert.ok(!validTemplate({ ...base(), header: { ...base().header, logoDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' } }))
  assert.ok(!validTemplate({ ...base(), html: '<script>' }))
  assert.ok(!validTemplate({ ...base(), sectionTitles: { other: 'x' } }))
  assert.ok(!validTemplate({ ...base(), name: '  ' }))
  assert.ok(!validTemplate({ ...base(), header: { ...base().header, lines: Array(7).fill('x') } }))
  assert.ok(!validTemplate({ ...base(), footer: { ...base().footer, showPageNumbers: 'yes' } }))
})
