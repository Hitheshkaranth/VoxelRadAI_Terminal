// Shared domain contract. Every module builds against these types — change them only with care.

export type Severity = 'critical' | 'significant' | 'moderate' | 'minor' | 'normal'

export const SEVERITY_ORDER: Severity[] = ['critical', 'significant', 'moderate', 'minor', 'normal']

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  significant: 'Significant',
  moderate: 'Moderate',
  minor: 'Minor',
  normal: 'Normal',
}

/** Bounding box normalized to the image: 0..1 on both axes, origin top-left. */
export interface BBox {
  x: number
  y: number
  w: number
  h: number
}

/** Which reader produced a finding. */
export type FindingSource = 'medgemma' | 'maira2'

/** Radiologist's decision on a finding; absent = not yet reviewed. */
export type FindingReview = 'accepted' | 'dismissed'

export interface Finding {
  id: string
  /** Short radiological label, e.g. "Right lower lobe consolidation". */
  title: string
  /** 1–3 sentence radiological description. */
  description: string
  severity: Severity
  /** Model's self-reported confidence, 0..1. */
  confidence: number
  /** Anatomical location, e.g. "Right lower zone". */
  location: string
  /** Approximate region on the image, if the model could localize it. */
  bbox?: BBox
  /** Outline mask over the whole image (PNG data URL, white = finding), from readers that segment (Skanda). */
  mask?: string
  /** e.g. "Lungs", "Pleura", "Cardiomediastinal", "Bones", "Devices", "Soft tissue". */
  category?: string
  /** Optional finding-specific follow-up. */
  recommendation?: string
  /** TorchXRayVision cross-check; absent when the service is not running or the finding type is unrelated. */
  classifier?: ClassifierCheck
  /** Absent = MedGemma (primary reader). */
  source?: FindingSource
  /** Radiologist's accept/dismiss decision; overrides the classifier's exclusion. */
  review?: FindingReview
}

export interface ClassifierCheck {
  kind: string
  /** Raw classifier probability for this finding type; null when the type is not covered. */
  prob: number | null
  /** Operating point the probability was compared against. */
  thr?: number
  /** 'tuned' = per-class threshold from the ChestX-Det dev split; 'default' = 0.5. */
  thrSource?: 'tuned' | 'default'
  /** Probability mapped to observed positive rate on dev data (absent without calibration knots). */
  calibrated?: number
  /** false → classifier does not support the finding (excluded from the draft unless accepted); null → not covered. */
  supported: boolean | null
  /** e.g. 'not covered'. */
  reason?: string
}

/** Classifier activation map for one finding type: where its score comes from (a coarse hint, not a localisation). */
export interface Heatmap {
  w: number
  h: number
  /** base64 of w×h row-major uint8 values, 0–255. */
  data: string
  /** Area of the original image the map covers (the classifier's centre crop), normalised 0–1. */
  extent: { x: number; y: number; w: number; h: number }
}

export interface AnalysisResult {
  modality: string // "Radiograph (X-ray)"
  bodyPart: string // "Chest"
  view: string // "PA", "AP", "Lateral", ...
  imageQuality: string // "Adequate; mild rotation"
  findings: Finding[]
  /** Normal structures explicitly reviewed, e.g. "No pneumothorax". */
  pertinentNegatives: string[]
  impression: string
  recommendations: string[]
  differential: string[]
  /** Overall urgency derived from the worst finding. */
  urgency: 'routine' | 'priority' | 'urgent'
  rawText: string
  /** Model output hit the token limit; findings may be incomplete. */
  truncated?: boolean
  /** Outcome of the TorchXRayVision cross-check for this image. */
  classifierStatus?: 'ok' | 'unavailable' | 'error'
  classifierMessage?: string
  /** All classifier probabilities returned for the image, keyed by pathology. */
  classifierProbs?: Record<string, number>
  /** Classifier heatmaps keyed by finding type (ClassifierCheck.kind). */
  heatmaps?: Record<string, Heatmap>
  /** Optional MAIRA-2 second reader for the classes MedGemma misses. */
  secondReader?: { status: 'ok' | 'unavailable' | 'not-loaded' | 'error'; added: number; ranAt: number; message?: string }
  model: string
  durationMs: number
  createdAt: number
}

