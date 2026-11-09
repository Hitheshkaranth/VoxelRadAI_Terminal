// OWNER: Agent 2 (Viewer & intake). Standard + DICOM image intake.
import { uid } from '../store'
import type { StudyImage } from '../types'
import { createDicomFrameDecoder } from './dicomIntake'

export const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp,image/bmp,image/gif,.dcm,.dicom,application/dicom'

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
  if (name.endsWith('.dcm') || name.endsWith('.dicom')) return true
  if (file.type === 'application/dicom') return true
  try {
    const bytes = new Uint8Array(await file.slice(128, 132).arrayBuffer())
    if (bytes.length !== 4) return false
    return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'DICM'
  } catch {
    return false
  }
}

/** Draw a grey buffer to a canvas, downscaled so the long edge is at most MAX_EDGE (like other images). */
function grayToDataUrl(gray: Uint8ClampedArray, cols: number, rows: number): { dataUrl: string; width: number; height: number } {
  const full = document.createElement('canvas')
  full.width = cols
  full.height = rows
  const ctx = full.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not supported in this browser.')
  const imgData = ctx.createImageData(cols, rows)
  const data = imgData.data
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4
    data[p] = data[p + 1] = data[p + 2] = gray[i]
    data[p + 3] = 255
  }
  ctx.putImageData(imgData, 0, 0)

  const scale = Math.min(1, MAX_EDGE / Math.max(cols, rows))
  if (scale === 1) return { dataUrl: full.toDataURL('image/jpeg', 0.92), width: cols, height: rows }
  const width = Math.max(1, Math.round(cols * scale))
  const height = Math.max(1, Math.round(rows * scale))
  const small = document.createElement('canvas')
  small.width = width
  small.height = height
  const sctx = small.getContext('2d')
  if (!sctx) throw new Error('Canvas 2D is not supported in this browser.')
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(full, 0, 0, width, height)
  return { dataUrl: small.toDataURL('image/jpeg', 0.92), width, height }
}

async function decodeDicom(file: File): Promise<StudyImage[]> {
  const decoder = createDicomFrameDecoder(new Uint8Array(await file.arrayBuffer()))
  const images: StudyImage[] = []
  for (let frame = 0; frame < decoder.frameCount; frame++) {
    const { gray, cols, rows, ...source } = decoder.decode(frame)
    const { dataUrl, width, height } = grayToDataUrl(gray, cols, rows)
    const img = { ...toStudyImage(file, width, height), ...source, dataUrl }
    if (decoder.frameCount > 1) img.name = `${file.name} (frame ${frame + 1} of ${decoder.frameCount})`
    images.push(img)
    // Yield between frames so a large supported stack does not freeze the shell.
    if (frame % 8 === 7) await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  return images
}

/** Files larger than this are refused before decoding (a chest film is rarely above 30 MB). */
const MAX_BYTES = 60 * 1024 * 1024

/** Decoded images plus a reason for every file that was skipped. */
export type IntakeResult = StudyImage[] & { errors: string[] }

/**
 * Convert arbitrary files into ready-to-display StudyImage records. The array carries `errors`
 * (one "name: reason" per skipped file). Throws if every file fails.
 */
export async function filesToStudyImages(files: File[]): Promise<IntakeResult> {
  const out: StudyImage[] = []
  const errors: string[] = []
  for (const file of files) {
    try {
      if (file.size > MAX_BYTES) {
        throw new Error(`File is ${Math.round(file.size / 1024 / 1024)} MB; the limit is ${MAX_BYTES / 1024 / 1024} MB.`)
      }
      if (await isDicomFile(file)) out.push(...await decodeDicom(file))
      else out.push(await decodeStandardImage(file))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`${file.name}: ${msg}`)
    }
  }
  if (out.length === 0) {
    throw new Error(errors.length ? errors.join('; ') : 'No supported image files found.')
  }
  return Object.assign(out, { errors })
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
  // Browsers usually expose the same pasted image in both lists; items are only a fallback.
  if (files.length) return files
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
