// OWNER: Agent 5. Sidebar — studies grouped by recency, search, inline rename/delete, live status.
import { useState } from 'react'
import { Pencil, Plus, Search, Settings, Trash2 } from 'lucide-react'
import type { ConnectionState, Severity, Study, StudyImage } from '../../types'
import { SEVERITY_LABEL, SEVERITY_ORDER } from '../../types'
import { useApp } from '../../store'
import { cancelImages } from '../../lib/analysis'
import { findingCounts, worstSeverity } from '../../lib/classifier'
import { countLabel } from './shellState'
import { toast } from './toastStore'
import './shell.css'

type Group = 'today' | 'week' | 'older'

export function Sidebar() {
  const studies = useApp((s) => s.studies)
  const activeStudyId = useApp((s) => s.activeStudyId)
  const connection = useApp((s) => s.connection)

  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const openSettings = () => useApp.getState().openSheet('settings')

  const sorted = studies.filter((s) => matches(s, query)).sort((a, b) => b.createdAt - a.createdAt)

  const groups: Record<Group, Study[]> = { today: [], week: [], older: [] }
  for (const s of sorted) groups[groupOf(s.createdAt)].push(s)

  const newStudy = () => {
    useApp.getState().createStudy()
    useApp.getState().selectStudy(useApp.getState().activeStudyId!)
  }

  return (
    <nav className="sh-sidebar" aria-label="Studies">
      <div className="sh-sidebar-head">
        <div className="sh-brand">
          <img className="sh-brand-logo" src="/skanda-mark.png" alt="" aria-hidden />
          Skanda
        </div>
        <button type="button" className="icon-btn" aria-label="New study" onClick={newStudy}>
          <Plus />
        </button>
      </div>

      <div className="sh-search">
        <div className="sh-search-field">
          <Search />
          <input type="text" placeholder="Search studies" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="sh-studies scroll">
        {sorted.length === 0 && (
          <div className="sh-group-label" style={{ marginTop: 24 }}>
            {query ? 'No matches' : 'No studies yet'}
          </div>
        )}
        <GroupBlock label="Today" items={groups.today} activeId={activeStudyId}
          editingId={editingId} setEditingId={setEditingId} editTitle={editTitle} setEditTitle={setEditTitle}
          confirmId={confirmId} setConfirmId={setConfirmId} />
        <GroupBlock label="Previous 7 Days" items={groups.week} activeId={activeStudyId}
          editingId={editingId} setEditingId={setEditingId} editTitle={editTitle} setEditTitle={setEditTitle}
          confirmId={confirmId} setConfirmId={setConfirmId} />
        <GroupBlock label="Older" items={groups.older} activeId={activeStudyId}
          editingId={editingId} setEditingId={setEditingId} editTitle={editTitle} setEditTitle={setEditTitle}
          confirmId={confirmId} setConfirmId={setConfirmId} />
      </div>

      <SidebarFooter connection={connection} onOpenSettings={openSettings} />
    </nav>
  )
}

function GroupBlock({
  label,
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
      <div className="sh-group-label">{label}</div>
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
  const editing = editingId === study.id
  const confirming = confirmId === study.id

  const commitRename = () => {
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
        <input className="input sh-row-edit" autoFocus value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingId(null) }}
          onBlur={commitRename} />
      </div>
    )
  if (confirming)
    return (
      <div className="sh-row sh-row--confirm" role="alertdialog" aria-label="Confirm delete">
        <span className="sh-row-q">Delete “{name}”?</span>
        <button type="button" className="btn btn-sm btn-destructive" autoFocus onClick={deleteStudy}>Delete</button>
        <button type="button" className="btn btn-sm" onClick={() => setConfirmId(null)}>Cancel</button>
      </div>
    )
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active ? 'true' : undefined}
      className={`sh-row${active ? ' sh-row--active' : ''}`}
      onClick={() => useApp.getState().selectStudy(study.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); useApp.getState().selectStudy(study.id) } }}
    >
      <StatusDot sev={status.sev} analyzing={status.analyzing} read={status.read} />
      <div className="sh-row-main">
        <div className="sh-row-title">{name}</div>
        <div className="sh-row-sub">
          {study.patient.patientId && <>{study.patient.patientId} · </>}
          <Subline study={study} status={status} />
        </div>
      </div>
      <div className="sh-row-actions">
        <button type="button" className="icon-btn" aria-label="Rename study"
          onClick={(e) => { e.stopPropagation(); setEditTitle(study.title); setEditingId(study.id) }}>
          <Pencil />
        </button>
        <button type="button" className="icon-btn" aria-label="Delete study"
          onClick={(e) => { e.stopPropagation(); setConfirmId(study.id) }}>
          <Trash2 />
        </button>
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
      <button type="button" className="sh-status" onClick={onOpenSettings}>
        <span className={`sh-status-dot ${dot}`} />
        <span className="sh-status-text">
          <span className="sh-status-a">MedGemma 27B</span>
          <span className="sh-status-b">{label}</span>
        </span>
      </button>
      <button type="button" className="icon-btn" aria-label="Settings" onClick={onOpenSettings}>
        <Settings />
      </button>
    </div>
  )
}

function matches(s: Study, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return s.title.toLowerCase().includes(q) || s.patient.name.toLowerCase().includes(q) || s.patient.patientId.toLowerCase().includes(q)
}

function groupOf(ts: number): Group {
  const d = daysAgo(ts)
  return d <= 1 ? 'today' : d <= 7 ? 'week' : 'older'
}

function daysAgo(ts: number): number {
  const start = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())
  const date = new Date(new Date(ts).getFullYear(), new Date(ts).getMonth(), new Date(ts).getDate())
  return Math.round((start.getTime() - date.getTime()) / 86400000)
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