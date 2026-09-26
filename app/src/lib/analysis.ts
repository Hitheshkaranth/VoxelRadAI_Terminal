// OWNER: Agent 1 (AI engine). Store-bound orchestration the UI calls.
import { create } from 'zustand'
import { useApp } from '../store'
import { analyzeImage, generateReport } from './medgemma'

const controllers = new Map<string, AbortController>()
const lastProgress = new Map<string, number>()
let reportController: AbortController | undefined

// ---- per-image analysis ----------------------------------------------------

/**
 * Analyse one image. Idempotent: if it is already analysing or done, this call is a no-op.
 * Streams progress back into the store, throttled to ~5 updates/s.
 */
export function runAnalysis(studyId: string, imageId: string): void {
  const study = useApp.getState().studies.find((s) => s.id === studyId)
  const image = study?.images.find((i) => i.id === imageId)
  if (!study || !image || image.status === 'done' || image.status === 'analyzing') return

  cancelImage(imageId)
  const controller = new AbortController()
  controllers.set(imageId, controller)
  lastProgress.set(imageId, 0) // force an immediate first update
  useApp.getState().setImageStatus(studyId, imageId, 'analyzing', { progressText: 'Queued' })
  void runStudyImage(studyId, imageId, controller)
}

async function runStudyImage(studyId: string, imageId: string, controller: AbortController): Promise<void> {
  const study = useApp.getState().studies.find((s) => s.id === studyId)
  const image = study?.images.find((i) => i.id === imageId)
  if (!study || !image) return
  const settings = useApp.getState().settings

  try {
    useApp.getState().setImageStatus(studyId, imageId, 'analyzing', { progressText: 'Analyzing…' })
    const result = await analyzeImage({
      image,
      patient: study.patient,
      settings,
      signal: controller.signal,
      onProgress: (text) => throttle(studyId, imageId, text),
    })
    useApp.getState().setImageStatus(studyId, imageId, 'done')
    useApp.getState().setImageAnalysis(studyId, imageId, result)
    // If this is the active image, leave any selection as-is (null stays null).
  } catch (err) {
    if (controller.signal.aborted) {
      useApp.getState().setImageStatus(studyId, imageId, 'idle')
    } else {
      useApp.getState().setImageStatus(studyId, imageId, 'error', { error: errorMessage(err) })
    }
  } finally {
    controllers.delete(imageId)
    lastProgress.delete(imageId)
  }
}

// ---- queue helpers ---------------------------------------------------------

function cancelImage(imageId: string): void {
  controllers.get(imageId)?.abort()
  controllers.delete(imageId)
}

function throttle(studyId: string, imageId: string, text: string): void {
  const now = Date.now()
  if (now - (lastProgress.get(imageId) ?? 0) < 180) return
  lastProgress.set(imageId, now)
  useApp.getState().setImageStatus(studyId, imageId, 'analyzing', { progressText: text })
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

export function isAnalyzing(imageId: string): boolean {
  return controllers.has(imageId)
}

// ---- Report generation -----------------------------------------------------

export const useReportJob = create<{ running: boolean; progressText?: string; error?: string }>()(() => ({
  running: false,
}))

/**
 * Generate a formal report from all analysed images of a study and write it into the store.
 * Agent 4 (Report UI) imports this, `cancelReport`, and `useReportJob`.
 */
export async function generateStudyReport(studyId: string): Promise<void> {
  const study = useApp.getState().studies.find((s) => s.id === studyId)
  if (!study) return

  cancelReport()
  const controller = new AbortController()
  reportController = controller
  useReportJob.setState({ running: true, progressText: 'Compiling…', error: undefined })

  try {
    const settings = useApp.getState().settings
    const fields = await generateReport({
      study,
      settings,
      signal: controller.signal,
      onProgress: (text) => useReportJob.setState({ progressText: text }),
    })
    useApp.getState().setReport(studyId, { ...fields, generated: true, signed: false, radiologist: settings.radiologist })
    useReportJob.setState({ running: false, progressText: undefined, error: undefined })
  } catch (err) {
    if (controller.signal.aborted) useReportJob.setState({ running: false, error: 'Report cancelled.' })
    else useReportJob.setState({ running: false, error: errorMessage(err) })
  } finally {
    reportController = undefined
  }
}

export function cancelReport(): void {
  reportController?.abort()
  reportController = undefined
  useReportJob.setState({ running: false, error: undefined })
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Operation failed.'
}