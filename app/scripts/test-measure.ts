import assert from 'node:assert/strict'
import { formatLength, measuredAngle, measuredLength, measurementText, spacingNote, validMeasurement } from '../src/lib/measure.ts'
import { createDicomFrameDecoder, parseSpacing } from '../src/lib/dicomIntake.ts'
import { validateTransferredStudy } from '../src/lib/studyTransfer.ts'

// Downscaled display image (1000 wide) of a 2000 × 1000 source with 0.2 × 0.1 mm pixels (row, column).
const image = { width: 1000, height: 500, sourceColumns: 2000, sourceRows: 1000, pixelSpacing: { row: 0.2, col: 0.1, source: 'pixel' as const } }
assert.deepEqual(measuredLength(image, { x: 0, y: 0 }, { x: 0.5, y: 0 }), { value: 100, unit: 'mm' }, 'horizontal uses column spacing')
assert.deepEqual(measuredLength(image, { x: 0, y: 0 }, { x: 0, y: 0.5 }), { value: 100, unit: 'mm' }, 'vertical uses row spacing')
assert.equal(Math.round(measuredLength(image, { x: 0, y: 0 }, { x: 0.3, y: 0.2 }).value * 1000) / 1000, Math.round(Math.hypot(60, 40) * 1000) / 1000)
// Without spacing, lengths are in source pixels and labelled as such.
const raster = { width: 1000, height: 500, sourceColumns: 4000, sourceRows: 2000 }
assert.deepEqual(measuredLength(raster, { x: 0, y: 0 }, { x: 0.25, y: 0 }), { value: 1000, unit: 'px' })
assert.equal(measuredLength({ width: 100, height: 50 }, { x: 0, y: 0 }, { x: 1, y: 0 }).value, 100, 'falls back to the stored grid')
assert.equal(formatLength(12.34, 'mm'), '12.3 mm')
assert.equal(formatLength(123.4, 'mm'), '12.3 cm')
assert.equal(formatLength(99.6, 'px'), '100 px')
// Angles: right angle on a square physical grid; anisotropic spacing changes the apparent angle.
const square = { width: 100, height: 100 }
assert.equal(Math.round(measuredAngle(square, { x: 1, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0 })), 90)
assert.equal(Math.round(measuredAngle(square, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })), 45)
assert.equal(Math.round(measuredAngle({ ...square, pixelSpacing: { row: 2, col: 1, source: 'pixel' } }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })), 63)
assert.equal(measuredAngle(square, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }), 0, 'degenerate arm')
assert.equal(measurementText(square, { id: 'a', kind: 'angle', createdAt: 1, points: [{ x: 1, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0 }] }), '90.0°')
assert.match(spacingNote(raster), /pixels/)
assert.match(spacingNote({ ...square, pixelSpacing: { row: 1, col: 1, source: 'imager' } }), /magnification/)
assert.equal(validMeasurement({ id: 'a', kind: 'length', createdAt: 1, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }), true)
assert.equal(validMeasurement({ id: 'a', kind: 'length', createdAt: 1, points: [{ x: 0, y: 0 }, { x: 2, y: 1 }] }), false)
assert.equal(validMeasurement({ id: 'a', kind: 'angle', createdAt: 1, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }), false)

// DICOM spacing: Pixel Spacing wins, Imager Pixel Spacing is the fallback, malformed values are ignored.
assert.deepEqual(parseSpacing('0.139\\0.143'), { row: 0.139, col: 0.143 })
for (const bad of [undefined, '', '0.1', '0\\0.1', '-1\\1', 'a\\b', '11\\1', '0.1\\0.1\\0.1']) assert.equal(parseSpacing(bad), undefined, String(bad))
function element(group: number, tag: number, value: Buffer) {
  const header = Buffer.alloc(8)
  header.writeUInt16LE(group); header.writeUInt16LE(tag, 2); header.writeUInt32LE(value.length, 4)
  return Buffer.concat([header, value])
}
const text = (value: string) => Buffer.from(value.length % 2 ? `${value} ` : value)
const us = (value: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b }
const dicom = (spacing: Buffer[]) => Buffer.concat([
  element(0x0008, 0x0060, text('DX')),
  ...spacing.filter((e) => e.readUInt16LE(0) === 0x0018),
  element(0x0028, 0x0002, us(1)), element(0x0028, 0x0004, text('MONOCHROME2')),
  element(0x0028, 0x0010, us(2)), element(0x0028, 0x0011, us(3)),
  ...spacing.filter((e) => e.readUInt16LE(0) === 0x0028),
  element(0x0028, 0x0100, us(8)), element(0x0028, 0x0101, us(8)),
  element(0x7fe0, 0x0010, Buffer.alloc(6)),
])
const pixel = element(0x0028, 0x0030, text('0.2\\0.1')), imager = element(0x0018, 0x1164, text('0.15\\0.15'))
const both = createDicomFrameDecoder(dicom([imager, pixel])).decode(0)
assert.deepEqual(both.pixelSpacing, { row: 0.2, col: 0.1, source: 'pixel' })
assert.equal(both.sourceRows, 2); assert.equal(both.sourceColumns, 3)
assert.deepEqual(createDicomFrameDecoder(dicom([imager])).decode(0).pixelSpacing, { row: 0.15, col: 0.15, source: 'imager' })
assert.equal(createDicomFrameDecoder(dicom([])).decode(0).pixelSpacing, undefined, 'no spacing is never invented')

// Imported studies keep valid measurements and reject malformed ones.
const study = { id: '01234567-1234-1234-1234-123456789abc', title: 'Measure fixture', createdAt: 1, updatedAt: 2, patient: { name: '', patientId: '', age: '', sex: '', studyDate: '', referringPhysician: '', indication: '', clinicalHistory: '' }, images: [{ id: 'image', name: 'image.dcm', mime: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,aA==', width: 1, height: 1, addedAt: 1, status: 'idle', sourceRows: 4, sourceColumns: 4, pixelSpacing: { row: 0.2, col: 0.2, source: 'pixel' }, measurements: [{ id: 'm', kind: 'length', createdAt: 1, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }] }] }
assert.equal(validateTransferredStudy(study).images[0].measurements?.length, 1)
assert.throws(() => validateTransferredStudy({ ...study, images: [{ ...study.images[0], measurements: [{ id: 'm', kind: 'length', createdAt: 1, points: [{ x: 0, y: 0 }] }] }] }))
assert.throws(() => validateTransferredStudy({ ...study, images: [{ ...study.images[0], pixelSpacing: { row: 0, col: 1, source: 'pixel' } }] }))
console.log('measure: ok')
