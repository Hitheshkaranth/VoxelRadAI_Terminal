import type { StudyImage } from '../types.ts'

/** CT/MR use a separate image prompt and bypass chest-only auxiliary models. */
export function analysisEligibility(image: Pick<StudyImage, 'sourceModality' | 'sourceBodyPart'>): { supported: boolean; reason?: string } {
  const modality = image.sourceModality?.trim().toUpperCase()
  const bodyPart = image.sourceBodyPart?.trim().toUpperCase()
  if (['CT', 'MR', 'MRI'].includes(modality ?? '')) return { supported: true }
  if (modality && !['CR', 'DX'].includes(modality)) {
    return { supported: false, reason: `${modality} preview only. Analysis supports chest radiographs.` }
  }
  if (bodyPart && !['CHEST', 'THORAX', 'LUNG', 'LUNGS'].includes(bodyPart)) {
    return { supported: false, reason: `${bodyPart} preview only. Analysis supports chest radiographs.` }
  }
  // Legacy/raster imports have no reliable modality metadata. Keep them usable; the UI states scope.
  return { supported: true }
}

export function isCrossSectional(image: Pick<StudyImage, 'sourceModality'>): boolean {
  return ['CT', 'MR', 'MRI'].includes(image.sourceModality?.trim().toUpperCase() ?? '')
}
