import { acquisitionLabel, type VolumeAcquisition } from './volumeAcquisition'
import { assertVolumeResumeContext } from './volumeResume'
import { volumeFingerprint } from './volumeJobIdentity'
import { validateVolumeAnalysis } from './volumeValidation'
import { workspaceGet as get, workspaceSet as set } from './workspaceStorage'
import { analyzeImage, isSkandaModel } from './medgemma'
import { skandaSliceInput, type SkandaSliceInput } from './skandaSlice'
import { getSliceGeometry, renderSlice, type Volume, type VolumePlane } from './volume'
import { reviewAllSlices, volumeCoverage, type SliceRead } from './volumeAnalysis'
import { volumeFindingKey, volumeReportSourceKey, validateFindingGroup, type VolumeFindingGroup, type VolumeFindingReview, type VolumeDraftReport } from './volumeReview'
import type { PatientInfo, Settings } from '../types'
import { uid } from '../store'

export interface VolumeJobSnapshot { center: number; width: number; model: string; settings: Settings; acquisition?: VolumeAcquisition }
export interface VolumeJob {
  version: 1; id: string; identity: string; title: string; modality: string; plane: VolumePlane; count: number
  snapshot: VolumeJobSnapshot; reads: SliceRead[]; status: 'running' | 'paused' | 'complete' | 'error'
  findingGroups?: VolumeFindingGroup[]
  reviews?: Record<string, VolumeFindingReview>; draftReport?: VolumeDraftReport
  progress: string; elapsedMs: number; runStartedAt?: number; updatedAt: number; error?: string; storageError?: string
}
const patient: PatientInfo = { name: '', patientId: '', age: '', sex: '', studyDate: '', referringPhysician: '', indication: '', clinicalHistory: '' }
const records = new Map<string, VolumeJob>()
const allListeners = new Set<() => void>()
let allRecords: VolumeJob[] = []
export const getAllVolumeJobs = () => allRecords
export function subscribeAllVolumeJobs(listener: () => void) { allListeners.add(listener); return () => { allListeners.delete(listener) } }
const listeners = new Map<string, Set<(job: VolumeJob) => void>>()
const controllers = new Map<string, AbortController>()
const loading = new Map<string, Promise<VolumeJob | null>>()
const saves = new Map<string, Promise<void>>()
if (typeof window !== 'undefined') window.addEventListener('beforeunload', (event) => {
  if (controllers.size) { event.preventDefault(); event.returnValue = '' }
})
const latestKey = (identity: string) => `skanda-volume-latest-v1:${identity}`
const jobKey = (job: VolumeJob) => `skanda-volume-review-v1:${job.identity}:${job.id}`
export function subscribeVolumeJob(identity: string, listener: (job: VolumeJob) => void) {
  const subscribers = listeners.get(identity) ?? new Set()
  subscribers.add(listener); listeners.set(identity, subscribers)
  const existing = records.get(identity)
  if (existing) listener(existing)
  return () => { subscribers.delete(listener); if (!subscribers.size) listeners.delete(identity) }
}
function publish(job: VolumeJob) { records.set(job.identity, job); allRecords = [...records.values()].sort((a,b) => b.updatedAt-a.updatedAt); allListeners.forEach((listener) => listener()); listeners.get(job.identity)?.forEach((listener) => listener(job)); return job }
async function save(job: VolumeJob) {
  const write = async () => {
    const now = Date.now()
    const checkpoint = job.status === 'running' ? { ...job, elapsedMs: job.elapsedMs + Math.max(0, now - (job.runStartedAt ?? now)), runStartedAt: now } : job
    await set(jobKey(job), checkpoint)
    await set(latestKey(job.identity), jobKey(job))
  }
  const pending = (saves.get(job.identity) ?? Promise.resolve()).catch(() => {}).then(write)
  saves.set(job.identity, pending)
  try { await pending }
  catch {
    const current = records.get(job.identity)
    if (current?.id === job.id) publish({ ...current, storageError: 'Could not save this review in the browser. Keep this tab open; new results are not durable.' })
    throw new Error('Browser storage failed. Analysis paused to protect unsaved results.')
  } finally { if (saves.get(job.identity) === pending) saves.delete(job.identity) }
}
export async function loadVolumeJob(identity: string): Promise<VolumeJob | null> {
  const existing = records.get(identity)
  if (existing) return existing
  const inflight = loading.get(identity)
  if (inflight) return inflight
  const pending = (async () => {
    const key = await get<string>(latestKey(identity))
    const saved = key ? await get<VolumeJob>(key) : null
    if (!saved || saved.version !== 1 || saved.identity !== identity || !Array.isArray(saved.reads)) return null
    const resumed: VolumeJob = { ...saved, progress: '', runStartedAt: undefined, status: saved.status === 'running' ? 'paused' : saved.status }
    return publish(resumed)
  })().finally(() => loading.delete(identity))
  loading.set(identity, pending)
  return pending
}
export function pauseVolumeJob(identity: string) {
  controllers.get(identity)?.abort(); controllers.delete(identity)
  const job = records.get(identity)
  if (job?.status === 'running') {
    const next = publish({ ...job, status: 'paused', progress: '', elapsedMs: job.elapsedMs + Math.max(0, Date.now() - (job.runStartedAt ?? Date.now())), runStartedAt: undefined, updatedAt: Date.now() })
    void save(next).catch(() => {})
  }
}
export async function startVolumeJob(opts: { identity: string; volume: Volume; title: string; modality: string; settings: Settings; center: number; width: number; restart?: boolean }): Promise<void> {
  if (controllers.has(opts.identity)) return
  const expectedIdentity = `${await volumeFingerprint(opts.volume)}:${opts.modality.toUpperCase()}`
  if (opts.identity !== expectedIdentity) throw new Error('The review identity does not match the loaded volume and acquisition details. Reopen the source before analysis.')
  // Fingerprinting is asynchronous; recheck the single-job guard after it resolves.
  if (controllers.has(opts.identity)) return
  const planes: VolumePlane[] = ['axial', 'coronal', 'sagittal']
  const plane = planes.find((p) => getSliceGeometry(opts.volume, p).axis === 2)!
  const previous = records.get(opts.identity)
  if (previous && !opts.restart) assertVolumeResumeContext(previous, { identity: opts.identity, modality: opts.modality, acquisition: opts.volume.acquisition })
  const now = Date.now()
  const job: VolumeJob = previous && !opts.restart ? { ...previous, status: 'running', runStartedAt: now, progress: '', error: undefined, storageError: undefined } : {
    version: 1, id: uid(), identity: opts.identity, title: opts.title, modality: opts.modality, plane, count: opts.volume.dimensions[2],
    snapshot: { center: opts.center, width: opts.width, model: opts.settings.model, settings: structuredClone(opts.settings), acquisition: opts.volume.acquisition ? structuredClone(opts.volume.acquisition) : undefined },
    reads: [], status: 'running', progress: '', elapsedMs: 0, runStartedAt: now, updatedAt: now,
  }
  const controller = new AbortController()
  controllers.set(opts.identity, controller)
  publish(job)
  const current = () => controllers.get(opts.identity) === controller
  const patch = (change: Partial<VolumeJob>) => {
    const record = records.get(opts.identity)!
    return publish({ ...record, ...change, updatedAt: Date.now() })
  }
  try {
    await save(job)
    if (!current()) return
    const skandaCache: { mriRange?: [number, number] } = {}  // one MRI normalisation per job (Skanda reads)
    await reviewAllSlices({ retries: 2, onRetry: (index,attempt) => { if(current())patch({progress:`Connection interrupted at slice ${index+1}. Retrying ${attempt}/2…`}) }, count: job.count, previous: job.reads, signal: controller.signal,
      onStart: (index) => { if (current()) patch({ progress: `Reviewing ${job.plane} slice ${index + 1} of ${job.count}` }) },
      onSlice: async (read) => {
        if (!current()) return
        const record = records.get(opts.identity)!
        const next = patch({ reads: [...record.reads.filter((r) => r.index !== read.index), read].sort((a, b) => a.index - b.index) })
        await save(next)
      },
      read: async (index) => {
        const slice = renderSlice(opts.volume, job.plane, index, job.snapshot)
        const raw = document.createElement('canvas')
        raw.width = slice.width; raw.height = slice.height
        raw.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(slice.pixels), slice.width, slice.height), 0, 0)
        const aspect = slice.width * slice.pixelSpacing[0] / (slice.height * slice.pixelSpacing[1])
        const canvas = document.createElement('canvas'), longEdge = Math.min(1536, Math.max(slice.width, slice.height))
        canvas.width = Math.max(1, Math.round(aspect >= 1 ? longEdge : longEdge * aspect))
        canvas.height = Math.max(1, Math.round(aspect >= 1 ? longEdge / aspect : longEdge))
        canvas.getContext('2d')!.drawImage(raw, 0, 0, canvas.width, canvas.height)
        const label = `${job.title}${job.snapshot.acquisition ? ` · ${acquisitionLabel(job.snapshot.acquisition)}` : ''} · ${job.plane} ${index + 1}/${job.count} · W ${job.snapshot.width}/L ${job.snapshot.center} · top ${slice.labels.top}, left ${slice.labels.left}`
        let lastProgress = 0
        let skanda: SkandaSliceInput | undefined
        if (isSkandaModel(job.snapshot.settings.model)) {
          const built = skandaSliceInput(opts.volume, job.plane, index, { ...job.snapshot.acquisition, modality: job.modality, title: job.title }, skandaCache)
          if (!built.input) throw new Error(built.reason ?? 'Skanda cannot read this slice.')
          skanda = built.input
        }
        const analysis = await analyzeImage({ settings: job.snapshot.settings, patient, signal: controller.signal, skanda,
          image: { id: uid(), name: label, mime: 'image/png', dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, addedAt: Date.now(), status: 'idle', sourceModality: job.modality === 'MRI' ? 'MR' : job.modality },
          onProgress: (text) => { if (current() && Date.now() - lastProgress >= 200) { lastProgress = Date.now(); patch({ progress: `Slice ${index + 1}/${job.count} · ${text}` }) } },
        })
        return validateVolumeAnalysis(opts.volume, job.plane, index, job.snapshot, analysis, { sequence: job.snapshot.acquisition?.sequence })
      },
    })
    if (current()) {
      const record = records.get(opts.identity)!, complete = volumeCoverage(record.reads, record.count).complete
      const error = record.reads.find((r) => r.error)?.error
      await save(patch({ status: complete ? 'complete' : error ? 'error' : 'paused', error, progress: '', elapsedMs: record.elapsedMs + Date.now() - (record.runStartedAt ?? Date.now()), runStartedAt: undefined }))
    }
  } catch (error) {
    if (current()) {
      const record = records.get(opts.identity)!
      const next = patch({ status: 'error', error: error instanceof Error ? error.message : 'Volume analysis failed', progress: '', elapsedMs: record.elapsedMs + Date.now() - (record.runStartedAt ?? Date.now()), runStartedAt: undefined })
      if (!record.storageError) await save(next).catch(() => {})
    }
  } finally { if (current()) controllers.delete(opts.identity) }
}

