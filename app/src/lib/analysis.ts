// Store-bound orchestration the UI calls: read → cross-check → optional second reader, and report drafting.
import { create } from 'zustand'
import { toast } from '../components/shell/toastStore'
import { useApp } from '../store'
import type { AnalysisResult, AnalysisStage, ReportDraft, Settings, StudyImage } from '../types'
import { crossCheck, reportSourceKey, reportTraceLines } from './classifier'
import { analysisEligibility, isCrossSectional } from './modality'
import { augment, mairaHealth } from './maira'
import { analyzeImage, generateReport, reencodeForClassifier } from './medgemma'

const controllers = new Map<string, AbortController>()
const lastProgress = new Map<string, number>()
let reportController: AbortController | undefined

const STAGE_TEXT: Record<AnalysisStage, string> = {
  queued: 'Queued',
  reading: 'Reviewing image…',
  retry: 'Retrying unparseable reply…',
  'lung-pattern': 'Checking lung pattern…',
  'cross-check': 'Cross-checking with classifier…',
  'second-reader': 'Second reader (MAIRA-2)…',
}

// ---- per-image analysis ----------------------------------------------------

/**
 * Analyse one image. Without `force` this is a no-op when the image is already analysing or done; with `force`
 * any running analysis is cancelled and the previous result discarded first.
 * Streams progress back into the store, throttled to ~5 updates/s.
 */
export function runAnalysis(studyId: string, imageId: string, opts?: { force?: boolean }): void {
  const study = useApp.getState().studies.find((s) => s.id === studyId)
  const image = study?.images.find((i) => i.id === imageId)
  if (!study || !image) return
  const eligibility = analysisEligibility(image)
  if (!eligibility.supported) { toast(eligibility.reason!, 'info'); return }
  if (opts?.force) useApp.getState().resetImageAnalysis(studyId, imageId)
  else if (image.status === 'done' || image.status === 'analyzing') return

  cancelImage(imageId)
  const controller = new AbortController()
  controllers.set(imageId, controller)
  lastProgress.set(imageId, 0) // force an immediate first update
  useApp.getState().setImageStatus(studyId, imageId, 'analyzing', {
    progressText: STAGE_TEXT.queued,
    stage: 'queued',
    analysisStartedAt: Date.now(),
  })
  void runStudyImage(studyId, imageId, controller)
}

async function runStudyImage(studyId: string, imageId: string, controller: AbortController): Promise<void> {
  const study = useApp.getState().studies.find((s) => s.id === studyId)
  const image = study?.images.find((i) => i.id === imageId)
  if (!study || !image) return
  const settings = useApp.getState().settings
  // A forced re-run replaces the controller; the superseded run must not touch the store.
  const current = () => controllers.get(imageId) === controller
  const stage = (s: AnalysisStage) => {
    if (current()) useApp.getState().setImageStatus(studyId, imageId, 'analyzing', { progressText: STAGE_TEXT[s], stage: s })
  }

  try {
    const eligibility = analysisEligibility(image)
    if (!eligibility.supported) throw new Error(eligibility.reason)
    const read = await analyzeImage({
      image,
      patient: study.patient,
      settings,
      signal: controller.signal,
      onProgress: (text) => {
        if (current()) throttle(studyId, imageId, text)
      },
      onStage: stage,
    })
    const currentImage = useApp.getState().studies.find((s) => s.id === studyId)?.images.find((i) => i.id === imageId)
    if (!currentImage) return
    const currentEligibility = analysisEligibility(currentImage)
    if (!currentEligibility.supported) throw new Error(currentEligibility.reason)
    let result = read
    if (!isCrossSectional(image)) {
      stage('cross-check')
      const small = await classifierImage(image)
      result = await crossCheck(image, read, controller.signal, small)
      if (settings.maira.enabled && (await mairaHealth()).loaded) {
        stage('second-reader')
        result = await withSecondReader(image, result, settings, controller.signal, small)
      }
    }
    if (!current()) return
    useApp.getState().setImageAnalysis(studyId, imageId, result)
    notify(studyId, imageId, `${image.name}: analysis complete`, 'success')
  } catch (err) {
    if (!current()) return
    if (controller.signal.aborted) {
      useApp.getState().setImageStatus(studyId, imageId, 'idle')
    } else {
      useApp.getState().setImageStatus(studyId, imageId, 'error', { error: errorMessage(err) })
      notify(studyId, imageId, `${image.name}: analysis failed`, 'error')
    }
  } finally {
    if (current()) {
      controllers.delete(imageId)
      lastProgress.delete(imageId)
    }
  }
}

