// OWNER: Agent 4 (Report). Pure helpers for exporting the study as plain text / JSON,
// shared by ReportPanel and PrintReport. No React, no store binding.
// Imported by scripts/test-report.ts under node strip-types: runtime imports need an explicit .ts extension.
import type { AnalysisResult, Finding, PatientInfo, ReportDraft, Study } from '../types'
import { isExcluded, isUnconfirmed } from './classifier.ts'

export const DISCLAIMER =
  'AI-generated decision support; must be verified by a qualified radiologist. Not a diagnosis.'

export interface StudyExportImage {
  id: string
  name: string
  mime: string
  width: number
  height: number
  status: string
  addedAt: string
  analysis: AnalysisResult | null
  /** Only present when `includeDataUrls` is true. */
  thumbnailUrl?: string
}

export interface ReportExport {
  radiologist: string
  signed: boolean
  signedAt: string | null
  generated: boolean
  edited: boolean
  updatedAt: string
  technique: string
  comparison: string
  findings: string
  impression: string
  recommendations: string
  patientSnapshot: PatientInfo | null
  amendments: { signedAt: string; unlockedAt: string; by: string }[]
  signOverrides: string[]
}

export interface StudyExport {
  studyId: string
  title: string
  createdAt: string
  updatedAt: string
  anonymised: boolean
  patient: PatientInfo
  institution: string
  model: string
  imageCount: number
  analyzedCount: number
  images: StudyExportImage[]
  report: ReportExport | null
  disclaimer: string
}

export interface StudyJsonOptions {
  /** Blank name, patient ID and referring physician (also in the signed snapshot) and image file names. */
  anonymise?: boolean
  /** Embed each image as a data URL. Off by default: files get large. */
  includeDataUrls?: boolean
  institution?: string
}

/** Analyzed images only, in the order they appear in the study. */
export function analyzedImages(study: Study): Study['images'] {
  return study.images.filter((img) => img.analysis != null)
}

/** Best-effort summary of modality / body part / view(s) across all analyses. */
export function examSummary(study: Study): { modality: string; bodyPart: string; views: string[] } {
  const views = new Set<string>()
  let modality = ''
  let bodyPart = ''
  for (const img of analyzedImages(study)) {
    const a = img.analysis
    if (a) {
      if (!modality) modality = a.modality
      if (!bodyPart) bodyPart = a.bodyPart
      if (a.view) views.add(a.view)
    }
  }
  return { modality, bodyPart, views: [...views] }
}

/** Patient details as reported: the frozen snapshot once signed, otherwise the live record. */
export function reportPatient(study: Study): PatientInfo {
  const r = study.report
  return r?.signed && r.patientSnapshot ? r.patientSnapshot : study.patient
}

/** Why a finding was dismissed or is unconfirmed, for exports and the excluded-findings list. */
export function exclusionReason(f: Finding): string {
  if (f.review === 'dismissed') return 'dismissed by reviewer'
  const c = f.classifier
  if (!c) return 'excluded'
  const prob = c.prob == null ? '' : ` ${Math.round(c.prob * 100)}%`
  const thr = c.thr == null ? '' : ` (threshold ${Math.round(c.thr * 100)}%)`
  return `not supported by classifier cross-check: ${c.kind}${prob}${thr}`
}

export interface ReportedFinding {
  /** Image-local number matching the burned-in box labels, prefixed with the image number when >1 image. */
  ref: string
  imageId: string
  imageName: string
  finding: Finding
}

/**
 * Non-normal AI findings split into those the draft draws on and those left out of it.
 * Normal items ("No pneumothorax") are pertinent negatives, not findings, and are skipped.
 */
export function splitFindings(study: Study): { included: ReportedFinding[]; excluded: ReportedFinding[] } {
  const included: ReportedFinding[] = []
  const excluded: ReportedFinding[] = []
  const analyzed = analyzedImages(study)
  analyzed.forEach((img, imgIndex) => {
    img.analysis?.findings.forEach((f, j) => {
      if (f.severity === 'normal') return
      const ref = analyzed.length > 1 ? `${imgIndex + 1}.${j + 1}` : `${j + 1}`
      const row = { ref, imageId: img.id, imageName: img.name, finding: f }
      ;(isExcluded(f) ? excluded : included).push(row)
    })
  })
  return { included, excluded }
}