/** Review edits are separate from raw model reads and survive checkpoints/navigation. */
export async function updateVolumeFinding(identity: string, jobId: string, index: number, findingId: string, patch: { decision?: VolumeFindingReview['decision']; description?: string }): Promise<void> {
  const job = records.get(identity)
  if (!job || job.id !== jobId) throw new Error('This review changed. Reopen the current findings before editing.')
  const finding = job.reads.find((r) => r.index === index)?.analysis?.findings.find((f) => f.id === findingId)
  if (!finding) throw new Error('This finding is no longer available.')
  if (patch.decision === 'accepted' && finding.validationIssues?.length) throw new Error('This model claim failed source-consistency checks. Reject it or obtain a corrected analysis before acceptance.')
  const key = volumeFindingKey(index, findingId), prior = job.reviews?.[key]
  const review: VolumeFindingReview = { decision: prior?.decision ?? 'pending', ...prior, ...patch, updatedAt: Date.now() }
  if (review.description !== undefined && !review.description.trim()) throw new Error('Enter a description before saving.')
  await save(publish({ ...job, reviews: { ...job.reviews, [key]: review }, updatedAt: Date.now() }))
}
export async function saveVolumeDraft(identity: string, jobId: string, text: string, sourceKey: string, reviewed = false): Promise<void> {
  const job = records.get(identity)
  if (!job || job.id !== jobId) throw new Error('This review changed. Generate a draft from the current findings.')
  if (!text.trim()) throw new Error('The report cannot be empty.')
  if (reviewed) {
    const pending = job.reads.some((r) => r.analysis?.findings.some((f) => f.severity !== 'normal' && (!job.reviews?.[volumeFindingKey(r.index,f.id)] || job.reviews[volumeFindingKey(r.index,f.id)].decision === 'pending')))
    if (job.reads.some(r=>r.analysis?.findings.some(f=>f.validationIssues?.length && job.reviews?.[volumeFindingKey(r.index,f.id)]?.decision==='accepted')) || !volumeCoverage(job.reads,job.count).complete || pending || sourceKey !== volumeReportSourceKey(job)) throw new Error('Complete coverage and finding review, then regenerate the draft before marking it reviewed.')
  }
  await save(publish({ ...job, draftReport: { text, sourceKey, updatedAt: Date.now(), ...(reviewed ? { reviewedAt: Date.now() } : {}) }, updatedAt: Date.now() }))
}

