// OWNER: Agent 5. PatientSheet — modal form for patient demographic + clinical details, live-saved.
import { Children, cloneElement, isValidElement, useId, useState } from 'react'
import { AlertCircle } from 'lucide-react'
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

  // Patient details feed the report: say what an edit does to an existing draft or a signed report.
  const report = study.report
  const reportNote = report?.signed
    ? 'This study has a signed report. It keeps the patient details recorded at signing; changes here apply only if the report is unlocked and signed again.'
    : report
      ? 'A report has been drafted. Changing the indication, age or sex marks the draft out of date until it is regenerated.'
      : null

  return (
    <Sheet open={open} onClose={() => openSheet(null)} title="Patient details" subtitle="Demographics and clinical context.">
      {reportNote && (
        <div className="sh-disclaimer" role="note" style={{ marginBottom: 'var(--sp-3)' }}>
          <AlertCircle />
          <span>{reportNote}</span>
        </div>
      )}
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
  const fieldId = useId()
  return (
    <div className={`field${fullWidth ? ' sh-full' : ''}`}>
      <label className="field-label" htmlFor={fieldId}>{label}</label>
      {Children.map(children, (child) => isValidElement<{ id?: string }>(child) && typeof child.type === 'string' && ['input', 'textarea', 'select'].includes(child.type)
        ? cloneElement(child, { id: fieldId }) : child)}
    </div>
  )
}