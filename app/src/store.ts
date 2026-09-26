import { create } from 'zustand'
import { get as idbGet, set as idbSet } from 'idb-keyval'
import type {
  AnalysisResult,
  ConnectionState,
  ImageStatus,
  InspectorTab,
  PatientInfo,
  ReportDraft,
  Settings,
  Study,
  StudyImage,
  ViewerState,
} from './types'

export const uid = () => crypto.randomUUID()

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: '/lmstudio/v1',
  model: 'medgemma-27b-it',
  temperature: 0.2,
  maxTokens: 3072,
  institution: 'Skanda Radiology',
  radiologist: '',
  theme: 'system',
}

export const DEFAULT_VIEWER: ViewerState = {
  zoom: 1,
  panX: 0,
  panY: 0,
  brightness: 100,
  contrast: 100,
  invert: false,
  showOverlay: true,
}

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
  selectImage: (imageId: string) => void
  setImageStatus: (studyId: string, imageId: string, status: ImageStatus, extra?: { progressText?: string; error?: string }) => void
  setImageAnalysis: (studyId: string, imageId: string, analysis: AnalysisResult) => void

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
      activeImageId: images[0]?.id ?? st.activeImageId,
      selectedFindingId: null,
    })),
  removeImage: (studyId, imageId) =>
    set((st) => {
      const studies = mapStudy(st.studies, studyId, (s) => ({ ...s, images: s.images.filter((i) => i.id !== imageId) }))
      const imgs = studies.find((s) => s.id === studyId)?.images ?? []
      return { studies, activeImageId: st.activeImageId === imageId ? (imgs[0]?.id ?? null) : st.activeImageId }
    }),
  selectImage: (imageId) => set({ activeImageId: imageId, selectedFindingId: null, viewer: DEFAULT_VIEWER }),
  setImageStatus: (studyId, imageId, status, extra) =>
    set((st) => ({
      studies: mapStudy(st.studies, studyId, (s) => ({
        ...s,
        images: s.images.map((i) =>
          i.id === imageId ? { ...i, status, progressText: extra?.progressText, error: extra?.error } : i,
        ),
      })),
    })),
  setImageAnalysis: (studyId, imageId, analysis) =>
    set((st) => ({
      studies: mapStudy(st.studies, studyId, (s) => ({
        ...s,
        images: s.images.map((i) =>
          i.id === imageId ? { ...i, analysis, status: 'done', progressText: undefined, error: undefined } : i,
        ),
      })),
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
  resetViewer: () => set({ viewer: DEFAULT_VIEWER }),
  updateSettings: (patch) => set((st) => ({ settings: { ...st.settings, ...patch } })),
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

export async function hydrate() {
  try {
    const saved = (await idbGet(KEY)) as
      | { studies: Study[]; settings: Settings; activeStudyId: string | null }
      | undefined
    if (saved) {
      // Any analysis interrupted by a reload can't resume.
      const studies = saved.studies.map((s) => ({
        ...s,
        images: s.images.map((i) =>
          i.status === 'analyzing' ? { ...i, status: 'idle' as const, progressText: undefined } : i,
        ),
      }))
      const activeStudyId = saved.activeStudyId ?? studies[0]?.id ?? null
      useApp.setState({
        studies,
        settings: { ...DEFAULT_SETTINGS, ...saved.settings },
        activeStudyId,
        activeImageId: studies.find((s) => s.id === activeStudyId)?.images[0]?.id ?? null,
      })
    }
  } catch (e) {
    console.warn('Failed to restore saved studies', e)
  }
  useApp.setState({ hydrated: true })

  let t: ReturnType<typeof setTimeout> | undefined
  useApp.subscribe((st, prev) => {
    if (st.studies === prev.studies && st.settings === prev.settings && st.activeStudyId === prev.activeStudyId) return
    clearTimeout(t)
    t = setTimeout(() => {
      idbSet(KEY, { studies: st.studies, settings: st.settings, activeStudyId: st.activeStudyId }).catch((e) =>
        console.warn('Failed to save', e),
      )
    }, 400)
  })
}
