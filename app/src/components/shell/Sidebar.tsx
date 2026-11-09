import { ShellButton } from './ShellButton'
// OWNER: Agent 5. Sidebar — studies grouped by recency, search, inline rename/delete, live status.
import { useEffect, useRef, useState } from 'react'
import { ThemeSwitch } from './ThemeSwitch'
import { CheckCheck, ChevronRight, ClipboardList, Pencil, Plus, Scan, Search, Settings, Trash2, X } from 'lucide-react'
import type { ConnectionState, Severity, Study, StudyImage } from '../../types'
import { SEVERITY_LABEL, SEVERITY_ORDER } from '../../types'
import { useApp } from '../../store'
import { cancelImages } from '../../lib/analysis'
import { findingCounts, worstSeverity } from '../../lib/classifier'
import { countLabel, useShell } from './shellState'
import { toast } from './toastStore'
import { filterWorklist, needsReview, studyPriority, workflowLabel, type WorklistFilter, type WorklistSort } from '../../lib/worklist'
import { SampleStudies } from './SampleStudies'
import { volumeSourceKind } from '../../lib/volumeIdentity'
import './shell.css'
import './worklist.css'
import './volumeIdentity.css'


export function Sidebar() {
  const studies = useApp((s) => s.studies)
  const activeStudyId = useApp((s) => s.activeStudyId)
  const volume = useShell((s) => s.volumeSource)
  const connection = useApp((s) => s.connection)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<WorklistFilter>('all')
  const [sort, setSort] = useState<WorklistSort>('recent')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const openSettings = () => useApp.getState().openSheet('settings')

  const sorted = filterWorklist(studies, query, filter, sort)
  const reviewCount = studies.filter(needsReview).length
  const signedCount = studies.filter((s) => s.report?.signed).length

  const newStudy = () => {
    useShell.getState().closeVolume()
    useApp.getState().createStudy()
    useApp.getState().selectStudy(useApp.getState().activeStudyId!)
    useShell.getState().setMobileView('viewer')
  }

  return (
    <nav className="sh-sidebar wl-sidebar" aria-label="Studies">
      <div className="sh-sidebar-head">
        <div className="sh-brand">
          <img className="sh-brand-logo" src="/skanda-mark.png" alt="" aria-hidden />
          Skanda
        </div>
        <ThemeSwitch compact />
      </div>

      {volume && <section className="wl-volume-context" aria-label="Open volume">
        <div className="wl-volume-context-label">Open volume</div>
        <ShellButton className="wl-volume-current" aria-current="page" onClick={() => useShell.getState().setMobileView('viewer')}>
          <Scan aria-hidden="true" />
          <span><strong>{volume.title}</strong><small>{volumeSourceKind(volume)} · {volume.modality === 'Volume' ? 'Modality not specified' : volume.modality}</small><small>Patient not linked</small></span>
        </ShellButton>
      </section>}
      <div className="wl-heading">
        <div><h2>Studies <span>{studies.length}</span></h2></div>
        <ShellButton type="button" className="wl-new" aria-label="New study" onClick={newStudy}><Plus /><span>New</span></ShellButton>
      </div>
      <div className="sh-search">
        <div className="sh-search-field">
          <Search aria-hidden="true" />
          <input type="search" aria-label="Search studies" placeholder="Patient, ID or study" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <ShellButton className="wl-clear" aria-label="Clear study search" onClick={() => setQuery('')}><X /></ShellButton>}
        </div>
      </div>
      <div className="wl-filters" role="group" aria-label="Filter studies">
        {([
          ['all', 'All', studies.length], ['review', 'Review', reviewCount], ['signed', 'Signed', signedCount],
        ] as const).map(([key, label, count]) => (
          <ShellButton key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} title={key === 'review' ? 'Analyzed studies awaiting a signed report' : undefined}>
            {label}<span>{count}</span>
          </ShellButton>
        ))}
      </div>
      <div className="wl-list-heading">
        <span aria-live="polite">{sorted.length} {sorted.length === 1 ? 'study' : 'studies'}</span>
        <select aria-label="Sort studies" value={sort} onChange={(e) => setSort(e.target.value as WorklistSort)}>
          <option value="recent">Recently updated</option><option value="priority">AI priority first</option>
        </select>
      </div>
      <div className="sh-studies scroll">
        {sorted.length === 0 ? (
          <div className="wl-empty">
            {filter === 'signed' ? <CheckCheck /> : <ClipboardList />}
            <strong>{!studies.length ? (volume ? 'No image studies' : 'No studies') : query ? 'No matching studies' : filter === 'signed' ? 'No signed reports yet' : 'No studies awaiting review'}</strong>
            <p>{!studies.length ? (volume ? 'The open volume is listed above. Imported image studies appear here.' : 'Create a study, add images, then review the findings.') : query ? 'Try a patient name, ID, or study title.' : filter === 'signed' ? 'Signed reports will appear here after review.' : 'Analyzed, unsigned studies appear in this queue.'}</p>
            {!studies.length ? <ShellButton className="btn btn-primary" onClick={newStudy}><Plus /> Create study</ShellButton> : (query || filter !== 'all') && <ShellButton className="btn" onClick={() => { setQuery(''); setFilter('all') }}>Show all studies</ShellButton>}
          </div>
        ) : (
          <GroupBlock label={sort === 'priority' ? 'Ordered by model urgency' : 'Most recently updated'} items={sorted} activeId={volume ? null : activeStudyId}
            editingId={editingId} setEditingId={setEditingId} editTitle={editTitle} setEditTitle={setEditTitle}
            confirmId={confirmId} setConfirmId={setConfirmId} />
        )}
      </div>
      <SampleStudies onOpen={() => { setQuery(''); setFilter('all') }} />
      <div className="wl-storage-note">Stored in this browser</div>

      <SidebarFooter connection={connection} onOpenSettings={openSettings} />
    </nav>
  )
}

