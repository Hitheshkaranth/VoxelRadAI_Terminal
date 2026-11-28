// Patient history: every study for the active patient ID, from this browser and (when signed in) saved on the server,
// on a timeline; pick one to see its image and report side by side with the current study. Matching is by the exact
// patient ID (spaces ignored), never by name.
import { useEffect, useMemo, useState } from 'react'
import { CloudDownload, Columns2, FileText, HardDrive, Server } from 'lucide-react'
import { ShellButton } from './ShellButton'
import { Sheet } from './Sheet'
import { useApp } from '../../store'
import { SERVER_MODE } from '../../lib/session'
import { validateTransferredStudy } from '../../lib/studyTransfer'
import { withServerRevision } from '../../lib/studySync'
import type { Study } from '../../types'
import './patientHistory.css'

interface ServerEntry { id: string; title: string; studyDate: string | null; imageCount: number; hasReport: boolean; reportSigned: boolean; updatedAt: string }
interface Row { id: string; title: string; date: string; images: number; report: 'signed' | 'draft' | 'none'; local?: Study; server?: ServerEntry }

const pid = (s: Pick<Study, 'patient'>) => s.patient.patientId.trim()
const dateOf = (s: Study) => s.patient.studyDate || new Date(s.createdAt).toISOString().slice(0, 10)
const reportState = (s: Study): Row['report'] => (s.report?.signed ? 'signed' : s.report ? 'draft' : 'none')

/** Studies sharing the patient ID, newest first; the current study first among equal dates. */
export function patientRows(current: Study, local: Study[], server: ServerEntry[]): Row[] {
  const id = pid(current)
  if (!id) return []
  const rows = new Map<string, Row>()
  for (const s of local) if (pid(s) === id) rows.set(s.id, { id: s.id, title: s.title, date: dateOf(s), images: s.images.length, report: reportState(s), local: s })
  for (const e of server) {
    const row = rows.get(e.id)
    if (row) row.server = e
    else rows.set(e.id, { id: e.id, title: e.title, date: e.studyDate || e.updatedAt.slice(0, 10), images: e.imageCount, report: e.reportSigned ? 'signed' : e.hasReport ? 'draft' : 'none', server: e })
  }
  return [...rows.values()].sort((a, b) => b.date.localeCompare(a.date) || (a.id === current.id ? -1 : b.id === current.id ? 1 : 0))
}

