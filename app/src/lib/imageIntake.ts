// OWNER: Agent 2 (Viewer & intake). Standard + DICOM image intake.
import { uid } from '../store'
import type { StudyImage } from '../types'
import dicomParser from 'dicom-parser'

export const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp,image/bmp,image/gif,.dcm,application/dicom'

const MAX_EDGE = 1536

function toStudyImage(file: File, width: number, height: number, mime = 'image/jpeg'): StudyImage {
  return {
    id: uid(),
    name: file.name,
    mime,
    dataUrl: '',
    width,
    height,
    addedAt: Date.now(),
    status: 'idle',
  }
}

async function decodeStandardImage(file: File): Promise<StudyImage> {
  const bitmap = await createImageBitmap(file)
  const naturalW = bitmap.width
  const naturalH = bitmap.height
  const scale = Math.min(1, MAX_EDGE / Math.max(naturalW, naturalH))
  const w = Math.max(1, Math.round(naturalW * scale))
  const h = Math.max(1, Math.round(naturalH * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    await bitmap.close()
    throw new Error('Canvas 2D is not supported in this browser.')
  }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  await bitmap.close()
  const img = toStudyImage(file, w, h)
  img.dataUrl = canvas.toDataURL('image/jpeg', 0.92)
  return img
}

async function isDicomFile(file: File): Promise<boolean> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.dcm')) return true
  if (file.type === 'application/dicom') return true
  try {
    const bytes = new Uint8Array(await file.slice(128, 132).arrayBuffer())
    if (bytes.length !== 4) return false
    return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'DICM'
  } catch {
    return false
  }
}

function readNum(ds: dicomParser.DataSet, tag: string): number | undefined {
  const s = ds.string(tag)
  if (s == null) return undefined
  const n = parseFloat(s)
  return Number.isNaN(n) ? undefined : n
}

function decodeDicom(file: File): Promise<StudyImage> {
  return new Promise((resolve, reject) => {
    file.arrayBuffer()
      .then((buf) => new Uint8Array(buf))
      .then(async (bytes) => {
        let ds: dicomParser.DataSet
        try {
          ds = dicomParser.parseDicom(bytes)
        } catch (e) {
          reject(new Error('Could not parse the DICOM header.'))
          return
        }
        const pixelEl = ds.elements['7fe00010']
        if (!pixelEl || pixelEl.dataOffset == null || !pixelEl.length) {
          reject(new Error('The DICOM file has no usable pixel data.'))
          return
        }
        if (pixelEl.encapsulatedPixelData) {
          reject(new Error('Compressed (encapsulated) DICOM is not supported; only uncompressed 8/16-bit monochrome images.'))
          return
        }
        const transferSyntax = ds.string('00020010') ?? ''
        if (transferSyntax.startsWith('1.2.840.10008.1.2.4') || transferSyntax === '1.2.840.10008.1.2.5') {
          reject(new Error('Compressed DICOM transfer syntax is not supported.'))
          return
        }
        const rows = ds.uint16('00280010')
        const cols = ds.uint16('00280011')
        if (!rows || !cols || rows < 1 || cols < 1) {
          reject(new Error('The DICOM file is missing valid dimensions.'))
          return
        }
        const samplesPerPixel = ds.uint16('00280002') ?? 1
        if (samplesPerPixel !== 1) {
          reject(new Error('Only single-channel (monochrome) DICOM is supported.'))
          return
        }
        const bitsAllocated = ds.uint16('00280100') ?? 8
        const pixelRepresentation = ds.uint16('00280001') ?? 0
        const isBigEndian = ds.byteArrayParser === dicomParser.bigEndianByteArrayParser

        const start = pixelEl.dataOffset
        const len = pixelEl.length && pixelEl.length !== 0xffffffff ? pixelEl.length : ds.byteArray.length - start
        let raw: Uint8Array
        try {
          raw = new Uint8Array(dicomParser.sharedCopy(ds.byteArray, start, Math.floor(len)))
        } catch {
          reject(new Error('Could not read the DICOM pixel bytes.'))
          return
        }
        if (raw.length < cols * rows * (bitsAllocated / 8)) {
          reject(new Error('The DICOM pixel data is truncated.'))
          return
        }

        const slope = readNum(ds, '3006009a') ?? 1
        const intercept = readNum(ds, '3006009b') ?? 0
        const wc = readNum(ds, '00281052')
        const ww = readNum(ds, '00281053')
        const mono1 = ds.string('00280004') === 'MONOCHROME1'

        const n = rows * cols
        const isLE = !isBigEndian
        const samples = new Float32Array(n)
        let min = Infinity
        let max = -Infinity
        for (let i = 0; i < n; i++) {
          let rawValue = 0
          if (bitsAllocated <= 8) {
            rawValue = raw[i]
            if (pixelRepresentation === 1 && (rawValue & 0x80)) rawValue -= 256
          } else {
            const o = i * 2
            const lo = raw[o]
            const hi = raw[o + 1]
            rawValue = isLE ? (hi << 8) | lo : (lo << 8) | hi
            if (pixelRepresentation === 1 && (rawValue & 0x8000)) rawValue -= 65536
          }
          const value = rawValue * slope + intercept
          samples[i] = value
          if (value < min) min = value
          if (value > max) max = value
        }

        let loBound: number
        let hiBound: number
        if (ww && ww > 0 && wc != null) {
          loBound = wc - ww / 2
          hiBound = wc + ww / 2
        } else {
          loBound = min
          hiBound = max
        }
        const span = hiBound - loBound || 1

        const canvas = document.createElement('canvas')
        canvas.width = cols
        canvas.height = rows
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas 2D is not supported in this browser.'))
          return
        }
        const imgData = ctx.createImageData(cols, rows)
        const data = imgData.data
        for (let i = 0; i < n; i++) {
          let v = ((samples[i] - loBound) / span) * 255
          if (v < 0) v = 0
          else if (v > 255) v = 255
          if (mono1) v = 255 - v
          const p = i * 4
          data[p] = v
          data[p + 1] = v
          data[p + 2] = v
          data[p + 3] = 255
        }
        ctx.putImageData(imgData, 0, 0)

        const img = toStudyImage(file, cols, rows)
        img.dataUrl = canvas.toDataURL('image/jpeg', 0.92)
        resolve(img)
      })
      .catch((e) => {
        reject(e instanceof Error ? e : new Error(String(e)))
      })
  })
}

