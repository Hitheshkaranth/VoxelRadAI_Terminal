// Off-main-thread DICOM series → NRRD volume, so a few hundred slices do not freeze the shell.
import { dicomBuffersToVolume } from './dicomSeries.ts'

self.onmessage = (event: MessageEvent<{ buffers: ArrayBuffer[] }>) => {
  try {
    const outcome = dicomBuffersToVolume(event.data.buffers.map((buffer) => new Uint8Array(buffer)))
    self.postMessage({ outcome }, { transfer: outcome.opened ? [outcome.opened.nrrd.buffer as ArrayBuffer] : [] })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