/** A stable, filesystem-friendly filename derived from the study title. */
export function studyFileName(study: Study, ext = 'txt'): string {
  const slug = (study.title || 'study')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'study'}-${new Date().toISOString().slice(0, 10)}.${ext}`
}

const ISO = (ts: number): string => new Date(ts).toISOString()

function anonymisePatient(p: PatientInfo): PatientInfo {
  return { ...p, name: '', patientId: '', referringPhysician: '' }
}

function reportExport(r: ReportDraft, anonymise: boolean): ReportExport {
  const snapshot = r.patientSnapshot ? (anonymise ? anonymisePatient(r.patientSnapshot) : r.patientSnapshot) : null
  return {
    radiologist: r.radiologist,
    signed: r.signed,
    signedAt: r.signedAt ? ISO(r.signedAt) : null,
    generated: r.generated,
    edited: !!r.edited,
    updatedAt: ISO(r.updatedAt),
    technique: r.technique,
    comparison: r.comparison,
    findings: r.findings,
    impression: r.impression,
    recommendations: r.recommendations,
    patientSnapshot: snapshot,
    amendments: (r.amendments ?? []).map((a) => ({ signedAt: ISO(a.signedAt), unlockedAt: ISO(a.unlockedAt), by: a.by })),
    signOverrides: r.signOverrides ?? [],
  }
}

export function studyToJson(study: Study, opts: StudyJsonOptions = {}): StudyExport {
  const anonymise = !!opts.anonymise
  const images: StudyExportImage[] = study.images.map((img, i) => {
    const out: StudyExportImage = {
      id: img.id,
      // File names often carry the patient's name or MRN.
      name: anonymise ? `image-${i + 1}` : img.name,
      mime: img.mime,
      width: img.width,
      height: img.height,
      status: img.status,
      addedAt: ISO(img.addedAt),
      analysis: img.analysis ?? null,
    }
    if (opts.includeDataUrls) out.thumbnailUrl = img.dataUrl
    return out
  })
  const models = new Set(analyzedImages(study).map((img) => img.analysis?.model ?? '').filter(Boolean))
  return {
    studyId: study.id,
    title: anonymise ? 'Anonymised study' : study.title,
    createdAt: ISO(study.createdAt),
    updatedAt: ISO(study.updatedAt),
    anonymised: anonymise,
    patient: anonymise ? anonymisePatient(study.patient) : study.patient,
    institution: opts.institution ?? '',
    model: [...models].join(', '),
    imageCount: study.images.length,
    analyzedCount: analyzedImages(study).length,
    images,
    report: study.report ? reportExport(study.report, anonymise) : null,
    disclaimer: DISCLAIMER,
  }
}

function trim(value: string | undefined): string {
  return (value ?? '').trim()
}

function dash(value: string | undefined): string {
  const t = trim(value)
  return t || '—'
}

function severityLabel(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1)
}

function findingLine(row: ReportedFinding): string {
  const f = row.finding
  const loc = trim(f.location) ? ' — ' + trim(f.location) : ''
  const reader = f.source === 'maira2' ? ' (MAIRA-2 second reader)' : ''
  return `${row.ref}. [${severityLabel(f.severity)}] ${trim(f.title) || '—'}${loc}${reader}`
}

/**
 * Render the report as plain text (Copy + Download .txt). Unsigned drafts are labelled as such, the
 * disclaimer is always appended, and AI findings left out of the draft are listed with the reason so
 * nothing disappears silently.
 */
export function reportToPlainText(study: Study, settings: { institution: string }): string {
  const r = study.report
  const exam = examSummary(study)
  const p = reportPatient(study)

  const out: string[] = []
  out.push(settings.institution || 'Radiology')
  out.push(r?.signed ? 'Radiology Report — AI-assisted, radiologist-signed' : 'Radiology Report — AI-assisted draft')
  out.push('Report date: ' + new Date().toLocaleDateString())
  if (r?.signed && r.signedAt) out.push('Signed: ' + new Date(r.signedAt).toLocaleString())
  if (r?.signed && r.signOverrides?.length) out.push('Signed past unresolved items: ' + r.signOverrides.join(' '))
  out.push('')

  out.push('Patient:        ' + dash(p.name))
  out.push('Patient ID:     ' + dash(p.patientId))
  const ageSex = [trim(p.age), trim(p.sex)].filter(Boolean).join(' / ')
  out.push('Age / Sex:      ' + (ageSex || '—'))
  out.push('Study Date:     ' + dash(p.studyDate))
  out.push('Referring Physician: ' + dash(p.referringPhysician))
  out.push('')

  const examLine = [exam.modality, exam.bodyPart, ...exam.views].filter(Boolean).join(' · ')
  out.push('Exam:           ' + (examLine || '—'))
  out.push('Clinical Indication: ' + dash(p.indication))
  if (trim(p.clinicalHistory)) out.push('History:        ' + trim(p.clinicalHistory))
  out.push('')

  out.push('Technique:      ' + dash(r?.technique))
  out.push('Comparison:     ' + dash(r?.comparison))
  out.push('Findings:       ' + dash(r?.findings))
  out.push('Impression:     ' + dash(r?.impression))
  out.push('Recommendations: ' + dash(r?.recommendations))
  out.push('')

  const { included, excluded } = splitFindings(study)
  if (included.length) {
    out.push('AI Findings Summary')
    out.push('-------------------')
    for (const row of included) {
      const unconfirmed = row.finding.severity !== 'normal' && isUnconfirmed(row.finding)
      out.push(findingLine(row) + (unconfirmed ? ' [unconfirmed: not supported by classifier cross-check — verify]' : ''))
      if (unconfirmed) out.push(`   Classifier: ${exclusionReason(row.finding)}`)
      out.push(`   Confidence: ${Math.round(row.finding.confidence * 100)}% (model self-reported, uncalibrated)`)
    }
    out.push('')
  }
  if (excluded.length) {
    out.push('AI findings not included in this report')
    out.push('---------------------------------------')
    for (const row of excluded) {
      out.push(`${findingLine(row)} [dismissed by reviewer — not in report]`)
      out.push(`   Reason: ${exclusionReason(row.finding)}`)
    }
    out.push('')
  }

  out.push('Radiologist:    ' + dash(r?.radiologist))
  if (r) out.push('Status:         ' + (r.signed ? 'Signed report' : 'Unsigned AI-assisted preliminary draft'))
  const amendments = r?.amendments ?? []
  if (amendments.length) {
    out.push('')
    out.push('Amendments')
    for (const a of amendments) {
      out.push(
        `- Signed ${new Date(a.signedAt).toLocaleString()}, unlocked for amendment ${new Date(a.unlockedAt).toLocaleString()} by ${dash(a.by)}`,
      )
    }
  }
  out.push('')
  out.push(DISCLAIMER)

  return out.join('\n')
}

/** Download a string or Blob to disk via a temporary anchor click. */
export function downloadFile(name: string, content: string | Blob, mime: string): void {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Safari and Firefox start the download asynchronously; revoking immediately can cancel it.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
