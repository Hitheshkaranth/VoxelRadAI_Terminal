import dicomParser from 'dicom-parser'
import { dicomPixelsToGray } from './dicomPixels.ts'

/** First value of a (possibly multi-valued, backslash-separated) numeric string element. */
function readNum(ds: dicomParser.DataSet, tag: string): number | undefined {
  const s = ds.string(tag)
  if (s == null) return undefined
  const n = parseFloat(s.split('\\')[0])
  return Number.isFinite(n) ? n : undefined
}

const IMPLICIT_LE = '1.2.840.10008.1.2'
const UNCOMPRESSED = new Set([IMPLICIT_LE, '1.2.840.10008.1.2.1', '1.2.840.10008.1.2.2'])

function parseDicomBytes(bytes: Uint8Array): dicomParser.DataSet {
  try {
    return dicomParser.parseDicom(bytes)
  } catch {
    // Files without the 128-byte preamble + DICM prefix (raw implicit-VR little-endian datasets).
    try {
      return dicomParser.parseDicom(bytes, { TransferSyntaxUID: IMPLICIT_LE })
    } catch {
      throw new Error('Could not parse the DICOM header.')
    }
  }
}

/** Decode the first uncompressed DICOM frame and preserve source metadata. */
export function decodeDicomFrame(bytes: Uint8Array) {
  const ds = parseDicomBytes(bytes)
  const transferSyntax = (ds.string('x00020010') ?? '').trim()
  const pixelEl = ds.elements['x7fe00010']
  if (pixelEl?.encapsulatedPixelData || (transferSyntax && !UNCOMPRESSED.has(transferSyntax))) {
    throw new Error(`Compressed DICOM (transfer syntax ${transferSyntax || 'encapsulated'}) is not supported; export as uncompressed DICOM or PNG.`)
  }
  if (!pixelEl || pixelEl.dataOffset == null || !pixelEl.length) throw new Error('The DICOM file has no usable pixel data.')

  const rows = ds.uint16('x00280010')
  const cols = ds.uint16('x00280011')
  if (!rows || !cols || rows < 1 || cols < 1) throw new Error('The DICOM file is missing valid dimensions.')
  const samplesPerPixel = ds.uint16('x00280002') ?? 1
  if (samplesPerPixel !== 1) throw new Error('Only single-channel (monochrome) DICOM is supported; export colour images as PNG.')
  const bitsAllocated = ds.uint16('x00280100') ?? 8
  if (bitsAllocated !== 8 && bitsAllocated !== 16) {
    throw new Error(`${bitsAllocated}-bit DICOM pixel data is not supported (8 or 16 bits only); export as PNG.`)
  }
  const bitsStored = ds.uint16('x00280101') ?? bitsAllocated
  const frames = Math.max(1, Math.round(readNum(ds, 'x00280008') ?? 1))

  const start = pixelEl.dataOffset
  const len = pixelEl.length !== 0xffffffff ? pixelEl.length : ds.byteArray.length - start
  const frameBytes = rows * cols * (bitsAllocated / 8)
  if (len < frameBytes || start + frameBytes > ds.byteArray.length) throw new Error('The DICOM pixel data is truncated.')
  const raw = new Uint8Array(ds.byteArray.buffer, ds.byteArray.byteOffset + start, frameBytes)

  const gray = dicomPixelsToGray(raw, {
    rows,
    cols,
    bitsAllocated,
    bitsStored,
    pixelRepresentation: ds.uint16('x00280103') === 1 ? 1 : 0,
    bigEndian: ds.byteArrayParser === dicomParser.bigEndianByteArrayParser,
    slope: readNum(ds, 'x00281053') ?? 1,
    intercept: readNum(ds, 'x00281052') ?? 0,
    windowCenter: readNum(ds, 'x00281050'),
    windowWidth: readNum(ds, 'x00281051'),
    mono1: (ds.string('x00280004') ?? '').trim() === 'MONOCHROME1',
  })
  return { gray, rows, cols, sourceModality: ds.string('x00080060')?.trim().toUpperCase() || undefined, sourceBodyPart: ds.string('x00180015')?.trim().toUpperCase() || undefined, sourceFrameCount: frames }
}
