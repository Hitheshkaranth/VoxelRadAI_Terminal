import dicomParser from 'dicom-parser'
import { dicomPixelsToGray } from './dicomPixels.ts'

/** First value of a (possibly multi-valued, backslash-separated) numeric string element. */
function readNum(ds: dicomParser.DataSet, tag: string): number | undefined {
  const s = ds.string(tag)
  if (s == null) return undefined
  const n = parseFloat(s.split('\\')[0])
  return Number.isFinite(n) ? n : undefined
}

/** Row and column spacing in mm; Pixel Spacing wins over the detector-plane Imager Pixel Spacing. */
export function parseSpacing(text: string | undefined): { row: number; col: number } | undefined {
  if (!text) return undefined
  const parts = text.split('\\').map((value) => Number(value.trim()))
  if (parts.length !== 2 || !parts.every((value) => Number.isFinite(value) && value > 0 && value <= 10)) return undefined
  return { row: parts[0], col: parts[1] }
}

function readSpacing(ds: dicomParser.DataSet): { row: number; col: number; source: 'pixel' | 'imager' } | undefined {
  const pixel = parseSpacing(ds.string('x00280030'))
  if (pixel) return { ...pixel, source: 'pixel' }
  const imager = parseSpacing(ds.string('x00181164'))
  return imager ? { ...imager, source: 'imager' } : undefined
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

/** Parse once, then decode any frame of a supported monochrome image stack. */
export function createDicomFrameDecoder(bytes: Uint8Array) {
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
  const frameText = ds.string('x00280008')?.trim()
  if (frameText !== undefined && !/^\d+$/.test(frameText)) throw new Error('The DICOM frame count is invalid.')
  const frames = frameText === undefined ? 1 : Number(frameText)
  if (!Number.isSafeInteger(frames) || frames < 1) throw new Error('The DICOM frame count is invalid.')
  if (frames > 500 || rows * cols * frames > 64 * 1024 * 1024) throw new Error('This DICOM stack is too large for image intake (500 frames or 64 million pixels maximum). Export a smaller stack or use a scalar NRRD volume.')
  if (ds.elements.x52009229 || ds.elements.x52009230) throw new Error('Enhanced DICOM functional groups are not supported. Export a conventional image stack or scalar NRRD volume to preserve acquisition geometry.')

  const start = pixelEl.dataOffset
  const len = pixelEl.length !== 0xffffffff ? pixelEl.length : ds.byteArray.length - start
  const frameBytes = rows * cols * (bitsAllocated / 8)
  if (len < frameBytes * frames || start + frameBytes * frames > ds.byteArray.length) throw new Error('The DICOM pixel data is truncated.')
  const spacing = readSpacing(ds)
  const photo = (ds.string('x00280004') ?? 'MONOCHROME2').trim()
  if (!['MONOCHROME1', 'MONOCHROME2'].includes(photo)) throw new Error('Only MONOCHROME1 and MONOCHROME2 DICOM images are supported.')
  return { frameCount: frames, decode(frameIndex = 0) {
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= frames) throw new Error('DICOM frame index is outside the source stack.')
  const raw = new Uint8Array(ds.byteArray.buffer, ds.byteArray.byteOffset + start + frameIndex * frameBytes, frameBytes)

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
    mono1: photo === 'MONOCHROME1',
  })
  const uid = (tag: string) => { const value = ds.string(tag)?.trim(); return value && value.length <= 64 && /^\d+(?:\.\d+)*$/.test(value) ? value : undefined }
  return { gray, rows, cols, sourceModality: ds.string('x00080060')?.trim().toUpperCase() || undefined, sourceBodyPart: ds.string('x00180015')?.trim().toUpperCase() || undefined, sourceFrameCount: frames, sourceFrameIndex: frameIndex, sourceSeriesUid: uid('x0020000e'), sourceSopInstanceUid: uid('x00080018'), sourceRows: rows, sourceColumns: cols, ...(spacing ? { pixelSpacing: spacing } : {}) }
  } }
}

/** Decode a selected uncompressed DICOM frame and preserve source metadata. */
export function decodeDicomFrame(bytes: Uint8Array, frameIndex = 0) {
  return createDicomFrameDecoder(bytes).decode(frameIndex)
}
