// Report templates (letterhead, footer, section titles), stored per user on the server.
// Without accounts (local mode) they fall back to this browser's storage.
import { create } from 'zustand'
import { SERVER_MODE } from './session'
import type { ReportDraft, ReportFieldKey } from '../types'

export interface ReportTemplate {
  id: string
  name: string
  isDefault: boolean
  header: { logoDataUrl?: string; institution: string; department: string; lines: string[]; align: 'left' | 'center' }
  footer: { text: string; showPageNumbers: boolean; showDisclaimer: boolean }
  sectionTitles: Partial<Record<ReportFieldKey, string>>
  /** 'systematic': patient block, exam-type line, greeting, one titled row per anatomical section and a signatory
   *  block (diagnostic-centre style). Absent = 'standard' (templates saved before this option keep their layout). */
  layout?: ReportLayout
  /** Reporting radiologist shown in the systematic letterhead and signature block (plain text). */
  signatory?: { name: string; qualifications: string; registration: string; lines?: string[] }
  /** Signature block text, one line each (e.g. name with degrees, centre, address, registration); default: the
   *  signatory's name, qualifications and registration. Plain text only, never a signature or stamp image. */
  signatureLines?: string[]
  /** Line above the findings in the systematic layout, e.g. "THANKS FOR REFERRING". */
  greeting?: string
  /** A blank page of the centre's own report (scanned or exported), printed behind every page. The report text sits
   *  between topMm and bottomMm so it never covers the pre-printed header or footer. */
  letterhead?: Letterhead
  updatedAt?: string
}

export interface Letterhead { pageDataUrl: string; topMm: number; bottomMm: number }

export type ReportLayout = 'standard' | 'systematic'
export const SYSTEMATIC_TEMPLATE_NAME = 'Systematic (Indian diagnostic centre style)'

export const layoutOf = (template: Pick<ReportTemplate, 'layout'> | null | undefined): ReportLayout =>
  template?.layout === 'systematic' ? 'systematic' : 'standard'

export type TemplateInput = Omit<ReportTemplate, 'id' | 'isDefault' | 'updatedAt'>

export const DEFAULT_SECTION_TITLES: Record<ReportFieldKey, string> = {
  technique: 'Technique',
  comparison: 'Comparison',
  findings: 'Findings',
  impression: 'Impression',
  recommendations: 'Recommendations',
}

export function blankTemplate(institution = ''): TemplateInput {
  return {
    name: 'New template',
    header: { institution, department: 'Department of Radiology', lines: [], align: 'left' },
    footer: { text: '', showPageNumbers: true, showDisclaimer: true },
    sectionTitles: {},
  }
}

/** Built-in starting point for the systematic layout. Placeholders only: the centre fills in its own letterhead. */
export function systematicTemplate(institution = ''): TemplateInput {
  return {
    name: SYSTEMATIC_TEMPLATE_NAME,
    header: { institution: institution || 'Your Diagnostic Centre', department: 'CT · Ultrasound · X-ray', lines: ['Address line', 'Phone · Email'], align: 'center' },
    footer: { text: '', showPageNumbers: true, showDisclaimer: true },
    sectionTitles: { technique: 'Type of Examination', impression: 'Impression', recommendations: 'Note' },
    layout: 'systematic',
    signatory: { name: 'Dr. A. Radiologist', qualifications: 'MBBS, MD (Radiodiagnosis)', registration: 'Reg. No. ______' },
    greeting: 'THANKS FOR REFERRING',
  }
}

export function sectionTitle(template: ReportTemplate | null | undefined, key: ReportFieldKey): string {
  return template?.sectionTitles[key]?.trim() || DEFAULT_SECTION_TITLES[key]
}

const LOCAL_KEY = 'voxelrad.reportTemplates.v1'