export type ImageStatus = 'idle' | 'analyzing' | 'done' | 'error'

export type AnalysisStage = 'queued' | 'reading' | 'retry' | 'lung-pattern' | 'cross-check' | 'second-reader'

export interface StudyImage {
  id: string
  name: string
  mime: string
  /** Downscaled (max 1536px long edge) data URL used for display and inference. */
  dataUrl: string
  width: number
  height: number
  addedAt: number
  status: ImageStatus
  /** Live progress text while analyzing (e.g. streamed token count / stage). */
  progressText?: string
  /** Pipeline stage while analyzing (transient, not persisted). */
  stage?: AnalysisStage
  /** When the current analysis started (transient, not persisted). */
  analysisStartedAt?: number
  error?: string
  analysis?: AnalysisResult
}

export interface PatientInfo {
  name: string
  patientId: string
  age: string
  sex: '' | 'Male' | 'Female' | 'Other'
  studyDate: string // yyyy-mm-dd
  referringPhysician: string
  indication: string // clinical indication / reason for exam
  clinicalHistory: string
}

export interface ReportDraft {
  technique: string
  comparison: string
  findings: string
  impression: string
  recommendations: string
  radiologist: string
  signed: boolean
  signedAt?: number
  /** True once generated by the model; user edits keep it true. */
  generated: boolean
  updatedAt: number
  /** reportSourceKey() of the study when the draft was generated; differs → draft is stale. */
  sourceKey?: string
  /** User edited the draft since it was generated. */
  edited?: boolean
  /** Patient details frozen at sign-off. */
  patientSnapshot?: PatientInfo
  /** Pre-sign checklist items the reviewer signed past ("Sign anyway"). */
  signOverrides?: string[]
  /** Each unlock of a signed report. */
  amendments?: { signedAt: number; unlockedAt: number; by: string }[]
  /** Draft before the last Regenerate, for undo. */
  previous?: Omit<ReportDraft, 'previous'>
}

export interface Study {
  id: string
  title: string
  patient: PatientInfo
  images: StudyImage[]
  report?: ReportDraft
  createdAt: number
  updatedAt: number
}

export interface Settings {
  /** OpenAI-compatible base URL. Default '/lmstudio/v1' (Vite proxy to localhost:1234). */
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
  institution: string
  radiologist: string
  theme: 'system' | 'light' | 'dark'
  /** Optional MAIRA-2 second reader; kinds are txrv kinds it may add. */
  maira: { enabled: boolean; kinds: string[] }
}

export interface ViewerState {
  zoom: number // 1 = fit
  panX: number // px
  panY: number // px
  brightness: number // 100 = neutral (percent)
  contrast: number // 100 = neutral (percent)
  invert: boolean
  showOverlay: boolean
  /** Classifier heatmap for the selected finding. */
  showHeatmap: boolean
  /** How findings with an outline mask are drawn: box only, mask outline, or filled mask with its outline. */
  overlayStyle: OverlayStyle
  /** Fill opacity of mask overlays, 0..1. */
  overlayOpacity: number
  /** Before/after divider: overlays only to the right of comparePos (0..1 of the image width). */
  compare: boolean
  comparePos: number
  /** Findings hidden from the image (ids), e.g. to see what lies under one outline. */
  hiddenFindings: string[]
}

export type OverlayStyle = 'box' | 'outline' | 'fill'

export type InspectorTab = 'findings' | 'report'

export type ConnectionState = 'unknown' | 'checking' | 'online' | 'offline' | 'model-missing'
