import type { VolumeAcquisition } from './volumeAcquisition'

export interface VolumeSource {
  id: string
  title: string
  modality: string
  initialWindow?: { center: number; width: number }
  /** MRI sequence when known (e.g. "T1 post-contrast"): acquisition context for the reader and the claim checks. */
  sequence?: string
  acquisition?: VolumeAcquisition
  url?: string
  file?: File
}

export const VOLUME_SAMPLES: VolumeSource[] = [
  { id: 'ct-brain', title: 'CT brain · sample', modality: 'CT', initialWindow: { center: 40, width: 100 }, url: `${import.meta.env.BASE_URL}samples/ct-brain.nrrd` },
  { id: 'mr-head', title: 'MRI head · sample', modality: 'MRI', url: `${import.meta.env.BASE_URL}samples/mr-head.nrrd` },
]
