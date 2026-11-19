// The user's own exam templates and macros, stored per account on the server.
// Without accounts (local mode) they fall back to this browser's storage, like report templates.
import { create } from 'zustand'
import { SERVER_MODE } from './session'
import { BUILTIN_EXAM_TEMPLATES, type ExamTemplate, type ExamTemplateInput } from './examTemplates'
import { BUILTIN_MACROS, type MacroInput, type ReportMacro } from './macros'

const LOCAL_TEMPLATES = 'voxelrad.examTemplates.v1'
const LOCAL_MACROS = 'voxelrad.reportMacros.v1'

function readLocal<T>(key: string): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
function writeLocal(key: string, items: unknown[]) {
  try {
    localStorage.setItem(key, JSON.stringify(items))
  } catch {
    throw new Error('Browser storage is full or unavailable.')
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

// One shape for both collections: server path and local key differ, the CRUD does not.
async function list<T>(path: string, key: string, field: string): Promise<T[]> {
  return SERVER_MODE ? (await api<Record<string, T[]>>(path))[field] ?? [] : readLocal<T>(key)
}
async function upsert<T extends { id: string }>(path: string, key: string, input: object, id: string | undefined, extra: object = {}): Promise<string> {
  if (SERVER_MODE) {
    const result = id
      ? await api<{ id: string }>(`${path}/${id}`, { method: 'PUT', body: JSON.stringify(input) })
      : await api<{ id: string }>(path, { method: 'POST', body: JSON.stringify(input) })
    return result.id
  }
  const items = readLocal<T>(key)
  const newId = id ?? crypto.randomUUID()
  const next = { ...input, ...extra, id: newId, updatedAt: new Date().toISOString() } as unknown as T
  writeLocal(key, items.some((i) => i.id === newId) ? items.map((i) => (i.id === newId ? next : i)) : [...items, next])
  return newId
}
async function removeItem<T extends { id: string }>(path: string, key: string, id: string) {
  if (SERVER_MODE) await api(`${path}/${id}`, { method: 'DELETE' })
  else writeLocal(key, readLocal<T>(key).filter((i) => i.id !== id))
}

interface ExamLibraryState {
  templates: ExamTemplate[]
  macros: ReportMacro[]
  loaded: boolean
  error?: string
  load: () => Promise<void>
  saveTemplate: (input: ExamTemplateInput, id?: string) => Promise<string>
  removeTemplate: (id: string) => Promise<void>
  saveMacro: (input: MacroInput, id?: string) => Promise<string>
  removeMacro: (id: string) => Promise<void>
}

export const useExamLibrary = create<ExamLibraryState>((set, get) => ({
  templates: [],
  macros: [],
  loaded: false,
  load: async () => {
    try {
      const [templates, macros] = await Promise.all([
        list<ExamTemplate>('/api/exam-templates', LOCAL_TEMPLATES, 'templates'),
        list<ReportMacro>('/api/report-macros', LOCAL_MACROS, 'macros'),
      ])
      set({ templates, macros: macros.map((m) => ({ ...m, scope: 'personal' })), loaded: true, error: undefined })
    } catch (error) {
      set({ loaded: true, error: error instanceof Error ? error.message : 'Exam templates could not be loaded.' })
    }
  },
  saveTemplate: async (input, id) => {
    const newId = await upsert<ExamTemplate>('/api/exam-templates', LOCAL_TEMPLATES, input, id)
    await get().load()
    return newId
  },
  removeTemplate: async (id) => {
    await removeItem<ExamTemplate>('/api/exam-templates', LOCAL_TEMPLATES, id)
    await get().load()
  },
  saveMacro: async (input, id) => {
    const newId = await upsert<ReportMacro>('/api/report-macros', LOCAL_MACROS, input, id, { scope: 'personal' })
    await get().load()
    return newId
  },
  removeMacro: async (id) => {
    await removeItem<ReportMacro>('/api/report-macros', LOCAL_MACROS, id)
    await get().load()
  },
}))

/** Personal entries first so they take precedence over built-ins with the same name. */
export const allExamTemplates = (state: Pick<ExamLibraryState, 'templates'> = useExamLibrary.getState()) => [...state.templates, ...BUILTIN_EXAM_TEMPLATES]
export const allMacros = (state: Pick<ExamLibraryState, 'macros'> = useExamLibrary.getState()) => [...state.macros, ...BUILTIN_MACROS]

/** Load once on first use (editor keystrokes and dictation look macros up synchronously). */
export function ensureExamLibrary() {
  const state = useExamLibrary.getState()
  if (!state.loaded) void state.load()
}