export function PatientHistory({ study, onClose }: { study: Study; onClose: () => void }) {
  const studies = useApp((s) => s.studies)
  const [server, setServer] = useState<ServerEntry[]>([])
  const [serverState, setServerState] = useState<'idle' | 'loading' | 'error'>(SERVER_MODE && pid(study) ? 'loading' : 'idle')
  const [selected, setSelected] = useState('')
  const [loaded, setLoaded] = useState<Record<string, Study>>({})
  const [loadingId, setLoadingId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!SERVER_MODE || !pid(study)) return
    const controller = new AbortController()
    void fetch(`/api/studies?patientId=${encodeURIComponent(pid(study))}&limit=50&offset=0`, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal })
      .then(async (r) => { if (!r.ok) throw new Error(); const d = await r.json(); setServer(Array.isArray(d.studies) ? d.studies : []); setServerState('idle') })
      .catch(() => { if (!controller.signal.aborted) setServerState('error') })
    return () => controller.abort()
  }, [study])

  const rows = useMemo(() => patientRows(study, studies, server), [study, studies, server])
  const others = rows.filter((r) => r.id !== study.id)
  const pick = others.find((r) => r.id === selected) ?? others[0]
  const other = pick ? pick.local ?? loaded[pick.id] : undefined

  // A server-only study is fetched for comparison without touching the workspace; "Open" adds it there.
  useEffect(() => {
    if (!pick || pick.local || loaded[pick.id] || loadingId === pick.id) return
    setLoadingId(pick.id); setError('')
    void fetch(`/api/studies/${encodeURIComponent(pick.id)}`, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 401 ? 'Your session expired. Sign in again.' : 'This saved study could not be loaded.')
        const d = await r.json()
        const s = withServerRevision(validateTransferredStudy(d.study), d.revision)
        setLoaded((m) => ({ ...m, [s.id]: s }))
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'This saved study could not be loaded.'))
      .finally(() => setLoadingId(''))
  }, [pick, loaded, loadingId])

  const openInWorkspace = (s: Study) => {
    useApp.setState((state) => ({ studies: [s, ...state.studies.filter((x) => x.id !== s.id)] }))
    useApp.getState().selectStudy(s.id)
    onClose()
  }

  const name = study.patient.name || 'Unnamed patient'
  return <Sheet open onClose={onClose} title="Patient history" subtitle={`${name} · ${pid(study) || 'No patient ID'}`} wide>
    {!pid(study) ? <div className="ph-empty"><Columns2 aria-hidden="true" /><h3>Add a patient ID to see history</h3><p>History matches studies by exact patient ID, never by name. Add the ID in patient details.</p><ShellButton className="btn" onClick={() => { onClose(); useApp.getState().openSheet('patient') }}>Patient details</ShellButton></div> : <div className="ph">
      <nav className="ph-timeline" aria-label="Studies for this patient">
        <p className="ph-count">{rows.length} {rows.length === 1 ? 'study' : 'studies'}{serverState === 'loading' ? ' · checking saved studies…' : serverState === 'error' ? ' · saved studies unavailable' : ''}</p>
        <ol>{rows.map((r) => <li key={r.id}>
          <button type="button" className="ph-item" aria-current={r.id === study.id ? 'true' : undefined} aria-pressed={r.id !== study.id && r.id === pick?.id} disabled={r.id === study.id} onClick={() => setSelected(r.id)}>
            <span className="ph-date">{r.date}</span>
            <span className="ph-title">{r.title}{r.id === study.id && <em> · current</em>}</span>
            <span className="ph-meta">
              <span className={`ph-report ph-report--${r.report}`}>{r.report === 'signed' ? 'Signed' : r.report === 'draft' ? 'Draft' : 'No report'}</span>
              <span>{r.images} {r.images === 1 ? 'image' : 'images'}</span>
              {r.local && <span title="In this browser"><HardDrive aria-label="In this browser" /></span>}
              {r.server && <span title="Saved on the server"><Server aria-label="Saved on the server" /></span>}
            </span>
          </button>
        </li>)}</ol>
      </nav>
      <div className="ph-compare">
        {!pick ? <div className="ph-empty"><Columns2 aria-hidden="true" /><h3>No other studies for this patient yet</h3><p>Studies with the same patient ID appear here, from this browser{SERVER_MODE ? ' and your saved studies' : ''}.</p></div> : <>
          <StudyColumn label="Current" study={study} />
          {other ? <StudyColumn label={other.patient.studyDate && other.patient.studyDate < study.patient.studyDate ? 'Prior' : 'Other'} study={other}
            action={!pick.local ? <ShellButton className="btn btn-sm" onClick={() => openInWorkspace(other)}><CloudDownload aria-hidden="true" /> Open in workspace</ShellButton> : <ShellButton className="btn btn-sm" onClick={() => { useApp.getState().selectStudy(other.id); onClose() }}>Open study</ShellButton>} />
            : <section className="ph-col ph-col--loading" role="status">{error || 'Loading saved study…'}</section>}
        </>}
      </div>
    </div>}
    <p className="ph-note">Images are shown as imported, not registered or synchronized. Confirm patient identity and projection before comparing.</p>
  </Sheet>
}

function StudyColumn({ label, study, action }: { label: string; study: Study; action?: React.ReactNode }) {
  const [imageId, setImageId] = useState('')
  const image = study.images.find((i) => i.id === imageId) ?? study.images.find((i) => i.analysis) ?? study.images[0]
  const r = study.report
  const findings = study.images.flatMap((i) => i.analysis?.findings ?? []).filter((f) => f.severity !== 'normal' && f.review !== 'dismissed')
  return <section className="ph-col" aria-label={`${label} study`}>
    <header className="ph-col-head">
      <div><strong>{label}</strong> <span>{study.patient.studyDate || '—'} · {study.title}</span></div>
      {action}
    </header>
    {study.images.length > 1 && <select className="input ph-image-select" aria-label={`${label} image`} value={image?.id ?? ''} onChange={(e) => setImageId(e.target.value)}>{study.images.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>}
    {image?.dataUrl ? <img className="ph-image" src={image.dataUrl} alt={`${label} study: ${image.name}`} /> : <div className="ph-image ph-image--none">No image</div>}
    <div className="ph-report-text">
      <p className="ph-report-status"><FileText aria-hidden="true" />{r?.signed ? `Signed by ${r.radiologist || 'radiologist'}${r.signedAt ? ` · ${new Date(r.signedAt).toLocaleDateString()}` : ''}` : r ? 'Draft report (unsigned)' : 'No report yet'}</p>
      {r?.impression?.trim() ? <><h4>Impression</h4><p>{r.impression}</p></> : null}
      {r?.findings?.trim() ? <><h4>Findings</h4><p>{r.findings}</p></> : null}
      {!r && findings.length > 0 && <><h4>AI findings (not reported)</h4><ul>{findings.map((f) => <li key={f.id}>{f.title}{f.location ? ` · ${f.location}` : ''}</li>)}</ul></>}
      {!r && !findings.length && <p className="ph-muted">{study.images.some((i) => i.analysis) ? 'No abnormal AI findings.' : 'Not analyzed.'}</p>}
    </div>
  </section>
}
