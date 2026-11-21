// Systematic print layout (report template layout 'systematic'), laid out like a diagnostic-centre paper report:
// letterhead (logo box left, reporting radiologist right, centre name, services, double rule, address, contact, rule),
// patient block, exam-type line, greeting, then EVERY section heading of the layout in order with its text in the
// right column. A section with nothing to say prints its heading and an empty ruled line for the radiologist.
// The row text is the report's own (possibly edited) findings field, parsed back from its "SECTION: text" lines.
import type { PatientInfo, ReportDraft } from '../../types'
import type { ReportTemplate } from '../../lib/reportTemplates'
import { SUGGESTIVE, parseRows } from '../../lib/systematicReport'
import './systematic.css'

const lines = (value: string | undefined) => (value ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
// Visual only: rows that state a finding print bold, like the paper reports; stated normals print plain.
const plain = (line: string) => /^(no |normal|both .*normal)/i.test(line)
const Blank = () => <div className="sys-blank" aria-label="Left blank for the radiologist" />

export function SystematicLetterhead({ template, fallbackInstitution }: { template: ReportTemplate; fallbackInstitution: string }) {
  const { header, signatory } = template
  const [address, ...contact] = header.lines.filter((l) => l.trim())
  return (
    <header className="sys-lh">
      <div className="sys-lh-top">
        {header.logoDataUrl ? <img className="sys-lh-logo" src={header.logoDataUrl} alt="" /> : <div className="sys-lh-logo-box">Logo</div>}
        <div className="sys-lh-doctor">
          {signatory?.name ? <div className="sys-lh-doctor-name">{signatory.name},</div> : null}
          {signatory?.qualifications ? <div>{signatory.qualifications}</div> : null}
          {signatory?.registration ? <div>{signatory.registration}</div> : null}
          {(signatory?.lines ?? []).filter((l) => l.trim()).map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>
      <div className="sys-lh-name">{header.institution || fallbackInstitution || 'Diagnostic Centre'}</div>
      {header.department ? <div className="sys-lh-dept">{header.department}</div> : null}
      <div className="sys-lh-double" />
      {address ? <div className="sys-lh-line">{address}</div> : null}
      {contact.map((line, i) => <div key={i} className="sys-lh-line sys-lh-contact">{line}</div>)}
      <div className="sys-lh-rule" />
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
  const exam = technique[0] || examType
  const scope = technique.slice(1)
  const rows = parseRows(report?.findings ?? '')
  const impression = lines(report?.impression)
  const suggestive = impression[0] === SUGGESTIVE
  const items = suggestive ? impression.slice(1) : impression
  const note = lines(report?.recommendations)
  return (
    <div className="sys-body">
      <table className="sys-patient">
        <tbody>
          <tr>
            <td className="sys-p-wide"><span>Name:</span> <strong>{patient.name}</strong></td>
            <td><span>Age:</span> <strong>{patient.age}</strong></td>
            <td><span>Sex:</span> <strong>{patient.sex ? patient.sex.charAt(0) : ''}</strong></td>
          </tr>
          <tr>
            <td className="sys-p-wide"><span>{/^dr\b/i.test(patient.referringPhysician.trim()) ? 'Ref. By:' : 'Ref. By Dr.'}</span> <strong>{patient.referringPhysician}</strong></td>
            <td colSpan={2}><span>Date:</span> <strong>{patient.studyDate || reportDate}</strong></td>
          </tr>
          <tr>
            <td colSpan={3}><span>Type of Examination:</span> <strong>{exam ? `“${exam}”` : ''}</strong></td>
          </tr>
          {patient.patientId ? <tr><td colSpan={3}><span>Patient ID:</span> <strong>{patient.patientId}</strong></td></tr> : null}
        </tbody>
      </table>

      {template.greeting?.trim() ? <div className="sys-greeting">{template.greeting.trim()}</div> : null}
      {scope.length ? <p className="sys-scope">{scope.join(' ')}</p> : null}

      <div className="sys-rows">
        {rows.map((row, i) => {
          const text = row.lines.filter((l) => l.trim())
          return (
            <div key={i} className="sys-row">
              <div className="sys-row-title">{row.title}:</div>
              <div className="sys-row-text">
                {text.length ? text.map((line, j) => <p key={j} className={plain(line) ? undefined : 'sys-strong'}>{line}</p>) : <Blank />}
              </div>
            </div>
          )
        })}
        <div className="sys-row sys-row-impression">
          <div className="sys-row-title">IMPRESSION:</div>
          <div className="sys-row-text">
            {suggestive ? <p>{SUGGESTIVE}</p> : null}
            {items.length ? items.map((line, j) => <p key={j} className="sys-impr">{line}</p>) : <Blank />}
          </div>
        </div>
      </div>
      {note.length ? <p className="sys-note">({note.join(' ')})</p> : null}
    </div>
  )
}

export function SystematicSignatory({ template, signedName }: { template: ReportTemplate; signedName: string }) {
  const s = template.signatory
  const custom = (template.signatureLines ?? []).filter((l) => l.trim())
  // A different signer than the template's radiologist gets their own name only.
  if (custom.length && (!signedName || signedName === s?.name)) {
    return (
      <div className="sys-sign">
        <div className="sys-sign-line" />
        {custom.map((l, i) => <div key={i} className={i === 0 ? 'sys-sign-name' : undefined}>{l}</div>)}
      </div>
    )
  }
  const name = signedName || s?.name
  if (!name) return null
  return (
    <div className="sys-sign">
      <div className="sys-sign-line" />
      <div className="sys-sign-name">{name}</div>
      {s?.qualifications && (!signedName || signedName === s.name) ? <div>{s.qualifications}</div> : null}
      {s?.registration && (!signedName || signedName === s.name) ? <div>{s.registration}</div> : null}
    </div>
  )
}
