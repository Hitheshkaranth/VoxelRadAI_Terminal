import { ShellButton } from './ShellButton'
import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useApp } from '../../store'
import { fetchOrganizationMetrics, localMetrics, type OrganizationMetrics } from '../../lib/adminMetrics'
import { Sheet } from './Sheet'
import { AdminUsers } from './AdminUsers'
import { OperationsPanel } from './OperationsPanel'
import { AdminReviews } from './AdminReviews'
import { AdminAudit } from './AdminAudit'
import './admin.css'

export function AdminPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <AdminPanelContent onClose={onClose} /> : null
}

function AdminPanelContent({ onClose }: { onClose: () => void }) {
  const studies = useApp((state) => state.studies)
  const local = localMetrics(studies)
  const [scope, setScope] = useState<'local' | 'organization'>('local')
  const [remote, setRemote] = useState<OrganizationMetrics | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (scope !== 'organization') return
    const controller = new AbortController()
    void fetchOrganizationMetrics(controller.signal).then((value) => { if (!controller.signal.aborted) setRemote(value) }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Analytics could not be loaded.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [scope, attempt])
  return <Sheet open onClose={onClose} wide title="Workspace analytics" subtitle="Understand activity and review progress.">
    <div className="admin-scope" role="group" aria-label="Analytics scope">
      <ShellButton className="btn" aria-pressed={scope === 'local'} onClick={() => setScope('local')}>This browser</ShellButton>
      <ShellButton className="btn" aria-pressed={scope === 'organization'} onClick={() => { if (scope !== 'organization') { setLoading(true); setError(''); setRemote(null); setScope('organization') } }}>Organization</ShellButton>
    </div>
    {scope === 'local' ? <>
      <p className="admin-note">Live counts from image studies saved in this browser. These are not organization totals or user activity. Open volumes are not included.</p>
      <dl className="admin-metrics"><Metric title="Studies" value={local.studies} /><Metric title="Images" value={local.images} /><Metric title="Reports" value={local.reports} /><Metric title="Signed reports" value={local.signed} /></dl>
      <h3 className="admin-heading">Image processing</h3>
      <dl className="admin-rows"><Metric title="Analyzed" value={local.analyzed} /><Metric title="In progress" value={local.analyzing} /><Metric title="Needs retry" value={local.errors} /><Metric title="Not analyzed" value={local.images - local.analyzed - local.analyzing - local.errors} /></dl>
      <p className="admin-note">Counts are computed locally. Opening this view does not send patient details, images or reports to an analytics service.</p>
      <AdminReviews scope="local" studies={studies} />
    </> : <>
      <div className="admin-refresh"><p className="admin-note">Server totals for your organization. Requires an administrator session.</p><ShellButton className="btn" disabled={loading} onClick={() => { setLoading(true); setError(''); setRemote(null); setAttempt((value) => value + 1) }}><RefreshCw aria-hidden="true" />Refresh</ShellButton></div>
      <div aria-live="polite">{loading && <p className="admin-note">Loading organization activity...</p>}{error && <p className="admin-error" role="alert">{error}</p>}</div>
      {remote && <><p className="admin-note">Updated {new Date(remote.generatedAt).toLocaleString()}</p><dl className="admin-metrics"><Metric title="Registered users" value={remote.users.total} /><Metric title="Active users / 30 days" value={remote.users.active30d} /><Metric title="Stored studies" value={remote.studies.total} /><Metric title="Stored images" value={remote.images.total} /></dl><h3 className="admin-heading">Reports and sharing</h3><dl className="admin-rows"><Metric title="Reports" value={remote.reports.total} /><Metric title="Signed reports" value={remote.reports.signed} /><Metric title="Active shares" value={remote.shares.active} /><Metric title="Revoked shares" value={remote.shares.revoked} /></dl><h3 className="admin-heading">Processing and activity</h3>{remote.jobs.available === false && <p className="admin-note">Server processing metrics are unavailable. Analysis currently runs through the browser workspace.</p>}<dl className="admin-rows">{remote.jobs.available !== false && <><Metric title="Queued jobs" value={remote.jobs.queued} /><Metric title="Running jobs" value={remote.jobs.running} /><Metric title="Failed jobs" value={remote.jobs.failed} /></>}<Metric title="Recorded events / 30 days" value={remote.events.total30d} /></dl></>}
      <OperationsPanel />
      {remote && <AdminReviews scope="organization" studies={studies} />}
      {remote && <AdminAudit />}
      {remote && <AdminUsers />}
    </>}
  </Sheet>
}

function Metric({ title, value }: { title: string; value: number }) { return <div><dt>{title}</dt><dd>{value.toLocaleString()}</dd></div> }