/**
 * MAIRA-2 adds findings for the classes MedGemma misses; only the added findings are cross-checked again.
 * Gated by the classifier: without a working cross-check nothing is added (the fusion only helped when filtered).
 */
async function withSecondReader(
  image: StudyImage,
  analysis: AnalysisResult,
  settings: Settings,
  signal?: AbortSignal,
  dataUrl?: string,
): Promise<AnalysisResult> {
  // Analyses saved before classifierStatus existed count as checked when any finding carries a check.
  const checkedBefore = analysis.classifierStatus === 'ok' || (!analysis.classifierStatus && analysis.findings.some((f) => f.classifier))
  if (!checkedBefore) {
    return {
      ...analysis,
      secondReader: {
        status: 'unavailable',
        added: 0,
        ranAt: Date.now(),
        message: 'Skipped: the second reader needs the classifier cross-check, which is unavailable.',
      },
    }
  }
  const before = new Set(analysis.findings.map((f) => f.id))
  const merged = await augment(image, analysis, settings, signal, dataUrl)
  const added = merged.findings.filter((f) => !before.has(f.id))
  if (!added.length) return merged
  const checked = await crossCheck(image, { ...merged, findings: added }, signal, dataUrl)
  if (checked.classifierStatus !== 'ok') {
    return {
      ...analysis,
      secondReader: {
        status: 'error',
        added: 0,
        ranAt: Date.now(),
        message: `Nothing added: second-reader findings could not be cross-checked (${checked.classifierMessage ?? 'classifier unavailable'}).`,
      },
    }
  }
  // Same rule as benchmark/fuse.py: a second-reader finding is added only when the classifier supports it.
  const byId = new Map(checked.findings.map((f) => [f.id, f]))
  const rejected = new Set(checked.findings.filter((f) => f.classifier?.supported === false).map((f) => f.id))
  const kept = added.length - rejected.size
  return {
    ...merged,
    findings: merged.findings.filter((f) => !rejected.has(f.id)).map((f) => byId.get(f.id) ?? f),
    secondReader: {
      ...(merged.secondReader ?? { status: 'ok', ranAt: Date.now() }),
      added: kept,
      ...(rejected.size ? { message: `${rejected.size} second-reader finding${rejected.size === 1 ? '' : 's'} not added: the classifier did not support ${rejected.size === 1 ? 'it' : 'them'}.` } : {}),
    },
  }
}

// ---- queue helpers ---------------------------------------------------------

// ≤1024px JPEG for the side services; the full image if re-encoding fails.
const classifierImage = (image: StudyImage) => reencodeForClassifier(image.dataUrl).catch(() => image.dataUrl)

// Aborts only; the run's own finally removes the controller once it has reset the image status.
function cancelImage(imageId: string): void {
  controllers.get(imageId)?.abort()
}

function throttle(studyId: string, imageId: string, text: string): void {
  const now = Date.now()
  if (now - (lastProgress.get(imageId) ?? 0) < 180) return
  lastProgress.set(imageId, now)
  useApp.getState().setImageStatus(studyId, imageId, 'analyzing', { progressText: text })
}

/** Completion toast for images the user is not looking at, with a jump to the image. */
function notify(studyId: string, imageId: string, text: string, kind: 'success' | 'error'): void {
  if (useApp.getState().activeImageId === imageId) return
  toast(text, kind, {
    label: 'View',
    run: () => {
      useApp.getState().selectStudy(studyId)
      useApp.getState().selectImage(imageId)
    },
  })
}

// ---- Public actions --------------------------------------------------------

export function runAnalysisForStudy(studyId: string): void {
  const study = useApp.getState().studies.find((s) => s.id === studyId)
  if (!study) return
  for (const image of study.images) {
    if (image.status !== 'done' && image.status !== 'analyzing') {
      runAnalysis(studyId, image.id)
    }
  }
}

export function cancelAnalysis(imageId: string): void {
  cancelImage(imageId)
}

export function cancelImages(ids: string[]): void {
  ids.forEach(cancelImage)
}

export function isAnalyzing(imageId: string): boolean {
  return controllers.has(imageId)
}

