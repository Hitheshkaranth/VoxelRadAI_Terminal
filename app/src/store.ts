import { create } from 'zustand'
import { readThemePreference, saveThemePreference } from './lib/theme'
import { workspaceGet as idbGet, workspaceSet as idbSet } from './lib/workspaceStorage'
import { toast } from './components/shell/toastStore'
import type {
  ImageMeasurement,
  AnalysisResult,
  AnalysisStage,
  ConnectionState,
  FindingReview,
  ImageStatus,
  InspectorTab,
  PatientInfo,
  ReportDraft,
  Settings,
  Study,
  StudyImage,
  ViewerState,
} from './types'

// crypto.randomUUID exists only in secure contexts (https, localhost); opened over the LAN or a tailnet by plain http
// the app would fail to create a study, so fall back to getRandomValues, which works everywhere.
export const uid = (): string => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: '/lmstudio/v1',
  model: 'skanda-grounding-q3-mixed',
  temperature: 0.2,
  maxTokens: 3072,
  institution: 'VoxelRad AI',
  radiologist: '',
  theme: readThemePreference() ?? 'dark',
  material: 'glass',
  maira: { enabled: false, kinds: ['effusion', 'nodule / mass', 'atelectasis'] },
}

export const DEFAULT_VIEWER: ViewerState = {
  zoom: 1,
  panX: 0,
  panY: 0,
  brightness: 100,
  contrast: 100,
  invert: false,
  showOverlay: true,
  showHeatmap: true,
  overlayStyle: 'outline',
  overlayOpacity: 0.35,
  compare: false,
  comparePos: 0.5,
  hiddenFindings: [],
}

/** Display preferences that survive switching images or resetting the view (zoom, window and hidden findings do not). */
const keepDisplay = (v: ViewerState): ViewerState => ({
  ...DEFAULT_VIEWER,
  overlayStyle: v.overlayStyle,
  overlayOpacity: v.overlayOpacity,
})

export const emptyPatient = (): PatientInfo => ({
  name: '',
  patientId: '',
  age: '',
  sex: '',
  studyDate: new Date().toISOString().slice(0, 10),
  referringPhysician: '',
  indication: '',
  clinicalHistory: '',
})

