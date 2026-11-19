import { useEffect, useRef, useState } from 'react'
import { Sheet } from './Sheet'
import { ShellButton } from './ShellButton'
import { useApp } from '../../store'
import { filesToStudyImages } from '../../lib/imageIntake'
import { MIN_VOLUME_SLICES } from '../../lib/dicomSeries'
import { splitDicomSeries } from '../../lib/dicomSeriesIntake'
import { useShell } from './shellState'
import { toast } from './toastStore'
import './pacsImport.css'

type Row = { studyUid: string; seriesUid?: string; instanceUid?: string; patientName?: string; patientId?: string; date?: string; description?: string; modality?: string; number?: string; frames?: number }
type Page = { items: Row[]; hasMore: boolean }
type Level = 'studies' | 'series' | 'instances'
const MAX_SERIES_INSTANCES = 1000
const VOLUME_MODALITIES = new Set(['CT', 'MR'])

/** Mount only for administrators in server mode. The API independently enforces authorization. */
export function PacsImportSheet({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported?: () => void }) {
  return open ? <PacsImportContent onClose={onClose} onImported={onImported} /> : null
}
function PacsImportContent({ onClose, onImported }: { onClose: () => void; onImported?: () => void }) {
  const open = true
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [patientId, setPatientId] = useState(''), [studyDate, setStudyDate] = useState('')
  const [study, setStudy] = useState<Row | null>(null), [series, setSeries] = useState<Row | null>(null)
  const [page, setPage] = useState<Page | null>(null), [offset, setOffset] = useState(0)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState('')
  const request = useRef<AbortController | null>(null)
  const level: Level = series ? 'instances' : study ? 'series' : 'studies'

  useEffect(() => {
    if (!open) return
    const controller = new AbortController(); request.current = controller
    void fetch('/api/admin/pacs/status', { credentials: 'same-origin', signal: controller.signal }).then(async response => {
      const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Archive status unavailable.')
      if (!controller.signal.aborted) setConfigured(value.configured === true)
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Archive status unavailable.') })
    return () => { request.current?.abort() }
  }, [open])

  async function post(path: string, body: object, signal: AbortSignal) {
    const response = await fetch(`/api/admin/pacs/${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
    if (!response.ok) { const value = await response.json().catch(() => ({})); throw new Error(value.error || 'Archive request failed.') }
    return response
  }
  async function browse(nextStudy: Row | null = study, nextSeries: Row | null = series, nextOffset = 0) {
    request.current?.abort(); const controller = new AbortController(); request.current = controller
    setBusy(true); setError(''); setPage(null); setStudy(nextStudy); setSeries(nextSeries); setOffset(nextOffset)
    try {
      const response = await post('query', { level: nextSeries ? 'instances' : nextStudy ? 'series' : 'studies', ...(nextStudy ? { studyUid: nextStudy.studyUid } : { patientId, studyDate }), ...(nextSeries ? { seriesUid: nextSeries.seriesUid } : {}), limit: 25, offset: nextOffset }, controller.signal)
      const value = await response.json() as Page
      if (!controller.signal.aborted) setPage(value)
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Archive search failed.') }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  async function importInstance(row: Row) {
    request.current?.abort(); const controller = new AbortController(); request.current = controller
    setBusy(true); setError('')
    try {
      const response = await post('instance', { studyUid: row.studyUid, seriesUid: row.seriesUid, instanceUid: row.instanceUid }, controller.signal)
      const blob = await response.blob()
      const result = await filesToStudyImages([new File([blob], 'Archive instance.dcm', { type: 'application/dicom' })])
      if (controller.signal.aborted) return
      if (result.some(image => image.sourceSopInstanceUid !== row.instanceUid || image.sourceSeriesUid !== row.seriesUid)) throw new Error('Retrieved DICOM identity does not match the selected instance. Nothing was imported.')
      const state = useApp.getState(), id = state.createStudy(series?.description || study?.description || 'Archive instance')
      state.updatePatient(id, { name: study?.patientName || '', patientId: study?.patientId || '' })
      state.addImages(id, result)
      onImported?.(); onClose()
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Instance import failed.') }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  // Retrieves each instance through the same audited single-instance route (the server asks the archive to
  // transcode to Explicit VR Little Endian), then stacks the series locally.
  async function openSeriesVolume(row: Row) {
    request.current?.abort(); const controller = new AbortController(); request.current = controller
    setBusy(true); setError(''); setProgress('Listing series instances…')
    try {
      const instances: Row[] = []
      for (let offset = 0; ; offset += 50) {
        const value = await (await post('query', { level: 'instances', studyUid: row.studyUid, seriesUid: row.seriesUid, limit: 50, offset }, controller.signal)).json() as Page
        instances.push(...value.items)
        if (!value.hasMore) break
        if (instances.length >= MAX_SERIES_INSTANCES || offset + 50 > 10000) throw new Error(`This series has more than ${MAX_SERIES_INSTANCES} instances, which is too large to open as a volume here.`)
      }
      if (instances.length < MIN_VOLUME_SLICES) throw new Error(`This series has ${instances.length} instance(s); at least ${MIN_VOLUME_SLICES} slices are needed for a volume. Browse it to import single instances.`)
      const files: File[] = new Array(instances.length)
      let next = 0, done = 0
      const fetchNext = async () => {
        while (next < instances.length && !controller.signal.aborted) {
          const index = next++, instance = instances[index]
          const response = await post('instance', { studyUid: instance.studyUid, seriesUid: instance.seriesUid, instanceUid: instance.instanceUid }, controller.signal)
          files[index] = new File([await response.blob()], `archive-instance-${index + 1}.dcm`, { type: 'application/dicom' })
          setProgress(`Retrieving instance ${++done} of ${instances.length}…`)
        }
      }
      await Promise.all(Array.from({ length: 4 }, fetchNext))
      if (controller.signal.aborted) return
      setProgress('Building volume from the series…')
      const split = await splitDicomSeries(files)
      if (controller.signal.aborted) return
      if (!split.source) throw new Error(split.warnings[0] || 'The retrieved series could not be opened as a volume.')
      if (split.seriesUid !== row.seriesUid) throw new Error('Retrieved DICOM identity does not match the selected series. Nothing was opened.')
      useShell.getState().openVolume(split.source)
      for (const warning of split.warnings) toast(warning, 'info')
      onImported?.(); onClose()
    } catch (cause) { if (!controller.signal.aborted) { controller.abort(); setError(cause instanceof Error ? cause.message : 'Series retrieval failed.') } }
    finally { if (request.current === controller) { setBusy(false); setProgress('') } }
  }
  return <Sheet open={open} onClose={onClose} title="Imaging archive" subtitle="Administrator access · read-only archive connection">
    <div className="pacs-import">
      <p>Import one DICOM instance into a new local study, or open a whole CT or MRI series as a volume for review.</p>
      {configured === null && !error && <p role="status">Checking archive connection…</p>}
      {configured === false && <p role="status">No archive is configured. Ask your deployment administrator to configure DICOMweb.</p>}
      {configured && <>
        {!study && <form className="pacs-search" onSubmit={event => { event.preventDefault(); void browse(null, null) }}>
          <label>Patient ID<input value={patientId} maxLength={64} onChange={event => setPatientId(event.target.value)} disabled={busy} autoComplete="off" /></label>
          <label>Study date<input value={studyDate} maxLength={64} placeholder="YYYYMMDD or date range" onChange={event => setStudyDate(event.target.value)} disabled={busy} autoComplete="off" /></label>
          <ShellButton type="submit" variant="default" disabled={busy}>Search archive</ShellButton>
        </form>}
        {study && <div className="pacs-breadcrumb"><ShellButton disabled={busy} onClick={() => void browse(null, null)}>All studies</ShellButton>{series && <ShellButton disabled={busy} onClick={() => void browse(study, null)}>Study series</ShellButton>}<span>{series?.description || study.description || 'Selected study'}</span></div>}
        <p role="status" aria-live="polite">{busy ? progress || 'Loading archive data…' : page ? `${page.items.length} ${level} on this page` : 'Search by patient ID or date, or leave filters empty to browse.'}</p>
        {page && <ul className="pacs-results">{page.items.map((row, index) => <li key={row.instanceUid || row.seriesUid || row.studyUid}>
          <div><strong>{level === 'studies' ? row.description || 'Untitled study' : level === 'series' ? row.description || `Series ${row.number || index + 1}` : `Instance ${row.number || index + 1}`}</strong><span>{level === 'studies' ? [row.patientName, row.patientId, row.date].filter(Boolean).join(' · ') : level === 'series' ? row.modality : `${row.frames || 1} frame(s)`}</span></div>
          {level === 'series' && VOLUME_MODALITIES.has((row.modality ?? '').toUpperCase()) && <ShellButton disabled={busy} onClick={() => void openSeriesVolume(row)}>Open series as volume</ShellButton>}
          <ShellButton disabled={busy} onClick={() => void (level === 'studies' ? browse(row, null) : level === 'series' ? browse(study, row) : importInstance(row))}>{level === 'instances' ? 'Import instance' : 'Browse'}</ShellButton>
        </li>)}</ul>}
        {page && <div className="pacs-pagination"><ShellButton disabled={busy || offset === 0} onClick={() => void browse(study, series, Math.max(0, offset - 25))}>Previous</ShellButton><span>Page {Math.floor(offset / 25) + 1}</span><ShellButton disabled={busy || !page.hasMore || offset >= 10000} onClick={() => void browse(study, series, offset + 25)}>Next</ShellButton></div>}
      </>}
      {error && <p role="alert" className="pacs-error">{error}</p>}
    </div>
  </Sheet>
}
