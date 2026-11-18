import type { ReportDraft, Study } from '../types.ts'

/** Assemble existing evidence only; no new inference and no implied normal result. */
export function findingsReport(study: Study): Pick<ReportDraft, 'technique' | 'comparison' | 'findings' | 'impression' | 'recommendations'> {
  const images = study.images.filter((image) => image.analysis)
  if (!images.length) throw new Error('Analyze at least one image before drafting a report.')
  const retained = images.flatMap((image) => image.analysis!.findings
    .filter((finding) => finding.review !== 'dismissed')
    .map((finding) => ({ image, finding })))
  const describe = (finding: (typeof retained)[number]['finding']) =>
    `${finding.review === 'accepted' ? 'Reviewed finding' : 'Possible finding (not reviewed)'}: ${finding.title}`
  return {
    technique: `Review of ${images.length} analyzed image${images.length === 1 ? '' : 's'}.\n` + images.map((image) =>
      `${image.name}: ${[image.analysis!.modality, image.analysis!.bodyPart, image.analysis!.view].filter(Boolean).join(' · ')}`).join('\n'),
    comparison: 'Prior comparison not supplied. Add relevant comparison details after review.',
    findings: retained.length ? retained.map(({ image, finding }) =>
      [image.name, describe(finding), finding.location && `Location: ${finding.location}`, finding.description].filter(Boolean).join('\n')).join('\n\n')
      : 'No retained findings are available for this draft. Review the source images and complete this section.',
    impression: retained.length ? retained.map(({ finding }, index) => `${index + 1}. ${describe(finding)}`).join('\n')
      : 'Impression requires source-image review. No conclusion of normality has been made.',
    recommendations: [
      'Draft assembled from existing image findings without an additional model request. Review and edit before signing.',
      images.length < study.images.length ? `${study.images.length - images.length} image(s) have not been analyzed and are not included.` : '',
      ...retained.filter(({ finding }) => finding.recommendation).map(({ finding }) =>
        `${describe(finding)}: ${finding.recommendation}`),
    ].filter(Boolean).join('\n'),
  }
}
