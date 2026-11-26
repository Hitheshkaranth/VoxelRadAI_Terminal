// Follow-up recommendations pulled from the report. Before sign-off the reader marks each Track or Decline; tracked
// items get a due date when the report is signed and stay on the worklist until marked done. Marking done is
// workflow state, not report text, so it is allowed on a signed report.
import { CalendarClock, Check, RotateCcw, X } from 'lucide-react'
import { ShellButton } from '../shell/ShellButton'
import type { FollowUp } from '../../types'
import { followUpStatus, formatDue, intervalLabel, type FollowUpStatus } from '../../lib/followUps'
import './followUps.css'

const STATUS_TEXT: Record<FollowUpStatus, (f: FollowUp) => string> = {
  undecided: () => 'Not decided',
  declined: () => 'Declined, not tracked',
  completed: (f) => `Done ${formatDue(f.completedAt!)}`,
  overdue: (f) => `Overdue since ${formatDue(f.dueAt!)}`,
  'due-soon': (f) => `Due ${formatDue(f.dueAt!)}`,
  scheduled: (f) => `Due ${formatDue(f.dueAt!)}`,
  undated: () => 'Tracked, no interval stated',
}

export function FollowUpsCard({ items, signed, onChange }: {
  /** Unsigned: re-extracted from the current text. Signed: as frozen at sign-off. */
  items: FollowUp[]
  signed: boolean
  onChange: (items: FollowUp[]) => void
}) {
  if (!items.length) return null
  const now = Date.now()
  const set = (id: string, patch: Partial<FollowUp>) => onChange(items.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  const undecided = items.filter((f) => !f.decision).length

  return (
    <section className="rp-card fu-card" aria-label="Follow-up recommendations">
      <div className="rp-sec-head"><CalendarClock /> Follow-up recommendations</div>
      <p className="fu-hint">
        {signed
          ? 'Tracked follow-ups stay on the worklist until you mark them done.'
          : undecided
            ? `Track the follow-ups you want reminded of; the due date is set from the sign-off date. ${undecided} not decided.`
            : 'Due dates are set from the sign-off date.'}
      </p>
      <ul className="fu-list">
        {items.map((f) => {
          const status = followUpStatus(f, now)
          return (
            <li key={f.id} data-status={status}>
              <div className="fu-main">
                <span className="fu-chip">{intervalLabel(f)}</span>
                <span className="fu-text">{f.text}</span>
                {signed && <span className="fu-status" data-status={status}>{STATUS_TEXT[status](f)}</span>}
              </div>
              <div className="fu-actions" role="group" aria-label={`Follow-up: ${f.text}`}>
                {!signed ? (
                  <>
                    <ShellButton type="button" className="btn btn-sm" aria-pressed={f.decision === 'track'} onClick={() => set(f.id, { decision: f.decision === 'track' ? undefined : 'track' })}>
                      <CalendarClock size={14} /> Track
                    </ShellButton>
                    <ShellButton type="button" className="btn btn-sm" aria-pressed={f.decision === 'declined'} onClick={() => set(f.id, { decision: f.decision === 'declined' ? undefined : 'declined' })}>
                      <X size={14} /> Decline
                    </ShellButton>
                  </>
                ) : f.decision === 'track' ? (
                  f.completedAt
                    ? <ShellButton type="button" className="btn btn-sm" onClick={() => set(f.id, { completedAt: undefined })}><RotateCcw size={14} /> Reopen</ShellButton>
                    : <ShellButton type="button" className="btn btn-sm" onClick={() => set(f.id, { completedAt: Date.now() })}><Check size={14} /> Mark done</ShellButton>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
