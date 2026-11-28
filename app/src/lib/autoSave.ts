// Automatic saving (hosted site): every study with images is saved to the signed-in account a few seconds after it
// changes — patient details, images, findings, review decisions and report all travel together in one record. It uses
// the same revision-checked save as the manual button, so a newer copy saved from another tab or device is never
// overwritten: that study stops auto-saving and says so until the reader resolves it in Saved studies.
import { persistedStudies, useApp } from '../store'
import type { Study } from '../types'
import { SERVER_MODE, useSession } from './session'
import { StudyConflictError, saveStudyToServer } from './studySync'

export type AutoSaveStatus = 'pending' | 'saving' | 'saved' | 'too-large' | 'conflict' | 'error'
export interface AutoSaveState { status: AutoSaveStatus; at?: number; message?: string }

const DELAY_MS = 3000
const LIMIT_MB = Number(import.meta.env?.VITE_STUDY_LIMIT_MB) || 25
const states = new Map<string, AutoSaveState>()
const listeners = new Set<() => void>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
/** Fingerprint of what was last saved (or found already saved) per study, so unchanged studies are not re-sent. */
const savedPrint = new Map<string, string>()
const inFlight = new Set<string>()
let started = false
let stopped = false

export function autoSaveState(studyId: string | undefined): AutoSaveState | undefined {
  return studyId ? states.get(studyId) : undefined
}
export function subscribeAutoSave(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function setState(id: string, state: AutoSaveState) {
  states.set(id, state)
  for (const l of listeners) l()
}

/** The study as it is sent, minus the revision stamp a successful save adds (which must not trigger another save). */
function payloadOf(study: Study): { body: string; print: string } {
  const persisted = persistedStudies([study])[0]
  const body = JSON.stringify(persisted)
  const { serverRevision: _ignored, ...rest } = persisted as Study & { serverRevision?: number }
  return { body, print: JSON.stringify(rest) }
}

const eligible = (s: Study) => s.images.length > 0 && !s.images.some((i) => i.status === 'analyzing')

function schedule(study: Study) {
  if (stopped || !eligible(study)) return
  const current = states.get(study.id)?.status
  if (current === 'conflict') return
  const { print } = payloadOf(study)
  if (savedPrint.get(study.id) === print) return
  clearTimeout(timers.get(study.id))
  if (current !== 'saving') setState(study.id, { status: 'pending' })
  timers.set(study.id, setTimeout(() => { void save(study.id) }, DELAY_MS))
}

async function save(id: string) {
  timers.delete(id)
  if (stopped) return
  if (inFlight.has(id)) { timers.set(id, setTimeout(() => { void save(id) }, DELAY_MS)); return }
  const study = useApp.getState().studies.find((s) => s.id === id)
  if (!study || !eligible(study)) return
  const { body, print } = payloadOf(study)
  if (savedPrint.get(id) === print) { setState(id, { status: 'saved', at: states.get(id)?.at ?? Date.now() }); return }
  if (new Blob([body]).size > LIMIT_MB * 1024 * 1024) {
    setState(id, { status: 'too-large', message: `Over the ${LIMIT_MB} MB limit for automatic saving; kept in this browser.` })
    return
  }
  inFlight.add(id)
  setState(id, { status: 'saving' })
  try {
    await saveStudyToServer(study, { body })
    savedPrint.set(id, print)
    setState(id, { status: 'saved', at: Date.now() })
  } catch (error) {
    if (error instanceof StudyConflictError) {
      setState(id, { status: 'conflict', message: 'A newer copy is saved from another tab or device. Open Settings → Saved studies to keep one.' })
    } else {
      const message = error instanceof Error ? error.message : 'Automatic save failed.'
      if (/session expired|sign in/i.test(message)) stopped = true
      setState(id, { status: /too large|storage|quota/i.test(message) ? 'too-large' : 'error', message })
      // Transient failures retry once more after a pause; the next edit also retries.
      if (!stopped && !/too large|storage|quota/i.test(message)) timers.set(id, setTimeout(() => { void save(id) }, 30000))
    }
  } finally { inFlight.delete(id) }
}

/**
 * Start watching the workspace. Idempotent; hosted site only. Studies already on the server are taken as saved; studies
 * never saved (no server revision) are saved once now.
 */
export function startAutoSave(): void {
  if (started || !SERVER_MODE) return
  started = true
  let previous = useApp.getState().studies
  for (const s of previous) {
    if (s.serverRevision) savedPrint.set(s.id, payloadOf(s).print)
    else schedule(s)
  }
  useApp.subscribe((state) => {
    if (state.studies === previous) return
    const before = new Map(previous.map((s) => [s.id, s]))
    previous = state.studies
    if (!useSession.getState().user) return
    for (const s of state.studies) {
      if (before.get(s.id) === s) continue
      // Newly loaded (from browser storage or the server) and already on the server: take it as saved.
      if (!before.has(s.id) && s.serverRevision && !savedPrint.has(s.id)) { savedPrint.set(s.id, payloadOf(s).print); continue }
      schedule(s)
    }
  })
}

/** Manual save, restore or overwrite resolved a conflict: resume automatic saving for this study. */
export function markStudySaved(study: Study): void {
  savedPrint.set(study.id, payloadOf(study).print)
  setState(study.id, { status: 'saved', at: Date.now() })
}
