// Browser glue: read dropped/picked/retrieved DICOM files, build a series volume (in a worker when possible)
// and hand back a VolumeSource plus the files that should stay on the 2D image path.
import { uid } from '../store'
import { MIN_VOLUME_SLICES, dicomBuffersToVolume, mayContainDicomSeries, type DicomSeriesOutcome } from './dicomSeries'
import { isDicomFile } from './imageIntake'
import type { VolumeSource } from './volumeSources'

export interface DicomSeriesSplit {
  source?: VolumeSource
  /** SeriesInstanceUID of the opened volume, for identity checks against an archive selection. */
  seriesUid?: string
  rest: File[]
  warnings: string[]
}

async function buildOffThread(buffers: ArrayBuffer[]): Promise<DicomSeriesOutcome> {
  if (typeof Worker === 'undefined') return dicomBuffersToVolume(buffers.map((buffer) => new Uint8Array(buffer)))
  const worker = new Worker(new URL('./dicomSeries.worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<DicomSeriesOutcome>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<{ outcome?: DicomSeriesOutcome; error?: string }>) => event.data.outcome ? resolve(event.data.outcome) : reject(new Error(event.data.error || 'Could not read the DICOM series.'))
      worker.onerror = (event) => { event.preventDefault(); reject(new Error(event.message || 'The DICOM series worker failed.')) }
      worker.postMessage({ buffers }, buffers)
    })
  } finally { worker.terminate() }
}

/** Open the largest CT/MR series among `files` as a volume; everything else is returned for 2D intake. */
export async function splitDicomSeries(files: File[]): Promise<DicomSeriesSplit> {
  if (!mayContainDicomSeries(files)) return { rest: files, warnings: [] }
  const dicom: File[] = []
  const others: File[] = []
  for (const file of files) (file.size > 0 && await isDicomFile(file) ? dicom : others).push(file)
  if (dicom.length < MIN_VOLUME_SLICES) return { rest: files, warnings: [] }
  const outcome = await buildOffThread(await Promise.all(dicom.map((file) => file.arrayBuffer())))
  const rest = [...others, ...outcome.rest.map((index) => dicom[index])]
  const opened = outcome.opened
  if (!opened) return { rest, warnings: outcome.warnings }
  const name = opened.title.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'dicom-series'
  return {
    rest, warnings: outcome.warnings, seriesUid: opened.seriesUid,
    source: {
      id: uid(), title: opened.title, modality: opened.modality, acquisition: opened.acquisition,
      ...(opened.acquisition.sequence ? { sequence: opened.acquisition.sequence } : {}),
      ...(opened.window ? { initialWindow: opened.window } : {}),
      file: new File([opened.nrrd as Uint8Array<ArrayBuffer>], `${name}.nrrd`, { type: 'application/octet-stream' }),
    },
  }
}
