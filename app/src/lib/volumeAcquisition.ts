/** User-confirmed acquisition context. Never inferred from the filename or pixel values. */
export interface VolumeAcquisition {
  modality: 'CT' | 'MRI' | 'Volume'
  bodyPart: string
  sequence: string
  contrast: 'unknown' | 'without' | 'with'
  intensityIsHU: boolean
}

export function normalizeAcquisition(value: VolumeAcquisition): VolumeAcquisition {
  const modality = value.modality === 'CT' || value.modality === 'MRI' ? value.modality : 'Volume'
  return {
    modality,
    bodyPart: value.bodyPart.trim().slice(0, 120),
    sequence: modality === 'MRI' ? value.sequence.trim().slice(0, 120) : '',
    contrast: value.contrast === 'with' || value.contrast === 'without' ? value.contrast : 'unknown',
    intensityIsHU: modality === 'CT' && value.intensityIsHU === true,
  }
}

export function acquisitionLabel(context?: VolumeAcquisition): string {
  if (!context) return ''
  return [context.modality, context.bodyPart, context.sequence, `contrast ${context.contrast}`, context.modality === 'CT' ? context.intensityIsHU ? 'HU confirmed' : 'HU not confirmed' : ''].filter(Boolean).join(' · ')
}
