import type { Volume } from './volume'
import type { VolumeSource } from './volumeSources'
const sources = new Map<string, { source: VolumeSource; volume: Volume }>()
export function registerVolumeSource(identity: string, source: VolumeSource, volume: Volume) { sources.set(identity, { source, volume }) }
export function registeredVolumeSource(identity: string) { return sources.get(identity) }