/**
 * Run MAIRA-2 over every analysed image of a study (serially: one model, one GPU), cross-checking what it adds.
 * Images re-analysed meanwhile are left alone.
 */
export async function runSecondReader(studyId: string): Promise<{ added: number; status: string }> {
  const eligible = useApp.getState().studies.find((s) => s.id === studyId)?.images.some((image) => image.status === 'done' && image.analysis && analysisEligibility(image).supported && !isCrossSectional(image))
  if (!eligible) return { added: 0, status: 'unsupported' }
  const health = await mairaHealth()
  if (!health.running) return { added: 0, status: 'unavailable' }
  if (!health.loaded) return { added: 0, status: 'not-loaded' }
  // The batch action is an explicit request, so it runs even when the per-image setting is off.
  const base = useApp.getState().settings
  const settings: Settings = { ...base, maira: { ...base.maira, enabled: true } }
  const study = useApp.getState().studies.find((s) => s.id === studyId)
  let added = 0
  let status = 'ok'
  for (const image of study?.images ?? []) {
    if (image.status !== 'done' || !image.analysis || !analysisEligibility(image).supported || isCrossSectional(image)) continue
    const small = await classifierImage(image)
    const result = await withSecondReader(image, image.analysis, settings, undefined, small)
    const now = useApp.getState().studies.find((s) => s.id === studyId)?.images.find((i) => i.id === image.id)
    if (now?.status !== 'done' || now.analysis?.createdAt !== image.analysis.createdAt || !analysisEligibility(now).supported) continue
    // Keep review decisions made while MAIRA-2 was running.
    const reviews = new Map(now.analysis.findings.map((f) => [f.id, f.review]))
    useApp.getState().setImageAnalysis(studyId, image.id, {
      ...result,
      findings: result.findings.map((f) => (reviews.has(f.id) ? { ...f, review: reviews.get(f.id) } : f)),
    })
    added += result.secondReader?.added ?? 0
    if (result.secondReader && result.secondReader.status !== 'ok') status = result.secondReader.status
  }
  return { added, status }
}

// ---- Report generation -----------------------------------------------------

// Pure and node-tested; they live with the review helpers.
export { reportSourceKey, reportTraceLines } from './classifier'

export const useReportJob = create<{ running: boolean; progressText?: string; error?: string }>()(() => ({
  running: false,
}))

/** Generate a formal report from all analysed images of a study and write it into the store. */
export async function generateStudyReport(studyId: string): Promise<void> {
  const study = useApp.getState().studies.find((s) => s.id === studyId)
  if (!study) return

  cancelReport()
  const controller = new AbortController()
  reportController = controller
  useReportJob.setState({ running: true, progressText: 'Compiling…', error: undefined })
  // Keyed on the inputs at the start: changes made while drafting leave the new draft stale, as they should.
  const sourceKey = reportSourceKey(study)

  try {
    const settings = useApp.getState().settings
    const fields = await generateReport({
      study,
      settings,
      signal: controller.signal,
      onProgress: (text) => useReportJob.setState({ progressText: text }),
    })
    const trace = reportTraceLines(study)
    const recommendations = [fields.recommendations.trim(), ...trace].filter(Boolean).join('\n')
    const prev = useApp.getState().studies.find((s) => s.id === studyId)?.report
    // Kept for Undo after Regenerate (one level deep).
    const previous = prev && (prev.findings || prev.impression) ? stripPrevious(prev) : undefined
    useApp.getState().setReport(studyId, {
      ...fields,
      recommendations,
      generated: true,
      signed: false,
      radiologist: settings.radiologist,
      sourceKey,
      edited: false,
      previous,
    })
    useReportJob.setState({ running: false, progressText: undefined, error: undefined })
  } catch (err) {
    // A newer generation replaced this one: leave its job state alone.
    if (reportController && reportController !== controller) return
    if (controller.signal.aborted) useReportJob.setState({ running: false, error: 'Report cancelled.' })
    else useReportJob.setState({ running: false, error: errorMessage(err) })
  } finally {
    if (reportController === controller) reportController = undefined
  }
}

function stripPrevious(r: ReportDraft): Omit<ReportDraft, 'previous'> {
  const out = { ...r }
  delete out.previous
  return out
}

export function cancelReport(): void {
  reportController?.abort()
  reportController = undefined
  useReportJob.setState({ running: false, error: undefined })
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Operation failed.'
}
