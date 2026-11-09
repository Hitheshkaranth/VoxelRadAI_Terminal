import { useEffect, useRef, useState } from 'react'
import { Sheet } from './Sheet'
import { ShellButton } from './ShellButton'
import { useShell } from './shellState'
import { normalizeAcquisition, type VolumeAcquisition } from '../../lib/volumeAcquisition'

interface SavedVolume { id: string; fileName: string; title: string; sizeBytes: number; state: 'pending' | 'ready' | 'deleting'; acquisition?: VolumeAcquisition }
interface StorageStatus { enabled: boolean; maxVolumeBytes: number; uploadOrigins: string[]; downloadOrigins: string[]; allowInsecureTransport?: boolean }
async function api(path: string, signal: AbortSignal, method = 'GET', data?: unknown) {
  const response = await fetch(path, { method, signal, cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) })
  const result = await response.json()
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Volume storage is unavailable. Try again.')
  return result
}
function storageUrl(value: string, origins: string[], allowHttp = false) {
  const url = new URL(value)
  if (!origins.includes(url.origin) || (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) || url.username || url.password) throw new Error('The server returned an unapproved storage address.')
  return url.href
}
export function SavedVolumesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <SavedVolumesContent onClose={onClose} /> : null
}
function SavedVolumesContent({ onClose }: { onClose: () => void }) {
  const source = useShell((state) => state.volumeSource)
  const [status, setStatus] = useState<StorageStatus | null>(null)
  const [volumes, setVolumes] = useState<SavedVolume[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const operation = useRef<AbortController | null>(null)
  useEffect(() => () => operation.current?.abort(), [])
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      const config = await api('/api/volumes/status', controller.signal)
      if (typeof config.enabled !== 'boolean') throw new Error('Invalid storage configuration.')
      setStatus(config)
      if (!config.enabled) return
      if (!Number.isSafeInteger(config.maxVolumeBytes) || !Array.isArray(config.uploadOrigins) || !Array.isArray(config.downloadOrigins)) throw new Error('Invalid storage configuration.')
      const result = await api(`/api/volumes?limit=20&offset=${page * 20}`, controller.signal)
      if (!Array.isArray(result.volumes) || !Number.isSafeInteger(result.total) || !result.volumes.every((row: SavedVolume) => row && typeof row.id === 'string' && typeof row.fileName === 'string' && typeof row.title === 'string' && Number.isSafeInteger(row.sizeBytes) && row.sizeBytes > 0 && ['pending', 'ready', 'deleting'].includes(row.state))) throw new Error('Invalid saved volume list.')
      setVolumes(result.volumes); setTotal(result.total)
    })().catch((reason: unknown) => { if (!controller.signal.aborted) setMessage(reason instanceof Error ? reason.message : 'Volumes could not be loaded.') }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [attempt, page])
  const refresh = () => { setLoading(true); setAttempt((value) => value + 1) }
  const run = async (label: string, work: (signal: AbortSignal) => Promise<void>) => {
    if (busy) return
    const controller = new AbortController(); operation.current = controller
    setBusy(label); setMessage('')
    try { await work(controller.signal) } catch (reason) { if (!controller.signal.aborted) setMessage(reason instanceof Error ? reason.message : 'Volume operation failed.') }
    finally { if (!controller.signal.aborted) setBusy('') }
  }
  const save = () => run('Uploading volume…', async (signal) => {
    if (!source?.file || !status) return
    if (source.file.size > status.maxVolumeBytes) throw new Error('This file exceeds the server volume size limit.')
    const result = await api('/api/volumes/uploads', signal, 'POST', { fileName: source.file.name, sizeBytes: source.file.size, title: source.title, acquisition: source.acquisition })
    const form = new FormData()
    for (const [key, value] of Object.entries(result.upload.fields)) { if (typeof value !== 'string') throw new Error('Invalid upload policy.'); form.append(key, value) }
    form.append('file', source.file)
    const response = await fetch(storageUrl(result.upload.url, status.uploadOrigins, status.allowInsecureTransport), { method: 'POST', body: form, credentials: 'omit', redirect: 'error', signal })
    if (!response.ok) throw new Error('Storage rejected the upload. Check bucket permissions and CORS, then retry. Remove the incomplete copy below if needed.')
    await api(`/api/volumes/${encodeURIComponent(result.volume.id)}/finalize`, signal, 'POST', {})
    setMessage('Volume saved to your private storage.'); refresh()
  })
  const openVolume = (entry: SavedVolume) => run('Opening volume…', async (signal) => {
    if (!status) return
    const result = await api(`/api/volumes/${encodeURIComponent(entry.id)}/download`, signal, 'POST', {})
    const response = await fetch(storageUrl(result.url, status.downloadOrigins, status.allowInsecureTransport), { credentials: 'omit', redirect: 'error', signal })
    if (!response.ok || !response.body) throw new Error('The volume download failed. Refresh and try again.')
    const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = []
    let bytes = 0
    try { while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.length; if (bytes > entry.sizeBytes || bytes > status.maxVolumeBytes) { await reader.cancel(); throw new Error('Downloaded volume exceeds its recorded size.') }; chunks.push(new Uint8Array(value)) } } finally { reader.releaseLock() }
    if (bytes !== entry.sizeBytes) throw new Error('The volume download was incomplete.')
    if (signal.aborted) return
    const acquisition = entry.acquisition ? normalizeAcquisition(entry.acquisition) : undefined
    useShell.getState().openVolume({ id: `stored-${entry.id}`, title: entry.title, modality: acquisition?.modality ?? 'Volume', acquisition, file: new File(chunks, entry.fileName, { type: 'application/octet-stream' }) })
    onClose()
  })
  return <Sheet open onClose={onClose} title="Saved volumes" subtitle="Private storage for your imported NRRD scans.">
    {loading && <p role="status">Loading volume storage…</p>}
    {status?.enabled === false && <p className="admin-note">Volume storage is not configured. Your administrator can connect a private S3 bucket using the deployment guide. Local scans remain available in this browser.</p>}
    {status?.enabled && <>
      <h3 className="admin-heading">Save open volume</h3>
      <p className="admin-note">{source?.file ? source.title : 'Open an imported NRRD volume to save it.'} Saving uploads the original scan and acquisition context. Findings and analysis jobs are not included.</p>
      <ShellButton className="btn btn-primary" disabled={!source?.file || !!busy || loading} onClick={() => { void save() }}>Save volume</ShellButton>
      <h3 className="admin-heading">Your stored volumes</h3>
      <ShellButton className="btn" disabled={!!busy || loading} onClick={refresh}>Refresh volumes</ShellButton>
      {!loading && !volumes.length && <p className="admin-note">No stored volumes yet.</p>}
      <div className="cloud-study-list">{volumes.map((entry) => <article key={entry.id}><div><strong>{entry.title}</strong><p className="admin-note">{(entry.sizeBytes / 1024 / 1024).toFixed(1)} MB · {entry.state === 'ready' ? 'Ready' : 'Incomplete upload'}</p></div><div>
        <ShellButton className="btn" disabled={!!busy || entry.state !== 'ready'} onClick={() => { void openVolume(entry) }}>Open volume</ShellButton>
        {confirmDelete === entry.id ? <><p className="admin-note">Permanently delete this stored copy?</p><ShellButton className="btn" disabled={!!busy} onClick={() => setConfirmDelete(null)}>Cancel</ShellButton><ShellButton className="btn" disabled={!!busy} onClick={() => { void run('Deleting volume…', async (signal) => { await api(`/api/volumes/${encodeURIComponent(entry.id)}`, signal, 'DELETE'); setConfirmDelete(null); refresh() }) }}>Delete stored copy</ShellButton></> : <ShellButton className="btn" disabled={!!busy} onClick={() => setConfirmDelete(entry.id)}>Delete</ShellButton>}
      </div></article>)}</div>
      <div className="admin-pagination"><span>{total} volumes</span><ShellButton className="btn" disabled={!!busy || loading || page === 0} onClick={() => { setLoading(true); setPage(page - 1) }}>Previous</ShellButton><ShellButton className="btn" disabled={!!busy || loading || (page + 1) * 20 >= total} onClick={() => { setLoading(true); setPage(page + 1) }}>Next</ShellButton></div>
    </>}
    {busy && <p role="status">{busy}</p>}{message && <p role="status" className="admin-note">{message}</p>}
  </Sheet>
}
