// OWNER: Agent 4 (Report). Pure helpers for exporting the study as plain text / JSON,
// shared by ReportPanel and PrintReport. No React, no store binding.
import type { AnalysisResult, ReportDraft, Settings, Study } from '../types'

export interface StudyExportImage {
  id: string
  name: string
  mime: string
  width: number
  height: number
  status: string
  addedAt: string
  analysis: AnalysisResult | null
  /** Only present when `includeDataUrls` is not explicitly false. */
  thumbnailUrl?: string
}

export interface ReportExport {
  radiologist: string
  signed: boolean
  signedAt: string | null
  generated: boolean
  updatedAt: string
  technique: string
  comparison: string
  findings: string
  impression: string
  recommendations: string
}

export interface StudyExport {
  studyId: string
  title: string
  createdAt: string
  updatedAt: string
  patient: Pick<
    Study['patient'],
    'name' | 'patientId' | 'age' | 'sex' | 'studyDate' | 'referringPhysician' | 'indication' | 'clinicalHistory'
  >
  institution: string
  model: string
  imageCount: number
  analyzedCount: number
  images: StudyExportImage[]
  report: ReportExport | null
}

interface FindingForText {
  title: string
  location: string
  severity: string
  confidence: number
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

/** A stable, filesystem-friendly filename derived from the study title. */
export function studyFileName(study: Study, ext = 'txt'): string {
  const slug = (study.title || 'study')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'study'}-${new Date().toISOString().slice(0, 10)}.${ext}`
}

const ISO = (ts: number): string => new Date(ts).toISOString()

export function studyToJson(study: Study, settings: Settings, opts: { includeDataUrls?: boolean } = {}): StudyExport {
  const images: StudyExportImage[] = study.images.map((img) => {
    const out: StudyExportImage = {
      id: img.id,
      name: img.name,
      mime: img.mime,
      width: img.width,
      height: img.height,
      status: img.status,
      addedAt: ISO(img.addedAt),
      analysis: img.analysis ?? null,
    }
    if (opts.includeDataUrls !== false) out.thumbnailUrl = img.dataUrl
    return out
  })
  const report: ReportExport | null = study.report
    ? {
        radiologist: study.report.radiologist,
        signed: study.report.signed,
        signedAt: study.report.signedAt ? ISO(study.report.signedAt) : null,
        generated: study.report.generated,
        updatedAt: ISO(study.report.updatedAt),
        technique: study.report.technique,
        comparison: study.report.comparison,
        findings: study.report.findings,
        impression: study.report.impression,
        recommendations: study.report.recommendations,
      }
    : null
  return {
    studyId: study.id,
    title: study.title,
    createdAt: ISO(study.createdAt),
    updatedAt: ISO(study.updatedAt),
    patient: study.patient,
    institution: settings.institution,
    model: settings.model,
    imageCount: study.images.length,
    analyzedCount: analyzedImages(study).length,
    images,
    report,
  }
}

interface FindingForText {
  title: string
  location: string
  severity: string
  confidence: number
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

function joinBlocks(values: Array<string | undefined>): string {
  return trim(values.join('\n'))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n\n')
}

/**
 * Render the report as plain text (Copy + Download .txt). Also used by the print
 * dialog as the textual body of the A4 page.
 */
export function reportToPlainText(study: Study, settings: Settings): string {
  const r = study.report
  const exam = examSummary(study)

  const out: string[] = []
  out.push(settings.institution || 'Diagnostic Radiology')
  out.push('Diagnostic Radiology Report')
  out.push('Report date: ' + new Date().toLocaleDateString())
  if (r?.signedAt) out.push('Signed: ' + new Date(r.signedAt).toLocaleString())
  out.push('')

  const p = study.patient
  out.push('Patient:        ' + dash(p.name))
  out.push('Patient ID:     ' + dash(p.patientId))
  const ageSex = [dash(p.age), dash(p.sex)].filter((s) => s !== '—').join(' / ')
  out.push('Age / Sex:      ' + (ageSex || '—'))
  out.push('Study Date:     ' + dash(p.studyDate))
  out.push('Referring Physician: ' + dash(p.referringPhysician))
  out.push('')

  const examLine = [exam.modality, exam.bodyPart, ...exam.views].filter(Boolean).join(' · ')
  out.push('Exam:           ' + (examLine || '—'))
  out.push('Clinical Indication: ' + dash(p.indication))
  if (p.clinicalHistory.trim()) out.push('History:        ' + dash(p.clinicalHistory))
  out.push('')

  out.push('Technique:      ' + dash(r?.technique))
  out.push('Comparison:     ' + dash(r?.comparison))
  out.push('Findings:       ' + dash(r?.findings))
  out.push('Impression:     ' + dash(r?.impression))
  out.push('Recommendations: ' + dash(r?.recommendations))
  out.push('')

  const findings: FindingForText[] = []
  for (const img of analyzedImages(study)) {
    const a = img.analysis
    if (a) for (const f of a.findings) findings.push(f)
  }
  if (findings.length) {
    out.push('Findings Summary')
    out.push('----------------')
    findings.forEach((f, i) => {
      const loc = trim(f.location) ? ' — ' + f.location : ''
      out.push(`${i + 1}. [${severityLabel(f.severity)}]${loc}`)
      out.push(`   ${trim(f.title) || '—'}`)
      out.push(`   Confidence: ${Math.round(f.confidence * 100)}%`)
    })
    out.push('')
  }

  out.push('Radiologist:             ' + dash(r?.radiologist))
  if (r) out.push('Source: ' + (r.signed ? 'Signed report' : 'AI-assisted preliminary draft'))

  return out.join('\n')
}

/** Concatenate the editable sections into one paragraph block (used by the print dialog). */
export function reportDraftToPlain(r: ReportDraft | undefined): string {
  return joinBlocks([r?.technique, r?.comparison, r?.findings, r?.impression, r?.recommendations])
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
  setTimeout(() => URL.revokeObjectURL(url), 0)
}