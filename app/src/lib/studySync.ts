// Server study saves with optimistic concurrency: each save names the server revision that THIS copy of the study
// was loaded from or last saved as (Study.serverRevision, persisted with the study). A second tab or a re-imported
// older copy therefore sends its own, older revision and is refused (409) instead of silently overwriting newer text.
// Imported by scripts/test-study-sync.ts under node strip-types: runtime imports need an explicit .ts extension.
import type { Study } from '../types'

/** Legacy per-browser map (studyId -> revision). Read only as a one-time fallback for studies saved before
 *  Study.serverRevision existed; it is never written again and an entry is dropped once the study carries its own. */
const LEGACY_KEY = 'voxelrad.studyRevisions'
export const REVISION_HEADER = 'X-Study-Revision'

export class StudyConflictError extends Error {
  /** 'stale' = the server copy is newer; 'signed-history' = the save would drop or alter signed versions. */
  code: 'stale' | 'signed-history'
  constructor(message: string, code: 'stale' | 'signed-history') {
    super(message)
    this.code = code
  }
}

const validRevision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0

function readLegacy(): Record<string, number> {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(LEGACY_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch { return {} }
}

function forgetLegacy(studyId: string): void {
  try {
    const all = readLegacy()
    if (!(studyId in all)) return
    delete all[studyId]
    if (Object.keys(all).length) globalThis.localStorage?.setItem(LEGACY_KEY, JSON.stringify(all))
    else globalThis.localStorage?.removeItem(LEGACY_KEY)
  } catch { /* storage blocked: the study field still wins */ }
}

/** Server revision this copy of the study is based on: its own field first, else the legacy browser map (migration). */
export function knownRevision(study: Pick<Study, 'id' | 'serverRevision'>): number | undefined {
  if (validRevision(study.serverRevision)) return study.serverRevision
  const legacy = readLegacy()[study.id]
  return validRevision(legacy) ? legacy : undefined
}

/** Copy of `study` stamped with the server revision it now matches (after a load from or save to the server). */
export function withServerRevision<T extends Study>(study: T, revision: unknown): T {
  // An unusable revision clears the field (the next save then expects no server copy and is refused if one exists).
  return { ...study, serverRevision: validRevision(revision) ? revision : undefined }
}

type RevisionListener = (studyId: string, revision: number) => void
let revisionListener: RevisionListener | undefined
/** The store registers here so a successful save stamps the in-memory (and persisted) study with its new revision. */
export function setServerRevisionListener(listener: RevisionListener | undefined): void { revisionListener = listener }

/** Save a study to the server. `overwrite` skips the revision check (explicit user choice after a conflict). */
export async function saveStudyToServer(study: Study, options: { overwrite?: boolean; body?: string } = {}): Promise<number | undefined> {
  const known = knownRevision(study)
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
  if (!validRevision(data.revision)) return undefined
  forgetLegacy(study.id)
  revisionListener?.(study.id, data.revision)
  return data.revision
}
