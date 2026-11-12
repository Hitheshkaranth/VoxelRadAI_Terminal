import { createHash } from 'node:crypto'

// Reviewer decisions on model findings, for quality tracking and de-identified training exports.
// Exports never contain patient fields, image pixels, outline masks, report text or stored IDs.

export function modalityGroup(sourceModality, analysisModality) {
  const value = `${sourceModality || ''} ${analysisModality || ''}`
  if (/\b(CR|DX|MG)\b|x-?ray|radiograph/i.test(value)) return 'X-ray'
  if (/\bCT\b|computed tomograph/i.test(value)) return 'CT'
  if (/\bMR\b|\bMRI\b|magnetic resonance/i.test(value)) return 'MRI'
  return 'Other'
}

export const pseudonym = id => createHash('sha256').update(`voxelrad-export:${id}`).digest('hex').slice(0, 16)
const text = (value, max = 2000) => typeof value === 'string' ? value.slice(0, max) : undefined
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : undefined
const review = value => value === 'accepted' || value === 'dismissed' ? value : 'unreviewed'

/** Summarise grouped rows of { modality, category, model, review, n } from the review-stats query. */
export function summarizeReviews(rows) {
  const blank = () => ({ total: 0, accepted: 0, dismissed: 0, unreviewed: 0 })
  const totals = blank(), byModality = {}, byCategory = {}, byModel = {}
  for (const row of rows) {
    const n = Number(row.n) || 0, key = review(row.review)
    const modality = modalityGroup(row.source_modality, row.modality)
    const category = text(row.category, 80) || 'Uncategorised'
    const model = text(row.model, 120) || 'Unknown model'
    for (const bucket of [totals, byModality[modality] ??= blank(), byCategory[category] ??= blank(), byModel[model] ??= blank()]) { bucket.total += n; bucket[key] += n }
  }
  const list = map => Object.entries(map).map(([name, counts]) => ({ name, ...counts })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  return { totals, byModality: list(byModality), byCategory: list(byCategory).slice(0, 30), byModel: list(byModel) }
}

/** One de-identified record per analysed image. */
export function reviewRecord(row) {
  const analysis = row.analysis && typeof row.analysis === 'object' ? row.analysis : {}
  const findings = Array.isArray(analysis.findings) ? analysis.findings.slice(0, 200) : []
  return {
    studyRef: pseudonym(row.study_id),
    imageRef: pseudonym(`${row.study_id}/${row.image_id}`),
    modality: modalityGroup(row.source_modality, analysis.modality),
    sourceModality: text(row.source_modality, 16),
    bodyPart: text(analysis.bodyPart, 80),
    view: text(analysis.view, 80),
    model: text(analysis.model, 120),
    analyzedAt: number(analysis.createdAt) ? new Date(analysis.createdAt).toISOString() : undefined,
    urgency: text(analysis.urgency, 16),
    modelImpression: text(analysis.impression),
    reportSigned: row.signed === 'true',
    reportEditedBeforeSign: row.signed === 'true' ? row.edited === 'true' : undefined,
    findings: findings.filter(item => item && typeof item === 'object').map(item => ({
      title: text(item.title, 200), description: text(item.description), severity: text(item.severity, 16),
      confidence: number(item.confidence), location: text(item.location, 200), category: text(item.category, 80),
      source: text(item.source, 16) || 'primary',
      bbox: item.bbox && ['x','y','w','h'].every(k => number(item.bbox[k]) !== undefined) ? { x: item.bbox.x, y: item.bbox.y, w: item.bbox.w, h: item.bbox.h } : undefined,
      hasOutline: typeof item.mask === 'string' && item.mask.length > 0,
      measurements: item.measurements && typeof item.measurements === 'object' ? Object.fromEntries(['diameter_mm','area_mm2','mean_hu','surround_hu','parts'].map(k => [k, number(item.measurements[k])]).filter(([, v]) => v !== undefined)) : undefined,
      classifier: item.classifier && typeof item.classifier === 'object' ? { kind: text(item.classifier.kind, 80), prob: number(item.classifier.prob) ?? null, supported: typeof item.classifier.supported === 'boolean' ? item.classifier.supported : null } : undefined,
      validationIssues: Array.isArray(item.validationIssues) ? item.validationIssues.slice(0, 20).map(v => text(v, 300)).filter(Boolean) : undefined,
      review: review(item.review),
    })),
  }
}

const formulaStart = /^[=+\-@\t\r]/
export function csvCell(value) {
  let cell = value === null || value === undefined ? '' : String(value)
  if (formulaStart.test(cell)) cell = `'${cell}` // keep spreadsheet apps from evaluating cells
  return /[",\n\r]/.test(cell) || cell !== cell.trim() ? `"${cell.replace(/"/g, '""')}"` : cell
}
export const toCsv = (header, rows) => [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
