// Critical result communication log: who was told, in what role, how and when. Entries can be added after signing
// (communication often follows the report) but only removed while the report is unsigned, and during a correction
// only if they were logged after the latest signed version.
import { useState } from 'react'
import { PhoneCall, X } from 'lucide-react'
import { ShellButton } from '../shell/ShellButton'
import type { CriticalComm, CriticalCommMethod, ReportDraft } from '../../types'
import { commRemovable, criticalCommLine, type LoggedComm } from '../../lib/reportQa'
import './guidelineHelper.css'

const METHODS: CriticalCommMethod[] = ['phone', 'in person', 'message', 'other']

/** yyyy-mm-ddThh:mm in local time, the value format of <input type="datetime-local">. */
function localInput(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

export function CriticalCommsForm({ comms, pending, defaultBy, report, onChange }: {
  comms: CriticalComm[]
  /** Critical results found in the report with no matching log entry. */
  pending: string[]
  defaultBy: string
  /** Sign-off state and version history: decides which entries can still be removed. */
  report: Pick<ReportDraft, 'signed' | 'versions' | 'signedAt'>
  onChange: (comms: CriticalComm[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [finding, setFinding] = useState('')
  const [to, setTo] = useState('')
  const [role, setRole] = useState('')
  const [method, setMethod] = useState<CriticalCommMethod>('phone')
  const [at, setAt] = useState('')
  const [by, setBy] = useState('')
  const start = () => { setOpen(true); setFinding(pending[0] ?? ''); setAt(localInput(Date.now())); setBy(defaultBy) }
  if (!comms.length && !pending.length && !open) {
    return <ShellButton type="button" className="btn btn-plain btn-sm cc-open" onClick={start}><PhoneCall size={14} /> Log critical result communication</ShellButton>
  }

  const when = at ? new Date(at).getTime() : Number.NaN
  const valid = finding.trim() && to.trim() && Number.isFinite(when)
  const save = () => {
    if (!valid) return
    const entry: LoggedComm = { id: crypto.randomUUID(), finding: finding.trim(), communicatedTo: to.trim(), role: role.trim(), method, at: when, by: by.trim(), loggedAt: Date.now() }
    onChange([...comms, entry])
    setOpen(false); setFinding(''); setTo(''); setRole('')
  }

  return (
    <section className="rp-card cc-card" aria-label="Critical result communication">
      <div className="rp-sec-head"><PhoneCall /> Critical result communication</div>
      {pending.length ? <p className="cc-pending"><strong>Not yet logged:</strong> {pending.join(', ')}</p> : null}
      {comms.length ? (
        <ul className="cc-list">
          {comms.map((c) => (
            <li key={c.id}>
              <span>{criticalCommLine(c)}</span>
              {commRemovable(c, report) ? <ShellButton type="button" className="icon-btn" aria-label={`Remove entry for ${c.finding}`}
                onClick={() => onChange(comms.filter((x) => x.id !== c.id))}><X size={14} /></ShellButton> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {open && at ? (
        <form className="cc-form" onSubmit={(e) => { e.preventDefault(); save() }}>
          <label className="cc-wide">Finding<input className="input" list="cc-pending" value={finding} onChange={(e) => setFinding(e.target.value)} required /></label>
          <datalist id="cc-pending">{pending.map((p) => <option key={p} value={p} />)}</datalist>
          <label>Communicated to<input className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Name" required /></label>
          <label>Role<input className="input" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. ED physician" /></label>
          <label>Method<select className="input" value={method} onChange={(e) => setMethod(e.target.value as CriticalCommMethod)}>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select></label>
          <label>Communicated by<input className="input" value={by} onChange={(e) => setBy(e.target.value)} /></label>
          <label className="cc-wide">Date and time<input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} required /></label>
          <div className="cc-wide rp-confirm-actions">
            <ShellButton type="button" className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</ShellButton>
            <ShellButton type="submit" className="btn btn-primary btn-sm" disabled={!valid}>Save entry</ShellButton>
          </div>
        </form>
      ) : (
        <ShellButton type="button" className="btn btn-sm" onClick={start}><PhoneCall size={14} /> Log communication</ShellButton>
      )}
      <p className="cc-hint">Record each critical result communicated to the care team. The log prints with the report.</p>
    </section>
  )
}
