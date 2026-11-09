import type { Study } from '../types.ts'

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
const hasStrings = (value: Record<string, unknown>, keys: string[]) => keys.every((key) => typeof value[key] === 'string')
const optionalStrings = (value: Record<string, unknown>, keys: string[]) => keys.every((key) => value[key] === undefined || typeof value[key] === 'string')
/** Reject malformed external records before they can reach viewer/report components. */
export function validateTransferredStudy(value: unknown): Study {
  const fail = () => { throw new Error('This saved study has an unsupported or incomplete format. It was not restored.') }
  if (!object(value) || !hasStrings(value, ['id', 'title']) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.id as string) || !finite(value.createdAt) || !finite(value.updatedAt)) return fail()
  if (!object(value.patient) || !hasStrings(value.patient, ['name', 'patientId', 'age', 'sex', 'studyDate', 'referringPhysician', 'indication', 'clinicalHistory'])) return fail()
  if (!Array.isArray(value.images) || value.images.length > 500) return fail()
  for (const image of value.images) {
    if (!object(image) || !hasStrings(image, ['id', 'name', 'mime', 'dataUrl', 'status']) || !optionalStrings(image, ['sourceModality', 'sourceBodyPart', 'error', 'progressText']) || !finite(image.width) || !finite(image.height) || !finite(image.addedAt) || !['idle', 'done', 'error', 'analyzing'].includes(image.status as string) || !/^data:image\/(png|jpeg|webp|gif|bmp);base64,[A-Za-z0-9+/\r\n]*={0,2}$/.test(image.dataUrl as string)) return fail()
    if (image.analysis !== undefined) {
      const analysis = image.analysis
      if (!object(analysis) || !hasStrings(analysis, ['modality', 'bodyPart', 'view', 'imageQuality', 'impression', 'rawText', 'model']) || !finite(analysis.durationMs) || !finite(analysis.createdAt) || !['routine', 'priority', 'urgent'].includes(analysis.urgency as string) || !strings(analysis.pertinentNegatives) || !strings(analysis.recommendations) || !strings(analysis.differential) || !Array.isArray(analysis.findings)) return fail()
      for (const finding of analysis.findings) {
        if (!object(finding) || !hasStrings(finding, ['id', 'title', 'description', 'location']) || !optionalStrings(finding, ['category', 'recommendation', 'source']) || !finite(finding.confidence) || !['critical', 'significant', 'moderate', 'minor', 'normal'].includes(finding.severity as string)) return fail()
        if (finding.validationIssues !== undefined && !strings(finding.validationIssues)) return fail()
        if (finding.bbox !== undefined && (!object(finding.bbox) || !['x', 'y', 'w', 'h'].every((key) => finite((finding.bbox as Record<string, unknown>)[key])))) return fail()
        if (finding.classifier !== undefined && (!object(finding.classifier) || typeof finding.classifier.kind !== 'string' || !optionalStrings(finding.classifier, ['reason', 'thrSource']) || ![true, false, null].includes(finding.classifier.supported as boolean | null) || (finding.classifier.prob !== null && !finite(finding.classifier.prob)))) return fail()
        if (finding.mask !== undefined && (typeof finding.mask !== 'string' || !finding.mask.startsWith('data:image/png;base64,'))) return fail()
        if (finding.measurements !== undefined && (!object(finding.measurements) || !optionalStrings(finding.measurements, ['source', 'side']) || !['diameter_mm', 'area_mm2', 'mean_hu', 'surround_hu', 'parts'].every((key) => (finding.measurements as Record<string, unknown>)[key] === undefined || finite((finding.measurements as Record<string, unknown>)[key])))) return fail()
        if (finding.review !== undefined && !['accepted', 'dismissed'].includes(finding.review as string)) return fail()
      }
      if (analysis.classifierProbs !== undefined && (!object(analysis.classifierProbs) || !Object.values(analysis.classifierProbs).every(finite))) return fail()
      if (analysis.heatmaps !== undefined) {
        if (!object(analysis.heatmaps)) return fail()
        for (const heatmap of Object.values(analysis.heatmaps)) if (!object(heatmap) || !finite(heatmap.w) || !finite(heatmap.h) || typeof heatmap.data !== 'string' || !object(heatmap.extent) || !['x', 'y', 'w', 'h'].every((key) => finite((heatmap.extent as Record<string, unknown>)[key]))) return fail()
      }
      if (!optionalStrings(analysis, ['classifierStatus', 'classifierMessage'])) return fail()
      if (analysis.secondReader !== undefined && (!object(analysis.secondReader) || typeof analysis.secondReader.status !== 'string' || !optionalStrings(analysis.secondReader, ['message']) || !finite(analysis.secondReader.added) || !finite(analysis.secondReader.ranAt))) return fail()
    }
  }
  const reportValid = (report: unknown): boolean => object(report) && hasStrings(report, ['technique', 'comparison', 'findings', 'impression', 'recommendations', 'radiologist']) && typeof report.signed === 'boolean' && typeof report.generated === 'boolean' && finite(report.updatedAt)
  if (value.report !== undefined) {
    if (!reportValid(value.report)) return fail()
    const report = value.report as Record<string, unknown>
    if (report.previous !== undefined && !reportValid(report.previous)) return fail()
    if (report.signOverrides !== undefined && !strings(report.signOverrides)) return fail()
    if (report.amendments !== undefined && (!Array.isArray(report.amendments) || !report.amendments.every((item) => object(item) && finite(item.signedAt) && finite(item.unlockedAt) && typeof item.by === 'string'))) return fail()
    if (report.patientSnapshot !== undefined && (!object(report.patientSnapshot) || !hasStrings(report.patientSnapshot, ['name', 'patientId', 'age', 'sex', 'studyDate', 'referringPhysician', 'indication', 'clinicalHistory']))) return fail()
  }
  const study = structuredClone(value) as unknown as Study
  study.images = study.images.map((image) => image.status === 'analyzing' ? { ...image, status: 'idle', stage: undefined, progressText: undefined, analysisStartedAt: undefined } : image)
  return study
}