function GroupBlock({
  items,
  activeId,
  editingId,
  setEditingId,
  editTitle,
  setEditTitle,
  confirmId,
  setConfirmId,
}: {
  label: string
  items: Study[]
  activeId: string | null
  editingId: string | null
  setEditingId: (v: string | null) => void
  editTitle: string
  setEditTitle: (v: string) => void
  confirmId: string | null
  setConfirmId: (v: string | null) => void
}) {
  if (!items.length) return null
  return (
    <section className="sh-group">

      {items.map((s) => (
        <StudyRow key={s.id} study={s} activeStudyId={activeId} editingId={editingId} setEditingId={setEditingId}
          editTitle={editTitle} setEditTitle={setEditTitle} confirmId={confirmId} setConfirmId={setConfirmId} />
      ))}
    </section>
  )
}

function StudyRow({
  study,
  activeStudyId,
  editingId,
  setEditingId,
  editTitle,
  setEditTitle,
  confirmId,
  setConfirmId,
}: {
  study: Study
  activeStudyId: string | null
  editingId: string | null
  setEditingId: (v: string | null) => void
  editTitle: string
  setEditTitle: (v: string) => void
  confirmId: string | null
  setConfirmId: (v: string | null) => void
}) {
  const name = study.patient.name || study.title
  const status = studyStatus(study.images)
  const priority = studyPriority(study)
  const workflow = workflowLabel(study)
  const editing = editingId === study.id
  const confirming = confirmId === study.id
  const renameCancelled = useRef(false)
  const renameButton = useRef<HTMLButtonElement>(null)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const previousMode = useRef({ editing, confirming })
  useEffect(() => {
    if (previousMode.current.editing && !editing) renameButton.current?.focus()
    if (previousMode.current.confirming && !confirming) deleteButton.current?.focus()
    previousMode.current = { editing, confirming }
  }, [editing, confirming])

  const commitRename = () => {
    if (renameCancelled.current) { setEditingId(null); return }
    const next = editTitle.trim() || study.title
    useApp.getState().renameStudy(study.id, next)
    setEditingId(null)
  }
  const deleteStudy = () => {
    // Stop queued / running reads first so they don't write into a deleted study.
    cancelImages(study.images.map((i) => i.id))
    useApp.getState().deleteStudy(study.id)
    useApp.getState().openSheet(null)
    toast('Study deleted', 'success')
    setConfirmId(null)
  }

  const active = activeStudyId === study.id
  if (editing)
    return (
      <div className="sh-row sh-row--active">
        <input className="input sh-row-edit" aria-label="Study title" autoFocus value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.preventDefault(); renameCancelled.current = true; setEditingId(null) } }}
          onBlur={commitRename} />
      </div>
    )
  if (confirming)
    return (
      <div className="sh-row sh-row--confirm" role="group" aria-label={`Confirm deletion of ${name}`} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setConfirmId(null) } }}>
        <span className="sh-row-q">Delete “{name}”?</span>
        <ShellButton type="button" className="btn btn-sm btn-destructive" onClick={deleteStudy}>Delete</ShellButton>
        <ShellButton type="button" className="btn btn-sm" autoFocus onClick={() => setConfirmId(null)}>Cancel</ShellButton>
      </div>
    )
  return (
    <div className={`sh-row wl-study${active ? ' sh-row--active' : ''}`}>
      <ShellButton type="button" className="wl-open-study"
        aria-current={active ? 'true' : undefined}
        onClick={() => { useShell.getState().closeVolume(); useApp.getState().selectStudy(study.id); useShell.getState().setMobileView('viewer') }}>
      <StatusDot sev={status.sev} analyzing={status.analyzing} read={status.read} />
      <span className="sh-row-main">
        <span className="wl-study-top"><span className="sh-row-title">{name}</span><ChevronRight aria-hidden="true" /></span>
        <span className="wl-patient-id">{study.patient.patientId || 'Patient ID not entered'}</span>
        <span className="sh-row-sub"><Subline study={study} status={status} /></span>
        <span className="wl-study-status">
          <span className="wl-workflow" data-state={study.report?.signed ? 'signed' : status.analyzing ? 'analyzing' : 'pending'}>{workflow}</span>
          {priority > 0 && <span className="wl-priority" data-priority={priority}>AI {priority === 2 ? 'urgent' : 'priority'}</span>}
        </span>
      </span>
      </ShellButton>
      <div className="sh-row-actions">
        <ShellButton ref={renameButton} type="button" className="icon-btn" aria-label={`Rename ${name}`}
          onClick={(e) => { e.stopPropagation(); renameCancelled.current = false; setEditTitle(study.title); setEditingId(study.id) }}>
          <Pencil />
        </ShellButton>
        <ShellButton ref={deleteButton} type="button" className="icon-btn" aria-label={`Delete ${name}`}
          onClick={(e) => { e.stopPropagation(); setConfirmId(study.id) }}>
          <Trash2 />
        </ShellButton>
      </div>
    </div>
  )
}

