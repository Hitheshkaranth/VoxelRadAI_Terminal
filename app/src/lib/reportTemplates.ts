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
  signatory?: { name: string; qualifications: string; registration: string }
  /** Line above the findings in the systematic layout, e.g. "THANKS FOR REFERRING". */
  greeting?: string
  updatedAt?: string
}

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
