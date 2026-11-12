import { ShellButton } from './ShellButton'
import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'

interface AuditEvent { id: string; eventType: string; actorEmail: string | null; subjectId: string | null; createdAt: string }
const PAGE_SIZE = 25
const DAY_OPTIONS = [1, 7, 30, 90, 365]
const LABELS: Record<string, string> = {
  login: 'Signed in', 'account.password_changed': 'Changed own password', 'account.recovered': 'Used a recovery code', 'account.recovery_issued': 'Issued a recovery code',
  'user.created': 'Created an account', 'user.disabled': 'Disabled an account', 'user.enabled': 'Enabled an account', 'user.password_reset': 'Reset a password',
  'study.saved': 'Saved a study', 'study.deleted': 'Deleted a study', 'share.created': 'Created a share link', 'share.revoked': 'Revoked a share link', 'share.opened': 'Share link opened',
  'volume.saved': 'Saved a volume', 'volume.deleted': 'Deleted a volume', 'pacs.query': 'Searched PACS', 'pacs.instance_retrieved': 'Retrieved from PACS',
  'audit.exported': 'Exported the audit log', 'reviews.exported': 'Exported finding reviews',
}
const label = (type: string) => LABELS[type] ?? type

/** Organization audit trail: who did what, when, and to which record. */
export function AdminAudit() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [type, setType] = useState('')
  const [days, setDays] = useState(30)
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const query = `type=${encodeURIComponent(type)}&days=${days}`
  useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/admin/audit?${query}&limit=${PAGE_SIZE}&offset=${offset}`, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(response.status === 403 ? 'An administrator account is required.' : response.status === 404 ? 'This server does not provide an audit log yet. Deploy the latest API.' : 'The audit log could not be loaded. Try again.')
      const value = await response.json() as { events?: unknown; total?: unknown; types?: unknown }
      if (!Array.isArray(value.events) || typeof value.total !== 'number' || !Array.isArray(value.types)) throw new Error('The server returned an invalid audit log.')
      setEvents(value.events.filter((item): item is AuditEvent => !!item && typeof item.eventType === 'string' && typeof item.createdAt === 'string'))
      setTotal(value.total); setTypes(value.types.filter((item): item is string => typeof item === 'string')); setError('')
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The audit log could not be loaded.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [query, offset, attempt])
  const reload = (change: () => void) => { setLoading(true); setError(''); change() }
  return <section className="admin-audit" aria-labelledby="admin-audit-title">
    <div className="admin-refresh"><h3 className="admin-heading" id="admin-audit-title">Audit log</h3><ShellButton className="btn" disabled={loading} onClick={() => reload(() => setAttempt((value) => value + 1))}>Refresh</ShellButton></div>
    <p className="admin-note">Sign-ins, account changes, saved and deleted studies, and share links created, opened and revoked. Opens of a share link have no account, because the person opening it is not signed in.</p>
    <div className="admin-filters">
      <label>Event<select className="input" value={type} onChange={(event) => reload(() => { setType(event.target.value); setOffset(0) })}><option value="">All events</option>{[...new Set([...types, ...(type ? [type] : [])])].map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label>
      <label>Period<select className="input" value={days} onChange={(event) => reload(() => { setDays(Number(event.target.value)); setOffset(0) })}>{DAY_OPTIONS.map((item) => <option key={item} value={item}>{item === 1 ? 'Last 24 hours' : `Last ${item} days`}</option>)}</select></label>
      <a className="btn" href={`/api/admin/audit.csv?${query}`} download><Download aria-hidden="true" />Download CSV</a>
    </div>
    <div aria-live="polite">{loading && <p className="admin-note">Loading events...</p>}{error && <p className="admin-error" role="alert">{error}</p>}</div>
    {!error && <><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th scope="col">Time</th><th scope="col">Event</th><th scope="col">Account</th><th scope="col">Record</th></tr></thead>
      <tbody>{events.map((event) => <tr key={event.id}><td>{new Date(event.createdAt).toLocaleString()}</td><td>{label(event.eventType)}</td><td>{event.actorEmail ?? <span className="admin-muted">{event.eventType === 'share.opened' ? 'Link holder' : 'Deleted account'}</span>}</td><td><code className="admin-subject" title={event.subjectId ?? undefined}>{event.subjectId ? event.subjectId.slice(0, 8) : '–'}</code></td></tr>)}</tbody></table></div>
      <div className="admin-pagination"><span>{total ? `${offset + 1}-${Math.min(offset + events.length, total)} of ${total.toLocaleString()}` : loading ? '' : 'No events in this period'}</span><ShellButton className="btn" disabled={loading || offset === 0} onClick={() => reload(() => setOffset(Math.max(0, offset - PAGE_SIZE)))}>Previous</ShellButton><ShellButton className="btn" disabled={loading || offset + PAGE_SIZE >= total} onClick={() => reload(() => setOffset(offset + PAGE_SIZE))}>Next</ShellButton></div></>}
    <p className="admin-note">The CSV holds up to 10,000 of the newest matching events. Downloading it is itself recorded.</p>
  </section>
}