function Subline({ study, status }: { study: Study; status: StudyStatus }) {
  if (status.analyzing) return <>analyzing…</>
  const n = study.images.length
  return (
    <>
      {fmtDate(study.updatedAt)} · {n} image{n === 1 ? '' : 's'}
      {status.read && (
        <>
          {' · '}
          {countLabel(status.active, status.flagged)}
        </>
      )}
      {status.sev && status.sev !== 'normal' && (
        <>
          {' · '}<span className="sh-sev-tag">{SEVERITY_LABEL[status.sev]}</span>
        </>
      )}
    </>
  )
}

function StatusDot({ sev, analyzing, read }: { sev: Severity | null; analyzing: boolean; read: boolean }) {
  if (analyzing) return <span className="sh-ping sh-ping--spin" role="img" aria-label="Analyzing" />
  if (sev) return <span className="sh-ping" data-severity={sev} role="img" aria-label={sev === 'normal' ? 'No acute findings' : SEVERITY_LABEL[sev]} />
  return (
    <span className="sh-ping" role="img" aria-label={read ? 'Read' : 'Not analyzed yet'}
      style={{ '--c': 'var(--label-4)' } as React.CSSProperties} />
  )
}

function SidebarFooter({ connection, onOpenSettings }: { connection: ConnectionState; onOpenSettings: () => void }) {
  const model = useApp((s) => s.settings.model)
  const label =
    connection === 'online' ? 'Connected' :
      connection === 'model-missing' ? 'Model not loaded' :
        connection === 'checking' ? 'Checking…' : connection === 'offline' ? 'Offline' : 'Not connected'
  const dot =
    connection === 'online' ? 'sh-status-dot--online' :
      connection === 'model-missing' ? 'sh-status-dot--missing' :
        connection === 'checking' ? 'sh-status-dot--checking' : 'sh-status-dot--offline'

  return (
    <div className="sh-sidebar-foot">
      <ShellButton type="button" className="sh-status" onClick={onOpenSettings}>
        <span className={`sh-status-dot ${dot}`} />
        <span className="sh-status-text">
          <span className="sh-status-a" title={model}>{model}</span>
          <span className="sh-status-b">{label}</span>
        </span>
      </ShellButton>
      <ShellButton type="button" className="icon-btn" aria-label="Settings" onClick={onOpenSettings}>
        <Settings />
      </ShellButton>
    </div>
  )
}

function fmtDate(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface StudyStatus { sev: Severity | null; analyzing: boolean; read: boolean; active: number; flagged: number }

/** Worst active severity and counts across a study — same helpers as the filmstrip and inspector. */
function studyStatus(images: StudyImage[]): StudyStatus {
  let sev: Severity | null = null
  let analyzing = false
  let read = false
  let active = 0
  let flagged = 0
  for (const img of images) {
    if (img.status === 'analyzing') analyzing = true
    const a = img.analysis
    if (!a) continue
    read = true
    const c = findingCounts(a)
    active += c.active
    flagged += c.flagged
    const w = worstSeverity(a.findings) ?? 'normal'
    if (sev === null || SEVERITY_ORDER.indexOf(w) < SEVERITY_ORDER.indexOf(sev)) sev = w
  }
  return { sev, analyzing, read, active, flagged }
}
