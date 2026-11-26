import { ShellButton } from './ShellButton'
// OWNER: Agent 5. Sidebar — studies grouped by recency, search, inline rename/delete, live status.
import { useEffect, useRef, useState } from 'react'
import { ThemeSwitch } from './ThemeSwitch'
import { AlertTriangle, Boxes, CalendarClock, CheckCheck, ChevronRight, ClipboardList, Clock, Pencil, Plus, Scan, Search, Settings, SlidersHorizontal, Trash2, X } from 'lucide-react'
import type { ConnectionState, Severity, Study, StudyImage } from '../../types'
import { SEVERITY_LABEL, SEVERITY_ORDER } from '../../types'
import { track } from '@vercel/analytics'
import { useApp } from '../../store'
import { cancelImages } from '../../lib/analysis'
import { findingCounts, worstSeverity } from '../../lib/classifier'
import { countLabel, useShell } from './shellState'
import { toast } from './toastStore'
import { activeFacetCount, filterWorklist, formatAge, hasUrgentCandidate, OVERDUE_CHOICES, studyPriority, studyStatus as readingStatus, turnaround, workflowLabel, worklistModalities, type WorklistFilter, type WorklistSort, type WorklistUrgency } from '../../lib/worklist'
import { stepStudy, useWorklist } from './worklistNav'
import { isTypingTarget } from '../viewer/readingControls'
import { formatDue, studyFollowUp, type FollowUpFacet, type FollowUpStatus } from '../../lib/followUps'
import { SampleStudies } from './SampleStudies'
import { StorageMeterCompact } from './AccountStorage'
import { SERVER_MODE } from '../../lib/session'
import { volumeSourceKind } from '../../lib/volumeIdentity'
import './shell.css'
import './worklist.css'
import './volumeIdentity.css'


