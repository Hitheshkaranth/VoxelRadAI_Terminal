// OWNER: Agent 5. PatientSheet — modal form for patient demographic + clinical details, live-saved.
import { useState } from 'react'
import { useApp, useActiveStudy } from '../../store'
import { Sheet } from './Sheet'
import { useShell } from './shellState'
import type { PatientInfo } from '../../types'
import './shell.css'

export function PatientSheet() {
  const study = useActiveStudy()
  const openSheet = useApp((s) => s.openSheet)
  const updatePatient = useApp((s) => s.updatePatient)
  const { setSidebarCollapsed, setInspectorCollapsed } = useShell()

  const [open] = useState(true)

  if (!study) {
    return (
      <Sheet open={open} onClose={() => openSheet(null)} title="Patient details">
        <p className="sh-about-sub">
          Create or open a study first, then add patient details.
        </p>
        <div className="sh-sheet-foot">
          <button type="button" className="btn btn-primary" onClick={() => {
            const id = useApp.getState().createStudy()
            useApp.getState().selectStudy(id)
            openSheet(null)
            setSidebarCollapsed(false)
            setInspectorCollapsed(false)
          }}>
            New study
          </button>
        </div>
      </Sheet>
    )
  }

  const patient = study.patient

  const change = (patch: Partial<PatientInfo>) => updatePatient(study.id, patch)

  return (
    <Sheet open={open} onClose={() => openSheet(null)} title="Patient details" subtitle="Demographics and clinical context.">
      <div className="sh-grid">
        <Field label="Name">
          <input
            className="input"
            value={patient.name}
            onChange={(e) => change({ name: e.target.value })}
            placeholder="Jane Doe"
          />
        </Field>

        <Field label="Patient ID">
          <input
            className="input"
            value={patient.patientId}
            onChange={(e) => change({ patientId: e.target.value })}
            placeholder="STY-000000"
          />
        </Field>

        <Field label="Age">
          <input
            className="input"
            value={patient.age}
            onChange={(e) => change({ age: e.target.value })}
            placeholder="54"
          />
        </Field>

        <div className="sh-segmented-sex">
          <Field label="Sex">
            <div className="segmented" role="tablist" aria-label="Sex">
              {(['Male', 'Female', 'Other'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={patient.sex === s}
                  onClick={() => change({ sex: s })}
                >
                  {s}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <Field label="Study date">
          <input
            className="input"
            type="date"
            value={patient.studyDate}
            onChange={(e) => change({ studyDate: e.target.value })}
          />
        </Field>

        <Field label="Referring physician">
          <input
            className="input"
            value={patient.referringPhysician}
            onChange={(e) => change({ referringPhysician: e.target.value })}
            placeholder="Dr. Smith"
          />
        </Field>

        <Field label="Clinical indication" fullWidth>
          <textarea
            className="textarea"
            rows={3}
            value={patient.indication}
            onChange={(e) => change({ indication: e.target.value })}
            placeholder="e.g. persistent cough, dyspnea"
          />
          <div className="sh-field-hint">A clinical indication helps the model focus and improves accuracy.</div>
        </Field>

        <Field label="Clinical history" fullWidth>
          <textarea
            className="textarea"
            rows={3}
            value={patient.clinicalHistory}
            onChange={(e) => change({ clinicalHistory: e.target.value })}
            placeholder="Prior studies, symptoms, risk factors"
          />
        </Field>
      </div>

      <div className="sh-sheet-foot">
        <button type="button" className="btn btn-primary" onClick={() => openSheet(null)}>
          Done
        </button>
      </div>
    </Sheet>
  )
}

function Field({ label, children, fullWidth }: { label: string; children: React.ReactNode; fullWidth?: boolean }) {
  return (
    <div className={`field${fullWidth ? ' sh-full' : ''}`}>
      <label className="field-label">{label}</label>
      {children}
    </div>
  )
}