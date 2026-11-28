import { ShellButton } from './ShellButton'
import { useState } from 'react'
import { History, UserRound } from 'lucide-react'
import { useActiveStudy, useApp } from '../../store'
import { PatientHistory } from './PatientHistory'

export function ClinicalContext() {
  const study = useActiveStudy()
  const studies = useApp((s) => s.studies)
  const [open, setOpen] = useState(false)
  if (!study) return null
  // Other studies in this browser with the same patient ID; the history view adds saved studies from the server.
  const id = study.patient.patientId.trim()
  const others = id ? studies.filter((s) => s.id !== study.id && s.patient.patientId.trim() === id).length : 0
  return <>
    <section className="clinical-context" aria-label="Clinical context">
      <ShellButton className="clinical-patient" onClick={() => useApp.getState().openSheet('patient')}>
        <UserRound aria-hidden="true" />
        <span><strong>{study.patient.name || 'Add patient details'}</strong><small>{[study.patient.patientId || 'No patient ID', study.patient.age && `${study.patient.age}y`, study.patient.sex, study.patient.studyDate].filter(Boolean).join(' · ')}</small></span>
      </ShellButton>
      <div className="clinical-indication"><span>Clinical indication</span><p>{study.patient.indication || 'No indication provided'}</p></div>
      <ShellButton className="btn btn-sm clinical-priors" onClick={() => setOpen(true)} title="Patient history: earlier studies and reports side by side"><History /> History <span>{others}</span></ShellButton>
    </section>
    {open && <PatientHistory study={study} onClose={() => setOpen(false)} />}
  </>
}
