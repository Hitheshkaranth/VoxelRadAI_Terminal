// Signed-report actions and history: addenda, explicit correction into a new version, and the version list.
// Signed text is never edited in place; see lib/reportVersions.
import { useState } from 'react'
import { FilePlus2, History, PenLine } from 'lucide-react'
import { ShellButton } from '../shell/ShellButton'
import { useApp } from '../../store'
import type { ReportDraft, ReportFieldKey } from '../../types'
import { MAX_ADDENDUM_LENGTH, addendumHeading, addendumPatch, correctionPatch, versionHistory } from '../../lib/reportVersions'
import './reportIntegrity.css'

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

/** Shown on a signed report in place of the old Unlock: append an addendum, or start a correction. */
export function SignedReportActions({ studyId, report, by }: { studyId: string; report: ReportDraft; by: string }) {
  const setReport = useApp((s) => s.setReport)
  const [mode, setMode] = useState<'idle' | 'addendum' | 'correct'>('idle')
  const [text, setText] = useState('')
  const [prevStudy, setPrevStudy] = useState(studyId)
  if (prevStudy !== studyId) { setPrevStudy(studyId); setMode('idle'); setText('') }

  const signAddendum = () => {
    const patch = addendumPatch(report, { id: newId(), text, by, now: Date.now() })
    if (!patch.addenda) return
    setReport(studyId, patch)
    setText(''); setMode('idle')
  }
  const startCorrection = () => {
    setReport(studyId, correctionPatch(report, by, Date.now()))
    setMode('idle')
  }

  if (mode === 'addendum') {
    return (
      <div className="ri-compose">
        <label className="ri-label" htmlFor="ri-addendum">Addendum</label>
        <textarea id="ri-addendum" className="input ri-text" rows={4} maxLength={MAX_ADDENDUM_LENGTH} value={text}
          placeholder="Text to append below the signed report" onChange={(e) => setText(e.target.value)} />
        <p className="ri-hint">The signed report is not changed. The addendum is signed by {by || 'you'} and printed under its own heading.</p>
        <div className="rp-confirm-actions">
          <ShellButton type="button" className="btn btn-sm" onClick={() => { setMode('idle'); setText('') }}>Cancel</ShellButton>
          <ShellButton type="button" className="btn btn-primary btn-sm" disabled={!text.trim() || !by.trim()} onClick={signAddendum}>Sign addendum</ShellButton>
        </div>
      </div>
    )
  }
  if (mode === 'correct') {
    return (
      <div className="rp-confirm">
        <span className="rp-confirm-text">
          Start a corrected version? The report becomes an editable draft. The signed version is kept unchanged in the
          history and is marked superseded once you sign the correction.
        </span>
        <div className="rp-confirm-actions">
          <ShellButton type="button" className="btn btn-sm" onClick={() => setMode('idle')}>Cancel</ShellButton>
          <ShellButton type="button" className="btn btn-destructive btn-sm" onClick={startCorrection}>Correct report</ShellButton>
        </div>
      </div>
    )
  }
  return (
    <div className="ri-actions">
      <ShellButton type="button" className="btn btn-sm" onClick={() => setMode('addendum')}><FilePlus2 size={14} /> Add addendum</ShellButton>
      <ShellButton type="button" className="btn btn-plain btn-sm" onClick={() => setMode('correct')}><PenLine size={14} /> Correct report</ShellButton>
    </div>
  )
}

const STATUS_LABEL = { current: 'Current', superseded: 'Superseded', 'under-correction': 'Being corrected' } as const

/** Signed versions newest first, each with its addenda; earlier versions stay readable. Legacy unlocks follow. */
export function ReportHistory({ report, labels }: { report: ReportDraft; labels: Record<ReportFieldKey, string> }) {
  const rows = versionHistory(report)
  const amendments = report.amendments ?? []
  // Unlocks recorded before versions existed carry no text; show them so the trail stays complete.
  const legacy = rows.length ? amendments.filter((a) => !rows.some((r) => r.version.signedAt === a.signedAt)) : amendments
  if (!rows.length && !legacy.length && !(report.addenda?.length)) return null
  return (
    <section className="rp-card rp-amend" aria-label="Report history">
      <div className="rp-sec-head"><History size={14} /> Report history</div>
      {report.correction && !report.signed ? (
        <p className="ri-hint">Correcting version {report.correction.of} (started {new Date(report.correction.startedAt).toLocaleString()} by {report.correction.by || '—'}). Sign to issue it as a new version.</p>
      ) : null}
      <ul className="ri-list">
        {rows.map(({ version, status, addenda }) => (
          <li key={version.version} className={`ri-version ri-${status}`}>
            <details>
              <summary>
                <span className="ri-version-name">Version {version.version}</span>
                <span className={`ri-status ri-status-${status}`}>{STATUS_LABEL[status]}</span>
                <span className="ri-meta">Signed {new Date(version.signedAt).toLocaleString()} by {version.signedBy || '—'}{version.corrects ? ` · corrects version ${version.corrects}` : ''}</span>
              </summary>
              <dl className="ri-sections">
                {(Object.keys(labels) as ReportFieldKey[]).map((key) => (
                  <div key={key}><dt>{labels[key]}</dt><dd>{version.sections[key]?.trim() || '—'}</dd></div>
                ))}
              </dl>
              {version.signOverrides?.length ? <p className="ri-hint">Signed past unresolved items: {version.signOverrides.join(' ')}</p> : null}
            </details>
            {addenda.map((a) => (
              <div key={a.id} className="ri-addendum"><strong>{addendumHeading(a)}</strong><p>{a.text}</p></div>
            ))}
          </li>
        ))}
        {legacy.map((a, i) => (
          <li key={`legacy-${i}`} className="ri-legacy">
            Signed {new Date(a.signedAt).toLocaleString()}, unlocked {new Date(a.unlockedAt).toLocaleString()} by {a.by || '—'} (earlier signed text not kept)
          </li>
        ))}
      </ul>
    </section>
  )
}
