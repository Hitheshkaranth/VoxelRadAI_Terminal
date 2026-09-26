// OWNER: Agent 5. Toolbar — sidebar toggle, editable title, patient chip, Analyze All, connection pill, inspector toggle.
import { useState } from 'react'
import { ChevronLeft, ChevronRight, PanelRight, Settings, User, Zap } from 'lucide-react'
import { useApp, useActiveStudy } from '../../store'
import { toast } from './toastStore'
import { runAnalysisForStudy } from '../../lib/analysis'
import { useShell } from './shellState'
import type { ConnectionState, PatientInfo, StudyImage } from '../../types'
import './shell.css'

export function Toolbar() {
  const study = useActiveStudy()
  const connection = useApp((s) => s.connection)

  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')

  const titleText = study?.title || 'Skanda Radiology'

  const startRename = () => {
    setTitle(titleText)
    setEditing(true)
  }
  const commitRename = () => {
    if (study) {
      const next = title.trim() || 'Untitled Study'
      useApp.getState().renameStudy(study.id, next)
      toast('Study renamed', 'success')
    }
    setEditing(false)
  }

  return (
    <header className="sh-toolbar">
      <div className="sh-toolbar-left">
        <SidebarToggle />
        {editing ? (
          <input
            className="sh-title-edit"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(false) }}
          />
        ) : (
          <button type="button" className="sh-title-static" onMouseUp={startRename}>
            {titleText}
          </button>
        )}
        {study && <PatientChip patient={study.patient} onOpen={() => useApp.getState().openSheet('patient')} />}
      </div>

      <div className="sh-toolbar-right">
        <AnalyzeAll studyId={study?.id ?? null} images={study?.images ?? []} />
        <ConnectionPill connection={connection} />
        <InspectorToggle />
        <button type="button" className="icon-btn" aria-label="Settings" onClick={() => useApp.getState().openSheet('settings')}>
          <Settings />
        </button>
      </div>
    </header>
  )
}

function SidebarToggle() {
  const { sidebarCollapsed, toggleSidebar } = useShell()
  return (
    <button type="button" className="icon-btn" aria-label="Toggle sidebar" onClick={toggleSidebar}>
      {sidebarCollapsed ? <ChevronRight /> : <ChevronLeft />}
    </button>
  )
}

function InspectorToggle() {
  const { inspectorCollapsed, toggleInspector } = useShell()
  return (
    <button type="button" className="icon-btn" aria-label="Toggle inspector" onClick={toggleInspector}>
      {inspectorCollapsed ? <ChevronLeft /> : <PanelRight />}
    </button>
  )
}

function ConnectionPill({ connection }: { connection: ConnectionState }) {
  const label =
    connection === 'online' ? 'Connected' :
      connection === 'model-missing' ? 'Model not loaded' :
        connection === 'checking' ? 'Checking…' : connection === 'offline' ? 'Offline' : 'Not connected'
  const cls =
    connection === 'online' ? 'sh-connection-pill--online' :
      connection === 'model-missing' ? 'sh-connection-pill--missing' :
        connection === 'checking' ? 'sh-connection-pill--checking' : 'sh-connection-pill--offline'
  return (
    <button type="button" className={`sh-connection-pill ${cls}`}>
      <span className="sh-conn-dot" />
      {label}
    </button>
  )
}

function AnalyzeAll({ studyId, images }: { studyId: string | null; images: StudyImage[] }) {
  const analyzingCount = images.filter((i) => i.status === 'analyzing').length
  const idleCount = images.filter((i) => i.status === 'idle').length

  const analyze = () => {
    if (!studyId || idleCount === 0) return
    runAnalysisForStudy(studyId)
    toast('Analysis started', 'info')
  }

  const label =
    analyzingCount > 0
      ? `Analyzing ${analyzingCount} of ${images.length}`
      : idleCount > 0
        ? 'Analyze All'
        : null

  if (!label) {
    return (
      <button type="button" className="icon-btn" disabled aria-label="Analyze All">
        <Zap />
      </button>
    )
  }

  return (
    <button type="button" className="btn btn-primary btn-sm sh-analyze-btn" onClick={analyze}>
      <Zap />
      {label}
    </button>
  )
}

function PatientChip({ patient, onOpen }: { patient: PatientInfo; onOpen: () => void }) {
  const initials = initialsFrom(patient.name)
  return (
    <button type="button" className="sh-patient-chip" onClick={onOpen}>
      {initials ? (
        <span className="sh-avatar">{initials}</span>
      ) : (
        <span className="sh-avatar sh-avatar--empty" aria-hidden>
          <User />
        </span>
      )}
      {initials ? (
        <span className="sh-patient-info">
          <span className="sh-patient-name">{patient.name}</span>
          <span className="sh-patient-desc">{patientDesc(patient)}</span>
        </span>
      ) : (
        <span className="sh-patient-add">
          <User />
          Add patient details
        </span>
      )}
    </button>
  )
}

function patientDesc(patient: PatientInfo): string {
  const parts: string[] = []
  if (patient.age) parts.push(`${patient.age}y`)
  if (patient.sex) parts.push(patient.sex === 'Other' ? 'Non-binary' : patient.sex)
  return parts.join(' · ')
}

function initialsFrom(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  let out = ''
  for (const w of words) {
    out += w[0]
    if (out.length >= 2) break
  }
  return out.toUpperCase()
}