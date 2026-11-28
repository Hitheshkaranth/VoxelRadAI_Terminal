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

// Acquisition details confirmed for a sample scan or a saved scan are remembered in this account's workspace storage,
// so they survive a reload and reopening (they were held only in memory before). Uploaded files that are not saved
// cannot be reopened after a reload, so they are not remembered.
const REMEMBER_KEY = 'volume-acquisitions'
const remembered = new Map<string, VolumeAcquisition>()
export const rememberable = (source: { id: string; file?: File }) => !source.file || source.id.startsWith('stored-')

/** Load remembered details once the workspace storage scope is set (after sign-in, before the viewer renders). */
export async function loadRememberedAcquisitions(): Promise<void> {
  const { workspaceGet } = await import('./workspaceStorage')
  const saved = await workspaceGet<Record<string, VolumeAcquisition>>(REMEMBER_KEY).catch(() => undefined)
  remembered.clear()
  for (const [id, value] of Object.entries(saved ?? {})) {
    try { remembered.set(id, normalizeAcquisition(value)) } catch { /* skip a malformed entry */ }
  }
}
export async function rememberAcquisition(id: string, acquisition: VolumeAcquisition): Promise<void> {
  remembered.set(id, acquisition)
  const { workspaceSet } = await import('./workspaceStorage')
  await workspaceSet(REMEMBER_KEY, Object.fromEntries(remembered))
}
/** The source with its remembered acquisition details applied (modality and sequence follow them). */
export function withRememberedAcquisition<T extends { id: string; file?: File; modality: string; sequence?: string; acquisition?: VolumeAcquisition }>(source: T): T {
  const acquisition = rememberable(source) ? remembered.get(source.id) : undefined
  return acquisition ? { ...source, modality: acquisition.modality, sequence: acquisition.sequence, acquisition } : source
}
