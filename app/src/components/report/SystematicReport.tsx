// Systematic print layout (report template layout 'systematic'): letterhead with the reporting radiologist, patient
// block, exam-type line, greeting, one titled row per anatomical section, impression and note. The row text is the
// report's own (possibly edited) findings field, parsed back from its "SECTION: text" lines.
import type { PatientInfo, ReportDraft } from '../../types'
import type { ReportTemplate } from '../../lib/reportTemplates'
import { SUGGESTIVE, parseRows } from '../../lib/systematicReport'
import './systematic.css'

const lines = (value: string | undefined) => (value ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
// Visual only: rows that state a finding print bold, like the paper reports; stated normals and gaps print plain.
const plain = (line: string) => /^(no |normal|both .*normal)/i.test(line)

export function SystematicLetterhead({ template, fallbackInstitution }: { template: ReportTemplate; fallbackInstitution: string }) {
  const { header, signatory } = template
  return (
    <header className="sys-lh">
      <div className="sys-lh-top">
        {header.logoDataUrl ? <img className="sys-lh-logo" src={header.logoDataUrl} alt="" /> : <span className="sys-lh-logo-gap" />}
        {signatory?.name ? (
          <div className="sys-lh-doctor">
            <div className="sys-lh-doctor-name">{signatory.name}</div>
            {signatory.qualifications ? <div>{signatory.qualifications}</div> : null}
            {signatory.registration ? <div>{signatory.registration}</div> : null}
          </div>
        ) : null}
      </div>
      <div className="sys-lh-name">{header.institution || fallbackInstitution || 'Diagnostic Centre'}</div>
      {header.department ? <div className="sys-lh-dept">{header.department}</div> : null}
      {header.lines.filter((l) => l.trim()).map((line, i) => <div key={i} className="sys-lh-line">{line}</div>)}
    </header>
  )
}

export function SystematicBody({ template, patient, report, examType, reportDate }: {
  template: ReportTemplate
  patient: PatientInfo
  report: ReportDraft | undefined
  examType: string
  reportDate: string
}) {
  const technique = lines(report?.technique)
  const exam = technique[0] || examType || '—'
  const scope = technique.slice(1)
  // Sections the radiologist left empty are not printed.
  const rows = parseRows(report?.findings ?? '').filter((row) => row.lines.some((l) => l.trim()))
  const impression = lines(report?.impression)
  const suggestive = impression[0] === SUGGESTIVE
  const note = lines(report?.recommendations)
  return (
    <div className="sys-body">
      <table className="sys-patient">
        <tbody>
          <tr>
            <td className="sys-p-wide"><span>Name:</span> <strong>{patient.name || '—'}</strong></td>
            <td><span>Age:</span> <strong>{patient.age || '—'}</strong></td>
            <td><span>Sex:</span> <strong>{patient.sex ? patient.sex.charAt(0) : '—'}</strong></td>
          </tr>
          <tr>
            <td className="sys-p-wide"><span>{/^dr\b/i.test(patient.referringPhysician.trim()) ? 'Ref. By:' : 'Ref. By Dr.'}</span> <strong>{patient.referringPhysician || ''}</strong></td>
            <td colSpan={2}><span>Date:</span> <strong>{patient.studyDate || reportDate}</strong></td>
          </tr>
          <tr>
            <td colSpan={3}><span>Type of Examination:</span> <strong>“{exam}”</strong></td>
          </tr>
          {patient.patientId ? <tr><td colSpan={3}><span>Patient ID:</span> <strong>{patient.patientId}</strong></td></tr> : null}
        </tbody>
      </table>

      {template.greeting?.trim() ? <div className="sys-greeting">{template.greeting.trim()}</div> : null}
      {scope.length ? <p className="sys-scope">{scope.join(' ')}</p> : null}

      <div className="sys-rows">
        {rows.length ? rows.map((row, i) => (
          <div key={i} className="sys-row">
            <div className="sys-row-title">{row.title}:</div>
            <div className="sys-row-text">
              {row.lines.map((line, j) => <p key={j} className={plain(line) ? undefined : 'sys-strong'}>{line}</p>)}
            </div>
          </div>
        )) : null}
        {impression.length ? <div className="sys-row sys-row-impression">
          <div className="sys-row-title">IMPRESSION:</div>
          <div className="sys-row-text">
            {suggestive ? <p>{SUGGESTIVE}</p> : null}
            {(suggestive ? impression.slice(1) : impression).map((line, j) => <p key={j} className={suggestive ? 'sys-impr' : undefined}>{line}</p>)}
          </div>
        </div> : null}
      </div>
      {note.length ? <p className="sys-note">({note.join(' ')})</p> : null}
    </div>
  )
}

export function SystematicSignatory({ template, signedName }: { template: ReportTemplate; signedName: string }) {
  const s = template.signatory
  const name = signedName || s?.name
  if (!name) return null
  return (
    <div className="sys-sign">
      <div className="sys-sign-name">{name}</div>
      {s?.qualifications && (!signedName || signedName === s.name) ? <div>{s.qualifications}</div> : null}
      {s?.registration && (!signedName || signedName === s.name) ? <div>{s.registration}</div> : null}
    </div>
  )
}