/** Convert arbitrary files into ready-to-display StudyImage records. Throws if every file fails. */
export async function filesToStudyImages(files: File[]): Promise<StudyImage[]> {
  const out: StudyImage[] = []
  const errors: string[] = []
  for (const file of files) {
    try {
      out.push(await (await isDicomFile(file) ? decodeDicom(file) : decodeStandardImage(file)))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`${file.name}: ${msg}`)
    }
  }
  if (out.length === 0) {
    throw new Error(errors.length ? errors.join('; ') : 'No supported image files found.')
  }
  return out
}

/** Read every file out of a drag-and-drop DataTransfer (falls back to items when files is empty). */
export async function readDroppedItems(dataTransfer: DataTransfer): Promise<File[]> {
  const files: File[] = []
  if (dataTransfer.files) {
    for (let i = 0; i < dataTransfer.files.length; i++) {
      if (dataTransfer.files[i]) files.push(dataTransfer.files[i])
    }
  }
  if (!files.length && dataTransfer.items) {
    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i]
      if (item.kind === 'file') {
        const f = item.getAsFile()
        if (f) files.push(f)
      }
    }
  }
  return files
}

/** Pull image files out of a ClipboardEvent's clipboard data. */
export function extractImagesFromClipboard(e: ClipboardEvent): File[] {
  const clipboard = e.clipboardData
  if (!clipboard) return []
  const files: File[] = []
  if (clipboard.files) {
    for (let i = 0; i < clipboard.files.length; i++) {
      if (clipboard.files[i]) files.push(clipboard.files[i])
    }
  }
  for (let i = 0; i < clipboard.items.length; i++) {
    if (clipboard.items[i].kind === 'file') {
      const f = clipboard.items[i].getAsFile()
      if (f) files.push(f)
    }
  }
  return files
}

/** Open the native file picker (must be called from a user gesture). Resolves [] on cancel. */
export function pickImageFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = ACCEPTED_TYPES
    input.multiple = true
    input.style.display = 'none'
    document.body.appendChild(input)
    const done = (files: File[]) => {
      input.remove()
      resolve(files)
    }
    input.addEventListener('change', () => done(input.files ? Array.from(input.files) : []), { once: true })
    input.addEventListener('cancel', () => done([]), { once: true })
    input.click()
  })
}