export function Sidebar() {
  const studies = useApp((s) => s.studies)
  const activeStudyId = useApp((s) => s.activeStudyId)
  const volume = useShell((s) => s.volumeSource)
  const connection = useApp((s) => s.connection)

  const query = useWorklist((s) => s.query)
  const setQuery = useWorklist((s) => s.setQuery)
  const prefs = useWorklist((s) => s.prefs)
  const setPrefs = useWorklist((s) => s.setPrefs)
  const { filter, sort } = prefs
  const setFilter = (next: WorklistFilter) => setPrefs({ filter: next })
  const [filtersOpen, setFiltersOpen] = useState(() => activeFacetCount(prefs) > 0)
  const now = useNow()
  const overdueMs = prefs.overdueHours * 3600000
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const openSettings = () => useApp.getState().openSheet('settings')

  const sorted = filterWorklist(studies, query, filter, sort, prefs)
  // Pill counts respect the other facets so each number matches what the pill would show.
  const faceted = filterWorklist(studies, query, 'all', sort, prefs)
  const countOf = (status: WorklistFilter) => status === 'all' ? faceted.length : faceted.filter((s) => readingStatus(s) === status).length
  const modalities = worklistModalities(studies)
  const facetCount = activeFacetCount(prefs)
  const clearFacets = () => setPrefs({ modality: '', urgency: '', from: '', to: '', followUp: '' })
  useStudyStepKeys()

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
          <img className="sh-brand-logo" src="/radgenis-mark.png" alt="" aria-hidden />
          RadGenis
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
      <div className="wl-filters" role="group" aria-label="Filter studies by reading status">
        {([
          ['all', 'All', 'Every study'], ['unread', 'Unread', 'Not analyzed yet'], ['review', 'Review', 'Analyzed, no report drafted'],
          ['draft', 'Draft', 'Report drafted, not signed'], ['signed', 'Signed', 'Signed reports'],
        ] as const).map(([key, label, hint]) => (
          <ShellButton key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} title={hint}>
            {label}<span>{countOf(key)}</span>
          </ShellButton>
        ))}
      </div>
      <div className="wl-list-heading">
        <span aria-live="polite">{sorted.length} {sorted.length === 1 ? 'study' : 'studies'}</span>
        <ShellButton type="button" className="wl-facet-toggle" aria-expanded={filtersOpen} aria-controls="wl-facets" onClick={() => setFiltersOpen((v) => !v)}>
          <SlidersHorizontal aria-hidden="true" />Filters{facetCount > 0 && <span>{facetCount}</span>}
        </ShellButton>
        <select aria-label="Sort studies" value={sort} onChange={(e) => setPrefs({ sort: e.target.value as WorklistSort })}>
          <option value="recent">Recently updated</option><option value="priority">AI priority first</option>
        </select>
      </div>
      {filtersOpen && <div className="wl-facets" id="wl-facets" role="group" aria-label="More study filters">
        <label>Modality
          <select value={prefs.modality} onChange={(e) => setPrefs({ modality: e.target.value })}>
            <option value="">Any</option>
            {[...new Set([...modalities, ...(prefs.modality ? [prefs.modality] : [])])].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>AI urgency
          <select value={prefs.urgency} onChange={(e) => setPrefs({ urgency: e.target.value as WorklistUrgency })}>
            <option value="">Any</option><option value="urgent">Urgent</option><option value="priority">Priority</option><option value="routine">Routine</option>
          </select>
        </label>
        <label>Follow-up
          <select value={prefs.followUp} onChange={(e) => setPrefs({ followUp: e.target.value as FollowUpFacet })}>
            <option value="">Any</option><option value="due">Due in 30 days or overdue</option><option value="open">Any tracked, not done</option>
          </select>
        </label>
        <label>From<input type="date" value={prefs.from} max={prefs.to || undefined} onChange={(e) => setPrefs({ from: e.target.value })} /></label>
        <label>To<input type="date" value={prefs.to} min={prefs.from || undefined} onChange={(e) => setPrefs({ to: e.target.value })} /></label>
        <label>Flag waiting over
          <select value={prefs.overdueHours} onChange={(e) => setPrefs({ overdueHours: Number(e.target.value) })}>
            {OVERDUE_CHOICES.map((h) => <option key={h} value={h}>{h === 0 ? 'Off' : `${h} h`}</option>)}
          </select>
        </label>
        {facetCount > 0 && <ShellButton type="button" className="btn btn-sm" onClick={clearFacets}>Clear filters</ShellButton>}
        <p className="wl-facet-hint">Dates use the study date, or the day the study was added. <kbd>N</kbd> / <kbd>Shift</kbd>+<kbd>N</kbd> open the next or previous study in this list.</p>
      </div>}
      <div className="sh-studies scroll">
        {sorted.length === 0 ? (
          <div className="wl-empty">
            {filter === 'signed' ? <CheckCheck /> : <ClipboardList />}
            <strong>{!studies.length ? (volume ? 'No image studies' : 'No studies') : query || facetCount ? 'No matching studies' : EMPTY_TITLE[filter]}</strong>
            <p>{!studies.length ? (volume ? 'The open volume is listed above. Imported image studies appear here.' : 'Create a study, add images, then review the findings.') : query ? 'Try a patient name, ID, or study title.' : facetCount ? 'Clear or widen the modality, urgency, follow-up or date filters.' : EMPTY_HINT[filter]}</p>
            {!studies.length ? <ShellButton className="btn btn-primary" onClick={newStudy}><Plus /> Create study</ShellButton> : (query || filter !== 'all' || facetCount > 0) && <ShellButton className="btn" onClick={() => { setQuery(''); setFilter('all'); clearFacets() }}>Show all studies</ShellButton>}
          </div>
        ) : (
          <GroupBlock label={sort === 'priority' ? 'Ordered by model urgency' : 'Most recently updated'} items={sorted} activeId={volume ? null : activeStudyId}
            editingId={editingId} setEditingId={setEditingId} editTitle={editTitle} setEditTitle={setEditTitle}
            confirmId={confirmId} setConfirmId={setConfirmId} now={now} overdueMs={overdueMs} />
        )}
      </div>
      <SampleStudies onOpen={() => { setQuery(''); setFilter('all'); clearFacets() }} />
      {SERVER_MODE ? <StorageMeterCompact /> : <div className="wl-storage-note">Stored in this browser</div>}

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
  now,
  overdueMs,
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
  now: number
  overdueMs: number
}) {
  if (!items.length) return null
  return (
    <section className="sh-group">

      {items.map((s) => (
        <StudyRow key={s.id} study={s} activeStudyId={activeId} editingId={editingId} setEditingId={setEditingId}
          editTitle={editTitle} setEditTitle={setEditTitle} confirmId={confirmId} setConfirmId={setConfirmId} now={now} overdueMs={overdueMs} />
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
  now,
  overdueMs,
}: {
  study: Study
  activeStudyId: string | null
  editingId: string | null
  setEditingId: (v: string | null) => void
  editTitle: string
  setEditTitle: (v: string) => void
  confirmId: string | null
  setConfirmId: (v: string | null) => void
  now: number
  overdueMs: number
}) {
  const name = study.patient.name || study.title
  const wait = turnaround(study, now, overdueMs)
  const urgent = hasUrgentCandidate(study)
  const status = studyStatus(study.images)
  const priority = studyPriority(study)
  const followUp = studyFollowUp(study, now)
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
        <span className="wl-study-top">
          <span className="sh-row-title">{name}</span>
          <ChevronRight aria-hidden="true" />
        </span>
        <span className="wl-patient-id">{study.patient.patientId || 'Patient ID not entered'}</span>
        <span className="sh-row-sub"><Subline study={study} status={status} /></span>
        <span className="wl-study-status">
          <span className="wl-workflow" data-state={study.report?.signed ? 'signed' : status.analyzing ? 'analyzing' : 'pending'}>{workflow}</span>
          {urgent && <span className="wl-critical" title="The model marked at least one finding urgent. Candidate only: confirm on review."><AlertTriangle aria-hidden="true" />AI urgent</span>}
          {priority === 1 && <span className="wl-priority" data-priority={priority}>AI priority</span>}
          {followUp && <span className="wl-follow-up" data-status={followUp.status}
            title={`${followUp.count} tracked follow-up${followUp.count === 1 ? '' : 's'}. Next: ${followUp.item.text}`}>
            <CalendarClock aria-hidden="true" />{followUpBadge(followUp.status, followUp.item.dueAt)}
          </span>}
          {wait && <span className="wl-age" data-overdue={wait.overdue || undefined}
            title={`Waiting ${formatAge(wait.sinceCreated)} since the study was added${wait.sinceAnalysis !== undefined ? `, ${formatAge(wait.sinceAnalysis)} since the last AI read` : ''}${wait.overdue ? '. Over the waiting threshold.' : '.'}`}>
            <Clock aria-hidden="true" />{formatAge(wait.sinceCreated)}{wait.sinceAnalysis !== undefined && <> · read {formatAge(wait.sinceAnalysis)} ago</>}
          </span>}
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
      <ShellButton type="button" className="icon-btn" aria-label="Open models and benchmarks" title="Open models" onClick={() => { useApp.getState().openSheet('models'); track('open_models', { from: 'sidebar' }) }}>
        <Boxes />
      </ShellButton>
      <ShellButton type="button" className="icon-btn" aria-label="Settings" onClick={onOpenSettings}>
        <Settings />
      </ShellButton>
    </div>
  )
}

const EMPTY_TITLE: Record<WorklistFilter, string> = { all: 'No studies', unread: 'No unread studies', review: 'No studies awaiting review', draft: 'No draft reports', signed: 'No signed reports yet' }
const EMPTY_HINT: Record<WorklistFilter, string> = {
  all: 'Create a study, add images, then review the findings.',
  unread: 'Studies with images that have not been analyzed appear here.',
  review: 'Analyzed studies without a drafted report appear in this queue.',
  draft: 'Drafted, unsigned reports appear here.',
  signed: 'Signed reports will appear here after review.',
}

/** Short worklist label for the most pressing tracked follow-up. */
function followUpBadge(status: FollowUpStatus, dueAt: number | undefined): string {
  if (status === 'overdue') return 'Follow-up overdue'
  if (dueAt && (status === 'due-soon' || status === 'scheduled')) return `Follow-up ${formatDue(dueAt)}`
  return 'Follow-up tracked'
}

/** Minute clock for waiting times; one timer per sidebar, not per row. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(id) }, [])
  return now
}

/** N / Shift+N walk the visible worklist; ignored while typing or with browser modifiers. */
function useStudyStepKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyN' || e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTypingTarget(e.target)) return
      if (!stepStudy(e.shiftKey ? -1 : 1)) toast(e.shiftKey ? 'Already at the first study in this list.' : 'No more studies in this list.', 'info')
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
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
