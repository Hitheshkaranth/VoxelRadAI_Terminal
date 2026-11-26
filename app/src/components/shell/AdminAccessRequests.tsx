import { ShellButton } from './ShellButton'
import { useEffect, useState } from 'react'

interface AccessRequest { id: string; name: string; email: string; organization: string; role: string; useCase: string; status: 'new' | 'approved' | 'declined'; createdAt: string }
const PAGE_SIZE = 25
const STATUS_LABEL = { new: 'New', approved: 'Approved', declined: 'Declined' } as const

/** Access requests submitted from the public landing page. Approving records the decision; create the account under User accounts. */
export function AdminAccessRequests() {
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [total, setTotal] = useState(0)
  const [pending, setPending] = useState(0)
  const [offset, setOffset] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/admin/access-requests?limit=${PAGE_SIZE}&offset=${offset}`, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(response.status === 403 ? 'An administrator account is required.' : response.status === 404 ? 'This server does not accept access requests yet. Deploy the latest API.' : 'Access requests could not be loaded. Try again.')
      const value = await response.json() as { requests?: unknown; total?: unknown; pending?: unknown }
      if (!Array.isArray(value.requests) || typeof value.total !== 'number') throw new Error('The server returned an invalid list.')
      setRequests(value.requests.filter((item): item is AccessRequest => !!item && typeof item.id === 'string' && typeof item.email === 'string'))
      setTotal(value.total); setPending(typeof value.pending === 'number' ? value.pending : 0); setError('')
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Access requests could not be loaded.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [offset, attempt])
  const reload = (change: () => void) => { setLoading(true); setError(''); change() }
  const decide = async (id: string, status: AccessRequest['status']) => {
    setBusy(id)
    try {
      const response = await fetch(`/api/admin/access-requests/${encodeURIComponent(id)}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      if (!response.ok) throw new Error('The decision could not be saved. Try again.')
      reload(() => setAttempt((value) => value + 1))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The decision could not be saved.') } finally { setBusy(null) }
  }
  return <section className="admin-audit" aria-labelledby="admin-access-title">
    <div className="admin-refresh"><h3 className="admin-heading" id="admin-access-title">Access requests{pending ? ` · ${pending} new` : ''}</h3><ShellButton className="btn" disabled={loading} onClick={() => reload(() => setAttempt((value) => value + 1))}>Refresh</ShellButton></div>
    <p className="admin-note">Submitted from the request form on radgenis.com. Approving records your decision; create the account under User accounts, then email the person yourself. Reviewed requests are deleted after 180 days.</p>
    <div aria-live="polite">{loading && <p className="admin-note">Loading requests...</p>}{error && <p className="admin-error" role="alert">{error}</p>}</div>
    {!error && <><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th scope="col">Received</th><th scope="col">Person</th><th scope="col">Use case</th><th scope="col">Status</th></tr></thead>
      <tbody>{requests.map((item) => <tr key={item.id}>
        <td>{new Date(item.createdAt).toLocaleDateString()}</td>
        <td><strong>{item.name}</strong><br /><a href={`mailto:${item.email}`}>{item.email}</a><br /><span className="admin-muted">{[item.role, item.organization].filter(Boolean).join(' · ')}</span></td>
        <td style={{ maxWidth: 320, whiteSpace: 'pre-wrap' }}>{item.useCase}</td>
        <td>{item.status === 'new'
          ? <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><ShellButton className="btn" disabled={busy === item.id} onClick={() => void decide(item.id, 'approved')}>Approve</ShellButton><ShellButton className="btn" disabled={busy === item.id} onClick={() => void decide(item.id, 'declined')}>Decline</ShellButton></span>
          : <span>{STATUS_LABEL[item.status]} <ShellButton className="btn" disabled={busy === item.id} onClick={() => void decide(item.id, 'new')}>Undo</ShellButton></span>}</td>
      </tr>)}</tbody></table></div>
      <div className="admin-pagination"><span>{total ? `${offset + 1}-${Math.min(offset + requests.length, total)} of ${total.toLocaleString()}` : loading ? '' : 'No requests yet'}</span><ShellButton className="btn" disabled={loading || offset === 0} onClick={() => reload(() => setOffset(Math.max(0, offset - PAGE_SIZE)))}>Previous</ShellButton><ShellButton className="btn" disabled={loading || offset + PAGE_SIZE >= total} onClick={() => reload(() => setOffset(offset + PAGE_SIZE))}>Next</ShellButton></div></>}
  </section>
}
