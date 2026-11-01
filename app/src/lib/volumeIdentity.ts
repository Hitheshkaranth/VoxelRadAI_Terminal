import { VOLUME_SAMPLES, type VolumeSource } from './volumeSources'

export function volumeSourceKind(source: VolumeSource): string {
  if (source.file) return 'Imported volume'
  return VOLUME_SAMPLES.some((sample) => sample.id === source.id && sample.url === source.url) ? 'Sample dataset' : 'Volume source'
}