export const newStudy = (title = 'Untitled Study'): Study => ({
  id: uid(),
  title,
  patient: emptyPatient(),
  images: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

interface AppState {
  hydrated: boolean
  studies: Study[]
  activeStudyId: string | null
  activeImageId: string | null
  selectedFindingId: string | null
  hoveredFindingId: string | null
  inspectorTab: InspectorTab
  viewer: ViewerState
  settings: Settings
  connection: ConnectionState
  /** Which modal sheet is open. */
  sheet: null | 'patient' | 'settings'

  // Studies
  createStudy: (title?: string) => string
  deleteStudy: (id: string) => void
  selectStudy: (id: string) => void
  renameStudy: (id: string, title: string) => void
  updatePatient: (studyId: string, patch: Partial<PatientInfo>) => void

  // Images
  addImages: (studyId: string, images: StudyImage[]) => void
  removeImage: (studyId: string, imageId: string) => void
  setImageModality: (studyId: string, imageId: string, modality: string) => void
  selectImage: (imageId: string) => void
  setImageStatus: (
    studyId: string,
    imageId: string,
    status: ImageStatus,
    extra?: { progressText?: string; error?: string; stage?: AnalysisStage; analysisStartedAt?: number },
  ) => void
  setImageAnalysis: (studyId: string, imageId: string, analysis: AnalysisResult) => void
  /** Accept or dismiss a finding; undefined clears the decision. */
  setFindingReview: (studyId: string, imageId: string, findingId: string, review: FindingReview | undefined) => void
  /** Replace an image's manual measurements. */
  setImageMeasurements: (studyId: string, imageId: string, measurements: ImageMeasurement[]) => void
  /** Drop an image's analysis so it can be re-run. */
  resetImageAnalysis: (studyId: string, imageId: string) => void

  // Findings selection
  selectFinding: (id: string | null) => void
  hoverFinding: (id: string | null) => void

  // Report
  setReport: (studyId: string, patch: Partial<ReportDraft>) => void

  // UI
  setInspectorTab: (tab: InspectorTab) => void
  setViewer: (patch: Partial<ViewerState>) => void
  resetViewer: () => void
  updateSettings: (patch: Partial<Settings>) => void
  setConnection: (c: ConnectionState) => void
  openSheet: (s: AppState['sheet']) => void
}

const touch = (s: Study): Study => ({ ...s, updatedAt: Date.now() })

const mapStudy = (studies: Study[], id: string, fn: (s: Study) => Study) =>
  studies.map((s) => (s.id === id ? touch(fn(s)) : s))

export const useApp = create<AppState>()((set, get) => ({
  hydrated: false,
  studies: [],
  activeStudyId: null,
  activeImageId: null,
  selectedFindingId: null,
  hoveredFindingId: null,
  inspectorTab: 'findings',
  viewer: DEFAULT_VIEWER,
  settings: DEFAULT_SETTINGS,
  connection: 'unknown',
  sheet: null,

  createStudy: (title) => {
    const s = newStudy(title)
    set((st) => ({ studies: [s, ...st.studies], activeStudyId: s.id, activeImageId: null, selectedFindingId: null }))
    return s.id
  },
  deleteStudy: (id) =>
    set((st) => {
      const studies = st.studies.filter((s) => s.id !== id)
      const active = st.activeStudyId === id ? (studies[0]?.id ?? null) : st.activeStudyId
      return { studies, activeStudyId: active, activeImageId: studies.find((s) => s.id === active)?.images[0]?.id ?? null }
    }),
  selectStudy: (id) =>
    set((st) => ({
      activeStudyId: id,
      activeImageId: st.studies.find((s) => s.id === id)?.images[0]?.id ?? null,
      selectedFindingId: null,
      viewer: DEFAULT_VIEWER,
    })),
  renameStudy: (id, title) => set((st) => ({ studies: mapStudy(st.studies, id, (s) => ({ ...s, title })) })),
  updatePatient: (studyId, patch) =>
    set((st) => ({ studies: mapStudy(st.studies, studyId, (s) => ({ ...s, patient: { ...s.patient, ...patch } })) })),

  addImages: (studyId, images) =>
    set((st) => ({
      studies: mapStudy(st.studies, studyId, (s) => ({ ...s, images: [...s.images, ...images] })),
      // An import that finishes after the user switched studies must not hijack the open study's selection.
      activeImageId: studyId === st.activeStudyId ? (images[0]?.id ?? st.activeImageId) : st.activeImageId,
      selectedFindingId: studyId === st.activeStudyId ? null : st.selectedFindingId,
    })),
  removeImage: (studyId, imageId) =>
    set((st) => {
      const studies = mapStudy(st.studies, studyId, (s) => ({ ...s, images: s.images.filter((i) => i.id !== imageId) }))
      const imgs = studies.find((s) => s.id === studyId)?.images ?? []
      return { studies, activeImageId: st.activeImageId === imageId ? (imgs[0]?.id ?? null) : st.activeImageId }
    }),
  setImageModality: (studyId, imageId, modality) => set((st) => ({
    studies: mapStudy(st.studies, studyId, (study) => {
      if (study.report) return study
      return { ...study, images: study.images.map((image) =>
        image.id === imageId && !image.analysis && image.status !== 'analyzing' && image.sourceFrameCount === undefined
          ? { ...image, sourceModality: modality || undefined, sourceBodyPart: modality === 'CR' ? 'CHEST' : undefined, status: 'idle' as const, error: undefined }
          : image) }
    }),
  })),
  selectImage: (imageId) => set((st) => ({ activeImageId: imageId, selectedFindingId: null, viewer: keepDisplay(st.viewer) })),
  setImageStatus: (studyId, imageId, status, extra) =>
    set((st) => ({
      studies: mapStudy(st.studies, studyId, (s) => ({
        ...s,
        images: s.images.map((i) =>
          i.id === imageId
            ? {
                ...i,
                status,
                progressText: extra?.progressText,
                error: extra?.error,
                // Stage and start time carry over between progress updates of the same run.
                stage: status === 'analyzing' ? (extra?.stage ?? i.stage) : undefined,
                analysisStartedAt: status === 'analyzing' ? (extra?.analysisStartedAt ?? i.analysisStartedAt) : undefined,
              }
            : i,
        ),
      })),
    })),
  setImageAnalysis: (studyId, imageId, analysis) =>
    set((st) => ({
      studies: mapStudy(st.studies, studyId, (s) => ({
        ...s,
        images: s.images.map((i) =>
          i.id === imageId
            ? { ...i, analysis, status: 'done', progressText: undefined, error: undefined, stage: undefined, analysisStartedAt: undefined }
            : i,
        ),
      })),
    })),
  setFindingReview: (studyId, imageId, findingId, review) =>
    set((st) => ({
      studies: mapStudy(st.studies, studyId, (s) => ({
        ...s,
        images: s.images.map((i) =>
          i.id === imageId && i.analysis
            ? {
                ...i,
                analysis: {
                  ...i.analysis,
                  findings: i.analysis.findings.map((f) => (f.id === findingId ? { ...f, review } : f)),
                },
              }
            : i,
        ),
      })),
    })),
  setImageMeasurements: (studyId, imageId, measurements) =>
    set((st) => ({
      studies: mapStudy(st.studies, studyId, (s) => ({
        ...s,
        images: s.images.map((i) => (i.id === imageId ? { ...i, measurements: measurements.length ? measurements : undefined } : i)),
      })),
    })),
  resetImageAnalysis: (studyId, imageId) =>
    set((st) => ({
      studies: mapStudy(st.studies, studyId, (s) => ({
        ...s,
        images: s.images.map((i) =>
          i.id === imageId
            ? { ...i, analysis: undefined, status: 'idle', progressText: undefined, error: undefined, stage: undefined, analysisStartedAt: undefined }
            : i,
        ),
      })),
      selectedFindingId: null,
    })),

  selectFinding: (id) => set({ selectedFindingId: id }),
  hoverFinding: (id) => set({ hoveredFindingId: id }),

  setReport: (studyId, patch) =>
    set((st) => ({
      studies: mapStudy(st.studies, studyId, (s) => ({
        ...s,
        report: {
          technique: '',
          comparison: '',
          findings: '',
          impression: '',
          recommendations: '',
          radiologist: get().settings.radiologist,
          signed: false,
          generated: false,
          ...s.report,
          ...patch,
          updatedAt: Date.now(),
        },
      })),
    })),

  setInspectorTab: (tab) => set({ inspectorTab: tab }),
  setViewer: (patch) => set((st) => ({ viewer: { ...st.viewer, ...patch } })),
  resetViewer: () => set((st) => ({ viewer: keepDisplay(st.viewer) })),
  updateSettings: (patch) => {
    if (patch.theme) saveThemePreference(patch.theme)
    set((st) => ({ settings: { ...st.settings, ...patch } }))
  },
  setConnection: (connection) => set({ connection }),
  openSheet: (sheet) => set({ sheet }),
}))

// ---- Selectors -------------------------------------------------------------

export const useActiveStudy = () => useApp((s) => s.studies.find((x) => x.id === s.activeStudyId) ?? null)

export const useActiveImage = () =>
  useApp((s) => {
    const study = s.studies.find((x) => x.id === s.activeStudyId)
    return study?.images.find((i) => i.id === s.activeImageId) ?? null
  })

// ---- Persistence (IndexedDB) ------------------------------------------------

const KEY = 'skanda-radiology:v1'

type Saved = { studies: Study[]; settings: Settings; activeStudyId: string | null }

// Progress text, stage and start time describe a live run; an interrupted run can't resume after reload.
const stripImage = (i: StudyImage): StudyImage => {
  if (i.status !== 'analyzing' && i.progressText === undefined && i.stage === undefined && i.analysisStartedAt === undefined)
    return i
  const out: StudyImage = { ...i, status: i.status === 'analyzing' ? 'idle' : i.status }
  delete out.progressText
  delete out.stage
  delete out.analysisStartedAt
  return out
}

// Cache per study object so unchanged studies (and transient-only changes) compare by reference.
const stripCache = new WeakMap<Study, Study>()
const stripStudy = (s: Study): Study => {
  const hit = stripCache.get(s)
  if (hit) return hit
  const images = s.images.map(stripImage)
  const out = images.every((im, k) => im === s.images[k]) ? s : { ...s, images }
  stripCache.set(s, out)
  return out
}

// A study whose only change is transient fields keeps updatedAt from touch(); ignore updatedAt when comparing.
const sameStudy = (a: Study, b: Study) => {
  if (a === b) return true
  if (a.id !== b.id || a.title !== b.title || a.patient !== b.patient || a.report !== b.report) return false
  if (a.images.length !== b.images.length) return false
  return a.images.every((im, k) => sameImage(im, b.images[k]))
}

// Stripped images of an analysing film are new objects on every progress tick; compare their fields shallowly.
const sameImage = (a: StudyImage, b: StudyImage) => {
  if (a === b) return true
  const ka = Object.keys(a) as (keyof StudyImage)[]
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

export function persistedStudies(studies: Study[]): Study[] {
  return studies.map(stripStudy)
}

let hydrated = false

export async function hydrate() {
  // StrictMode calls effects twice; a second subscription would double every write.
  if (hydrated) return
  hydrated = true
  try {
    const saved = (await idbGet(KEY)) as Saved | undefined
    if (saved) {
      const studies = persistedStudies(saved.studies)
      const activeStudyId = saved.activeStudyId ?? studies[0]?.id ?? null
      useApp.setState({
        studies,
        settings: {
          ...DEFAULT_SETTINGS,
          ...saved.settings,
          institution: saved.settings?.institution === 'Skanda Radiology' ? 'VoxelRad AI' : saved.settings?.institution ?? DEFAULT_SETTINGS.institution,
          theme: readThemePreference() ?? saved.settings?.theme ?? DEFAULT_SETTINGS.theme,
          maira: { ...DEFAULT_SETTINGS.maira, ...saved.settings?.maira },
        },
        activeStudyId,
        activeImageId: studies.find((s) => s.id === activeStudyId)?.images[0]?.id ?? null,
      })
    }
  } catch (e) {
    console.warn('Failed to restore saved studies', e)
  }
  useApp.setState({ hydrated: true })
  // Ask the browser not to evict our data under storage pressure; ignored where unsupported.
  void navigator.storage?.persist?.().catch(() => false)

  let t: ReturnType<typeof setTimeout> | undefined
  const init = useApp.getState()
  let last: Saved = { studies: persistedStudies(init.studies), settings: init.settings, activeStudyId: init.activeStudyId }
  let failing = false
  useApp.subscribe((st, prev) => {
    if (st.studies === prev.studies && st.settings === prev.settings && st.activeStudyId === prev.activeStudyId) return
    clearTimeout(t)
    t = setTimeout(() => {
      const cur = useApp.getState()
      const studies = persistedStudies(cur.studies)
      // Progress ticks during analysis only change transient fields: nothing to write.
      const same =
        studies.length === last.studies.length &&
        studies.every((s, k) => sameStudy(s, last.studies[k])) &&
        cur.settings === last.settings &&
        cur.activeStudyId === last.activeStudyId
      if (same) return
      const value: Saved = { studies, settings: cur.settings, activeStudyId: cur.activeStudyId }
      idbSet(KEY, value)
        .then(() => {
          last = value
          failing = false
        })
        .catch((e) => {
          console.warn('Failed to save', e)
          // One toast per failure streak, not one per keystroke.
          if (!failing) toast('Could not save to browser storage — recent changes may be lost. Free space or export studies.', 'error')
          failing = true
        })
    }, 400)
  })
}

/** Browser storage usage for the Settings sheet; null where the API is unavailable. */
export async function storageInfo(): Promise<{ usage: number; quota: number; persisted: boolean } | null> {
  try {
    if (!navigator.storage?.estimate) return null
    const [est, persisted] = await Promise.all([
      navigator.storage.estimate(),
      navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(false),
    ])
    return { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted }
  } catch {
    return null
  }
}
