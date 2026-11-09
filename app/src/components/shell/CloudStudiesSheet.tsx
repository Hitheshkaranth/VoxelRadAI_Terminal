import { useEffect, useRef, useState } from 'react'
import { useActiveStudy, useApp, persistedStudies } from '../../store'
import { SERVER_MODE } from '../../lib/session'
import { validateTransferredStudy } from '../../lib/studyTransfer'
import { Sheet } from './Sheet'
import { useShell } from './shellState'
import './admin.css'
interface SavedStudy { id: string; title: string; imageCount: number; hasReport: boolean; reportSigned: boolean; updatedAt: string }

export function CloudStudiesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const active = useActiveStudy()
  const [saved, setSaved] = useState<SavedStudy[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!open || !SERVER_MODE) return
    const controller = new AbortController()
    setLoading(true); setMessage('')
    void fetch(`/api/studies?limit=25&offset=${offset}`, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(response.status === 401 ? 'Your session expired. Sign in again.' : 'Saved studies could not be loaded. Try again.')
      const data = await response.json()
      if (!Array.isArray(data.studies) || !Number.isSafeInteger(data.total) || data.total < 0 || !data.studies.every((row: SavedStudy) => row && typeof row.id === 'string' && typeof row.title === 'string' && Number.isSafeInteger(row.imageCount) && row.imageCount >= 0 && typeof row.hasReport === 'boolean' && typeof row.reportSigned === 'boolean')) throw new Error('The server returned an invalid study list.')
      if (!controller.signal.aborted) { setSaved(data.studies); setTotal(data.total) }
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setMessage(reason instanceof Error ? reason.message : 'Saved studies could not be loaded.') }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [open, attempt, offset])
  const save = async () => {
    if (!active || busy) return
    setBusy(true); setMessage('')
    try {
      const payload = JSON.stringify(persistedStudies([active])[0])
      if (new Blob([payload]).size > 25 * 1024 * 1024) throw new Error('This study exceeds the 25 MB server limit. Keep it local or use your approved imaging archive.')
      const response = await fetch('/api/studies', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: payload })
      if (!response.ok) throw new Error(response.status === 401 ? 'Your session expired. Sign in again.' : 'The study could not be saved. Check the server and try again.')
      setAttempt((value) => value + 1)
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'The study could not be saved.') }
    finally { setBusy(false) }
  }
  const restore = async (entry: SavedStudy) => {
    if (busy) return
    const existing = useApp.getState().studies.some((item) => item.id === entry.id)
    if (useApp.getState().studies.find((item) => item.id === entry.id)?.images.some((image) => image.status === 'analyzing')) { setMessage('Wait for the local analysis to finish before replacing this study.'); return }
    if (existing && confirmRestore !== entry.id) { setConfirmRestore(entry.id); return }
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/studies/${encodeURIComponent(entry.id)}`, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(response.status === 401 ? 'Your session expired. Sign in again.' : 'This study could not be restored. Refresh the list and try again.')
      const data = await response.json()
      const study = validateTransferredStudy(data.study)
      if (study.id !== entry.id) throw new Error('The server returned a different study. Nothing was restored.')
      if (!mounted.current) return
      useApp.setState((state) => ({ studies: [study, ...state.studies.filter((item) => item.id !== study.id)] }))
      useApp.getState().selectStudy(study.id); useShell.getState().closeVolume(); useShell.getState().setMobileView('viewer'); setConfirmRestore(null); onClose()
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'This study could not be restored.') }
    finally { setBusy(false) }
  }
  return <Sheet open={open} onClose={onClose} title="Saved studies" subtitle="Store and restore image studies in your server account.">
    {!SERVER_MODE ? <p className="admin-note">Server storage requires a configured server and a signed-in account. Your current studies stay in this browser.</p> : <>
      <h3 className="admin-heading">Save current study</h3>
      {active && <p className="admin-note cloud-current-title">{active.title || 'Untitled study'}</p>}
      <p className="admin-note">Saving sends this study's patient details, scans, findings and report to your configured Skanda server. It updates an existing server copy of the same study. Other studies and open volumes are not uploaded.</p>
      <button className="btn btn-primary" disabled={!active || busy || active.images.some((image) => image.status === 'analyzing')} onClick={() => { void save() }}>{busy ? 'Saving...' : 'Save current study'}</button>
      {!active && <p className="admin-note">Select an image study to save.</p>}
      <h3 className="admin-heading">Your server copies</h3>
      <button className="btn" disabled={loading} onClick={() => setAttempt((value) => value + 1)}>Refresh saved studies</button>
      {message && <p className="admin-error" role="alert">{message}</p>}
      {loading ? <p className="admin-note" role="status">Loading saved studies...</p> : saved.length === 0 ? <p className="admin-note">No saved studies are available.</p> : <div className="cloud-study-list">{saved.map((study) => <article key={study.id}><div><strong>{study.title || 'Untitled study'}</strong><p className="admin-note">{study.imageCount} images / {study.hasReport ? study.reportSigned ? 'Signed report' : 'Draft report' : 'No report'}</p></div>{confirmRestore === study.id ? <div><p className="admin-note">This replaces the local copy, including any newer edits.</p><button className="btn" disabled={busy} onClick={() => setConfirmRestore(null)}>Cancel</button> <button className="btn btn-primary" disabled={busy} onClick={() => { void restore(study) }}>Replace local copy</button></div> : <button className="btn" disabled={busy} onClick={() => { void restore(study) }}>Open in workspace</button>}</article>)}</div>}
      <div className="admin-pagination"><span>{total ? `${offset + 1}-${Math.min(offset + saved.length, total)} of ${total}` : '0 studies'}</span><button className="btn" disabled={loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 25))}>Previous</button><button className="btn" disabled={loading || offset + 25 >= total} onClick={() => setOffset((value) => value + 25)}>Next</button></div>
    </>}
  </Sheet>
}
