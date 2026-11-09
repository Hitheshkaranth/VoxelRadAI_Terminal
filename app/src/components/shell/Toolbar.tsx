import { ShellButton } from './ShellButton'
import { analysisEligibility } from '../../lib/modality'
// OWNER: Agent 5. Toolbar — sidebar toggle, editable title, patient chip, Analyze All, connection pill, inspector toggle.
import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, PanelRight, Settings, Zap } from 'lucide-react'
import { useApp, useActiveStudy } from '../../store'
import { toast } from './toastStore'
import { runAnalysisForStudy } from '../../lib/analysis'
import { checkNow } from '../../lib/connection'
import { useShell } from './shellState'
import type { ConnectionState, StudyImage } from '../../types'
import './shell.css'
import { ThemeSwitch } from './ThemeSwitch'

export function Toolbar() {
  const study = useActiveStudy()
  const connection = useApp((s) => s.connection)

  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const renameCancelled = useRef(false)

  const titleText = study?.title || 'Skanda Radiology'

  const startRename = () => {
    if (!study) return
    renameCancelled.current = false
    setTitle(titleText)
    setEditing(true)
  }
  const commitRename = () => {
    if (renameCancelled.current) { setEditing(false); return }
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
        <div className="workspace-title">
        {editing ? (
          <input
            className="sh-title-edit"
            aria-label="Study title"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') { renameCancelled.current = true; setEditing(false) }
            }}
          />
        ) : (
          <ShellButton type="button" className="sh-title-static" disabled={!study} title={study ? 'Rename study' : undefined} onClick={startRename}>
            {titleText}
          </ShellButton>
        )}
        </div>
      </div>

      <div className="sh-toolbar-right">
        <AnalyzeAll studyId={study?.id ?? null} images={study?.images ?? []} connection={connection} />
        <ConnectionPill connection={connection} />
        <InspectorToggle />
        <ThemeSwitch compact />
        <ShellButton type="button" className="icon-btn" aria-label="Settings" onClick={() => useApp.getState().openSheet('settings')}>
          <Settings />
        </ShellButton>
      </div>
    </header>
  )
}

function SidebarToggle() {
  const { sidebarCollapsed, toggleSidebar } = useShell()
  return (
    <ShellButton type="button" className="icon-btn" aria-label={sidebarCollapsed ? 'Show studies' : 'Hide studies'} aria-expanded={!sidebarCollapsed} title={sidebarCollapsed ? 'Show studies' : 'Hide studies'} onClick={toggleSidebar}>
      {sidebarCollapsed ? <ChevronRight /> : <ChevronLeft />}
    </ShellButton>
  )
}

function InspectorToggle() {
  const { inspectorCollapsed, toggleInspector } = useShell()
  return (
    <ShellButton type="button" className="icon-btn" aria-label={inspectorCollapsed ? 'Show findings and report' : 'Hide findings and report'} aria-expanded={!inspectorCollapsed} title={inspectorCollapsed ? 'Show findings and report' : 'Hide findings and report'} onClick={toggleInspector}>
      {inspectorCollapsed ? <ChevronLeft /> : <PanelRight />}
    </ShellButton>
  )
}

function ConnectionPill({ connection }: { connection: ConnectionState }) {
  const model = useApp((s) => s.settings.model)
  const label =
    connection === 'online' ? 'Connected' :
      connection === 'model-missing' ? 'Model not loaded' :
        connection === 'checking' ? 'Checking…' : connection === 'offline' ? 'Offline' : 'Not connected'
  const cls =
    connection === 'online' ? 'sh-connection-pill--online' :
      connection === 'model-missing' ? 'sh-connection-pill--missing' :
        connection === 'checking' ? 'sh-connection-pill--checking' : 'sh-connection-pill--offline'
  return (
    <ShellButton
      type="button"
      className={`sh-connection-pill ${cls}`}
      title="Check the LM Studio connection now"
      aria-label={`${model}: ${label}. Check connection`}
      disabled={connection === 'checking'}
      onClick={() => {
        void checkNow().then((c) => {
          if (c !== 'online') toast(c === 'model-missing' ? 'LM Studio is up, but the model is not loaded' : 'LM Studio is not reachable', 'error')
        })
      }}
    >
      <span className="sh-conn-dot" aria-hidden="true" />
      {label}
    </ShellButton>
  )
}

function AnalyzeAll({ studyId, images, connection }: { studyId: string | null; images: StudyImage[]; connection: ConnectionState }) {
  const analyzingCount = images.filter((i) => i.status === 'analyzing').length
  const idleCount = images.filter((i) => i.status === 'idle' && analysisEligibility(i).supported).length
  const off = connection !== 'online'

  const analyze = () => {
    if (!studyId || idleCount === 0 || off || analyzingCount > 0) return
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
      <ShellButton type="button" className="icon-btn" disabled aria-label="Analyze All">
        <Zap />
      </ShellButton>
    )
  }

  return (
    <ShellButton
      type="button"
      className="btn btn-primary btn-sm sh-analyze-btn"
      onClick={analyze}
      disabled={off || analyzingCount > 0}
      title={off ? 'Connect to a loaded model in Settings before analyzing' : undefined}
    >
      <Zap />
      {label}
    </ShellButton>
  )
}