function readLocal(): ReportTemplate[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
function writeLocal(templates: ReportTemplate[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(templates))
  } catch {
    throw new Error('Browser storage is full or unavailable. Remove a template or use a smaller logo.')
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Template service error (HTTP ${response.status}).`)
  return data as T
}

interface TemplateState {
  templates: ReportTemplate[]
  loaded: boolean
  error?: string
  load: () => Promise<void>
  save: (input: TemplateInput, id?: string) => Promise<string>
  remove: (id: string) => Promise<void>
  setDefault: (id: string | null) => Promise<void>
}

export const useTemplates = create<TemplateState>((set, get) => ({
  templates: [],
  loaded: false,
  load: async () => {
    try {
      const templates = SERVER_MODE ? (await api<{ templates: ReportTemplate[] }>('/api/report-templates')).templates : readLocal()
      set({ templates, loaded: true, error: undefined })
    } catch (error) {
      set({ loaded: true, error: error instanceof Error ? error.message : 'Templates could not be loaded.' })
    }
  },
  save: async (input, id) => {
    if (SERVER_MODE) {
      const result = id
        ? await api<{ id: string }>(`/api/report-templates/${id}`, { method: 'PUT', body: JSON.stringify(input) })
        : await api<{ id: string }>('/api/report-templates', { method: 'POST', body: JSON.stringify(input) })
      await get().load()
      return result.id
    }
    const templates = readLocal()
    const newId = id ?? crypto.randomUUID()
    const existing = templates.find((t) => t.id === newId)
    const next: ReportTemplate = { ...input, id: newId, isDefault: existing?.isDefault ?? templates.length === 0, updatedAt: new Date().toISOString() }
    writeLocal(existing ? templates.map((t) => (t.id === newId ? next : t)) : [...templates, next])
    await get().load()
    return newId
  },
  remove: async (id) => {
    if (SERVER_MODE) await api(`/api/report-templates/${id}`, { method: 'DELETE' })
    else writeLocal(readLocal().filter((t) => t.id !== id))
    await get().load()
  },
  setDefault: async (id) => {
    if (SERVER_MODE) {
      const current = get().templates.find((t) => t.isDefault)
      if (id) await api(`/api/report-templates/${id}/default`, { method: 'PUT' })
      else if (current) await api(`/api/report-templates/${current.id}/default`, { method: 'DELETE' })
    } else {
      writeLocal(readLocal().map((t) => ({ ...t, isDefault: t.id === id })))
    }
    await get().load()
  },
}))

/** The template a report uses: its own choice if it still exists, else the user's default, else none. */
export function templateForReport(templates: ReportTemplate[], report: Pick<ReportDraft, 'templateId'> | null | undefined): ReportTemplate | null {
  return templates.find((t) => t.id === report?.templateId) ?? templates.find((t) => t.isDefault) ?? null
}

/** Downscale an uploaded logo to a compact raster data URL (PNG keeps transparency; photos become JPEG). */
export async function logoDataUrl(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Use a PNG, JPEG or WebP logo.')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 480 / bitmap.width, 160 / bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const url = canvas.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9)
  if (url.length > 550 * 1024) throw new Error('Logo is too large even after resizing. Use a simpler image.')
  return url
}

const A4 = { w: 210, h: 297 }
const PAGE_PX = { w: 1240, h: 1754 } // A4 at 150 dpi
const LETTERHEAD_MAX_CHARS = 1300 * 1024

/** Draw page 1 of a PDF, or an image, onto a white A4 canvas. */
async function pageCanvas(file: File): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = PAGE_PX.w; canvas.height = PAGE_PX.h
  const g = canvas.getContext('2d')!
  g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height)
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const pdfjs = await import('pdfjs-dist')
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = worker
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise
    try {
      const page = await pdf.getPage(1)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(PAGE_PX.w / base.width, PAGE_PX.h / base.height)
      const viewport = page.getViewport({ scale })
      g.save(); g.translate((PAGE_PX.w - viewport.width) / 2, 0)
      await page.render({ canvasContext: g, viewport }).promise
      g.restore()
    } finally { void pdf.destroy() }
    return canvas
  }
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Upload a PDF, PNG, JPEG or WebP of a blank report page.')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(PAGE_PX.w / bitmap.width, PAGE_PX.h / bitmap.height)
  g.drawImage(bitmap, (PAGE_PX.w - bitmap.width * scale) / 2, 0, bitmap.width * scale, bitmap.height * scale)
  bitmap.close()
  return canvas
}

/** The writing area of a blank page: the longest run of blank rows between the printed header and footer. */
export function detectMargins(rowsBlank: boolean[]): { topMm: number; bottomMm: number } {
  const n = rowsBlank.length
  let best = { start: 0, len: 0 }, start = -1
  for (let i = 0; i <= n; i++) {
    if (i < n && rowsBlank[i]) { if (start < 0) start = i; continue }
    if (start >= 0 && i - start > best.len) best = { start, len: i - start }
    start = -1
  }
  if (best.len < n * 0.3) return { topMm: 40, bottomMm: 25 }
  const toMm = (rows: number) => Math.round((rows / n) * A4.h)
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  // A little breathing room under the header and above the footer; a page blank at the edge keeps a normal margin.
  return { topMm: clamp(best.start === 0 ? 16 : toMm(best.start) + 4, 10, 150), bottomMm: clamp(best.start + best.len >= n ? 16 : toMm(n - best.start - best.len) + 4, 10, 120) }
}

/** Read an uploaded blank report page (PDF page 1 or an image) into a compact A4 JPEG and find its writing area. */
export async function letterheadFromFile(file: File): Promise<Letterhead> {
  if (file.size > 20 * 1024 * 1024) throw new Error('That file is over 20 MB. Export just the blank page.')
  const canvas = await pageCanvas(file)
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
  const rowsBlank: boolean[] = []
  for (let y = 0; y < canvas.height; y++) {
    let ink = 0
    for (let x = 0; x < canvas.width; x += 2) {
      const i = (y * canvas.width + x) * 4
      if (data[i] + data[i + 1] + data[i + 2] < 3 * 225) ink++
    }
    rowsBlank.push(ink < 2)
  }
  const margins = detectMargins(rowsBlank)
  let out = canvas
  for (const width of [PAGE_PX.w, 992]) {
    if (width !== out.width) {
      const smaller = document.createElement('canvas')
      smaller.width = width; smaller.height = Math.round((width / PAGE_PX.w) * PAGE_PX.h)
      smaller.getContext('2d')!.drawImage(canvas, 0, 0, smaller.width, smaller.height)
      out = smaller
    }
    for (const q of [0.85, 0.75, 0.65]) {
      const url = out.toDataURL('image/jpeg', q)
      if (url.length <= LETTERHEAD_MAX_CHARS) return { pageDataUrl: url, ...margins }
    }
  }
  throw new Error('That page is too detailed to store. Try a simpler scan or a PDF export.')
}
