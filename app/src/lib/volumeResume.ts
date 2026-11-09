import { normalizeAcquisition, type VolumeAcquisition } from './volumeAcquisition.ts'

/** Refuse to reuse a saved job if its declared context differs from the selected source. */
export function assertVolumeResumeContext(
  saved: { identity: string; modality: string; snapshot: { acquisition?: VolumeAcquisition } },
  current: { identity: string; modality: string; acquisition?: VolumeAcquisition },
): void {
  const context = (value?: VolumeAcquisition) => JSON.stringify(value ? normalizeAcquisition(value) : null)
  if (saved.identity !== current.identity || saved.modality.toUpperCase() !== current.modality.toUpperCase() || context(saved.snapshot.acquisition) !== context(current.acquisition)) {
    throw new Error('Saved analysis belongs to different acquisition details. Reopen the matching source or start a new review; these results cannot be resumed for this scan.')
  }
}
