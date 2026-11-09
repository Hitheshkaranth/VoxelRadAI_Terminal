import type { Volume } from './volume.ts'

const fingerprints = new WeakMap<Volume, Promise<string>>()
/** Full voxel content and geometry, not filenames, bind saved findings to a scan. */
export function volumeFingerprint(volume: Volume): Promise<string> {
  let pending = fingerprints.get(volume)
  if (!pending) {
    pending = (async () => {
      const bytes = new Uint8Array(volume.data.byteLength)
      bytes.set(new Uint8Array(volume.data.buffer, volume.data.byteOffset, volume.data.byteLength))
      const voxelHash = await crypto.subtle.digest('SHA-256', bytes)
      const geometry = JSON.stringify({ dimensions: volume.dimensions, spacing: volume.spacing, directions: volume.directions, origin: volume.origin, space: volume.space, type: volume.data.constructor.name, acquisition: volume.acquisition })
      const encoded = new TextEncoder().encode(geometry)
      const content = new Uint8Array(voxelHash.byteLength + encoded.length)
      content.set(new Uint8Array(voxelHash)); content.set(encoded, voxelHash.byteLength)
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', content))].map((b) => b.toString(16).padStart(2, '0')).join('')
    })()
    fingerprints.set(volume, pending)
  }
  return pending
}