export async function createVolumeFindingGroup(identity: string, jobId: string, label: string, members: string[]) {
  const job = records.get(identity)
  if (!job || job.id !== jobId) throw new Error('This analysis has changed. Reopen the findings.')
  const validated = validateFindingGroup(job, label, members)
  const group: VolumeFindingGroup = { ...validated, id: uid(), createdAt: Date.now() }
  await save(publish({ ...job, findingGroups: [...(job.findingGroups ?? []), group], updatedAt: Date.now() }))
}
export async function removeVolumeFindingGroup(identity: string, jobId: string, groupId: string) {
  const job = records.get(identity)
  if (!job || job.id !== jobId) throw new Error('This analysis has changed. Reopen the findings.')
  await save(publish({ ...job, findingGroups: (job.findingGroups ?? []).filter(group => group.id !== groupId), updatedAt: Date.now() }))
}

export async function auditVolumeJob(identity: string, volume: Volume): Promise<VolumeJob | null> {
  const job = await loadVolumeJob(identity)
  if (!job) return null
  const reads = job.reads.map(read => ({...read, analysis: read.analysis ? validateVolumeAnalysis(volume,job.plane,read.index,job.snapshot,read.analysis,{ sequence: job.snapshot.acquisition?.sequence }) : undefined}))
  if (JSON.stringify(reads) === JSON.stringify(job.reads)) return job
  const next = publish({...job,reads,updatedAt:Date.now()})
  await save(next)
  return next
}
