// Model-improvement capture (server accounts only). Sends de-identified copies of analysed images,
// AI findings with the radiologist's decisions, AI draft vs signed report text, and dictation clips
// that were undone or corrected. Patient fields never leave the browser; known identifiers are also
// removed from free text. Capture failures never interrupt reading or reporting.
import { SERVER_MODE } from './session'
import type { Finding, ReportFieldKey, Study, StudyImage } from '../types'
import { REPORT_FIELD_KEYS } from '../types'
import { ageBand, redactKnownIdentifiers } from './deidentify'

let enabledPromise: Promise<boolean> | null = null
export function captureEnabled(): Promise<boolean> {
  if (!SERVER_MODE) return Promise.resolve(false)
  enabledPromise ??= fetch('/api/training/status', { credentials: 'same-origin', cache: 'no-store' })
    .then(async (r) => r.ok && (await r.json()).enabled === true)
    .catch(() => false)
  return enabledPromise
}

const post = (path: string, body: unknown) =>
  fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: false })
    .then((r) => { if (!r.ok) console.debug('Training capture skipped', r.status) })
    .catch(() => { /* capture is best-effort */ })

/** Pixels only (no file metadata), long side at most 2048 px, as JPEG. */
async function deidentifiedImage(image: StudyImage): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(await (await fetch(image.dataUrl)).blob())
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.92), width: canvas.width, height: canvas.height }
  } catch {
    return null
  }
}

const findingRecord = (f: Finding, study: Study) => ({
  title: redactKnownIdentifiers(f.title ?? '', study),
  description: redactKnownIdentifiers(f.description ?? '', study),
  location: f.location, severity: f.severity, confidence: f.confidence, review: f.review, source: f.source,
  category: (f as { category?: string }).category, bbox: f.bbox,
})

export async function captureAnalysis(study: Study, image: StudyImage) {
  if (!image.analysis || !(await captureEnabled())) return
  const a = image.analysis
  const pixels = await deidentifiedImage(image)
  void post('/api/training/cases', {
    kind: 'analysis', studyId: study.id, imageId: image.id,
    modality: a.modality, bodyPart: a.bodyPart, view: a.view, model: a.model, durationMs: a.durationMs,
    impression: redactKnownIdentifiers(a.impression ?? '', study),
    findings: a.findings.map((f) => findingRecord(f, study)),
    patient: { ageBand: ageBand(study.patient.age), sex: study.patient.sex },
    image: pixels?.dataUrl, width: pixels?.width, height: pixels?.height,
  })
}

export async function captureSignedReport(study: Study) {
  const report = study.report
  if (!report?.signed || !(await captureEnabled())) return
  const sections = (source: Partial<Record<ReportFieldKey, string>> | undefined) =>
    source ? Object.fromEntries(REPORT_FIELD_KEYS.map((k) => [k, redactKnownIdentifiers(source[k] ?? '', study)])) : null
  const analysed = study.images.filter((i) => i.analysis)
  void post('/api/training/cases', {
    kind: 'signed', studyId: study.id,
    modality: analysed[0]?.analysis?.modality, bodyPart: analysed[0]?.analysis?.bodyPart, model: analysed[0]?.analysis?.model,
    findings: analysed.flatMap((i) => i.analysis!.findings.map((f) => findingRecord(f, study))),
    patient: { ageBand: ageBand(study.patient.age), sex: study.patient.sex },
    aiDraft: sections(report.aiDraft), final: sections(report),
    draftMethod: report.draftMethod, signOverrides: report.signOverrides,
  })
  await reportCorrectedClips(study)
}

// ---- Dictation clips --------------------------------------------------------
interface Clip { studyId: string; section: ReportFieldKey; transcript: string; blob: Blob; language: string }
const clips: Clip[] = []
const MAX_CLIPS = 60

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

async function sendClip(kind: 'undone' | 'corrected', clip: Clip, corrected: string, study?: Study) {
  if (!(await captureEnabled())) return
  const clean = (t: string) => (study ? redactKnownIdentifiers(t, study) : t)
  void post('/api/training/dictation', {
    kind, language: clip.language, transcript: clean(clip.transcript), corrected: clean(corrected),
    audio: await toBase64(clip.blob), mime: clip.blob.type || 'audio/webm',
  })
}

/** Remember a dictated phrase so a later undo or correction can be reported with its audio. */
export function rememberClip(clip: Clip) {
  clips.push(clip)
  if (clips.length > MAX_CLIPS) clips.shift()
}

/** "Scratch that": the last phrase was wrong. */
export function reportUndoneClip(study?: Study) {
  const clip = clips.pop()
  if (clip) void sendClip('undone', clip, '', study)
}

/** At sign-off, phrases whose words no longer appear in their section were corrected by the radiologist. */
async function reportCorrectedClips(study: Study) {
  const normalise = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  for (let i = clips.length - 1; i >= 0; i--) {
    const clip = clips[i]
    if (clip.studyId !== study.id) continue
    clips.splice(i, 1)
    const finalText = study.report?.[clip.section] ?? ''
    if (!normalise(finalText).includes(normalise(clip.transcript))) await sendClip('corrected', clip, finalText, study)
  }
}
