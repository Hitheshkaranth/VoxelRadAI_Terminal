import { FileText, Images, ListFilter, ScanLine, Settings, UserRound } from 'lucide-react'
import { useActiveStudy, useApp } from '../../store'
import { volumeSourceKind } from '../../lib/volumeIdentity'
import { useShell, type MobileView } from './shellState'

const destinations = [
  { view: 'studies', label: 'Studies', icon: ListFilter },
  { view: 'viewer', label: 'Viewer', icon: Images },
  { view: 'findings', label: 'Findings', icon: ScanLine },
  { view: 'report', label: 'Report', icon: FileText },
] as const

export function MobileNavigation() {
  const study = useActiveStudy()
  const volume = useShell((s) => s.volumeSource)
  const view = useShell((s) => s.mobileView)
  const setView = useShell((s) => s.setMobileView)
  // The inspector can also be changed by actions inside the report/findings panels.
  const tab = useApp((s) => s.inspectorTab)
  const selected: MobileView = volume ? view : !study ? 'studies' : view === 'findings' || view === 'report' ? tab : view
  return (
    <nav className="mobile-nav" aria-label="Mobile workspace">
      {destinations.map(({ view: target, label, icon: Icon }) => (
        <button key={target} type="button" disabled={!volume && !study && target !== 'studies'}
          aria-current={selected === target ? 'page' : undefined}
          onClick={() => setView(target)}>
          <Icon aria-hidden="true" /><span>{label}</span>
        </button>
      ))}
    </nav>
  )
}

export function MobileHeader() {
  const study = useActiveStudy()
  const volume = useShell((s) => s.volumeSource)
  const view = useShell((s) => s.mobileView)
  const connection = useApp((s) => s.connection)
  const openSheet = useApp((s) => s.openSheet)
  const reading = study && !volume && view !== 'studies'
  return (
    <header className="mobile-header">
      <div className="mobile-heading">
        
        <strong>{volume && view !== 'studies' ? volume.title : reading ? study.patient.name || study.title : 'Study worklist'}</strong>
        <span className="mobile-context">{volume && view !== 'studies' ? `${volumeSourceKind(volume)} · Patient not linked` : reading
          ? [study.patient.patientId || 'No patient ID', study.patient.studyDate || 'No study date'].join(' · ')
          : 'Skanda · Local studies'}</span>
      </div>
      {reading && <button className="icon-btn" aria-label="Patient details" onClick={() => openSheet('patient')}><UserRound /></button>}
      <button className="icon-btn mobile-settings" aria-label={`Settings — ${connection === 'online' ? 'model connected' : connection.replace('-', ' ')}`} onClick={() => openSheet('settings')}>
        <Settings /><span className="mobile-connection" data-online={connection === 'online'} />
      </button>
    </header>
  )
}
