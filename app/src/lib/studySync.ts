// Server study saves with optimistic concurrency: each save names the server revision this browser last saw,
// so a stale copy is refused (409) instead of silently overwriting a newer one.
// Imported by scripts/test-study-sync.ts under node strip-types: runtime imports need an explicit .ts extension.
import type { Study } from '../types'

const KEY = 'voxelrad.studyRevisions'
export const REVISION_HEADER = 'X-Study-Revision'

export class StudyConflictError extends Error {
  /** 'stale' = the server copy is newer; 'signed-history' = the save would drop or alter signed versions. */
  code: 'stale' | 'signed-history'
  constructor(message: string, code: 'stale' | 'signed-history') {
    super(message)
    this.code = code
  }
}

function readAll(): Record<string, number> {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch { return {} }
}

/** Server revision this browser last saved or opened for the study, if any. */
export function knownRevision(studyId: string): number | undefined {
  const value = readAll()[studyId]
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

export function rememberRevision(studyId: string, revision: unknown): void {
  if (!Number.isSafeInteger(revision) || (revision as number) < 1) return
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify({ ...readAll(), [studyId]: revision })) } catch { /* storage full or blocked: next save sends "new" and may conflict */ }
}

/** Save a study to the server. `overwrite` skips the revision check (explicit user choice after a conflict). */
export async function saveStudyToServer(study: Study, options: { overwrite?: boolean; body?: string } = {}): Promise<number | undefined> {
  const known = knownRevision(study.id)
  const response = await fetch('/api/studies', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.overwrite ? {} : { [REVISION_HEADER]: known ? String(known) : 'new' }) },
    body: options.body ?? JSON.stringify(study),
  })
  if (response.status === 409) {
    const data = await response.json().catch(() => ({})) as { code?: unknown; error?: unknown }
    const code = data.code === 'signed-history' ? 'signed-history' : 'stale'
    throw new StudyConflictError(typeof data.error === 'string' && data.error ? data.error : 'The server copy of this study changed since you last saved it.', code)
  }
  if (response.status === 401) throw new Error('Your session expired. Sign in again.')
  if (response.status === 413) throw new Error('This study is too large for the server. Keep it local or ask your administrator about the upload limit.')
  if (!response.ok) throw new Error('The study could not be saved. Check the server and try again.')
  const data = await response.json().catch(() => ({})) as { revision?: unknown }
  rememberRevision(study.id, data.revision)
  return typeof data.revision === 'number' ? data.revision : undefined
}
