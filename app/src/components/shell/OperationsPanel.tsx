import { useEffect, useState } from 'react'
import { fetchOperationsMetrics, type OperationsMetrics } from './operationsMetrics'
import { ShellButton } from './ShellButton'

export function OperationsPanel() {
  const [metrics, setMetrics] = useState<OperationsMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void fetchOperationsMetrics(controller.signal).then((value) => {
      if (!controller.signal.aborted) setMetrics(value)
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Server operations could not be loaded.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [attempt])
  return <section aria-labelledby="operations-heading">
    <div className="admin-refresh"><h3 id="operations-heading" className="admin-heading">Server operations</h3><ShellButton className="btn" disabled={loading} onClick={() => { setLoading(true); setError(''); setMetrics(null); setAttempt((value) => value + 1) }}>Refresh operations</ShellButton></div>
    <p className="admin-note">This snapshot covers only the API process that answered the request. Counters reset on restart. With multiple replicas, refresh may reach a different process; these values are not fleet totals or an uptime guarantee.</p>
    {loading && <p role="status" className="admin-note">Loading process metrics…</p>}
    {error && <p role="alert" className="admin-error">{error}</p>}
    {metrics && <>
      <p className="admin-note">Snapshot {new Date(metrics.generatedAt).toLocaleString()} · Process uptime {Math.floor(metrics.uptimeSeconds / 3600)}h {Math.floor(metrics.uptimeSeconds % 3600 / 60)}m {metrics.uptimeSeconds % 60}s</p>
      <dl className="admin-rows">
        <Value label="Completed HTTP requests" value={metrics.requests.completed.toLocaleString()} />
        <Value label="Requests in flight (includes this snapshot request)" value={metrics.requests.inFlight.toLocaleString()} />
        <Value label="Server errors (5xx)" value={metrics.requests.failed.toLocaleString()} />
        <Value label="Mean completed-request duration" value={`${metrics.requests.meanDurationMs.toLocaleString()} ms`} />
        <Value label="Longest completed request" value={`${Math.round(metrics.requests.maxDurationMs).toLocaleString()} ms`} />
        <Value label="API resident memory" value={`${(metrics.memory.rssBytes / 1024 / 1024).toFixed(1)} MiB`} />
        <Value label="Database connection check" value="Ready at snapshot" />
        <Value label="API database pool: open / idle / waiting" value={`${metrics.database.connections} / ${metrics.database.idle} / ${metrics.database.waiting}`} />
      </dl>
      <details className="admin-create"><summary>HTTP response counts</summary><dl className="admin-rows">{Object.entries(metrics.statuses).map(([status, count]) => <Value key={status} label={status} value={count.toLocaleString()} />)}</dl><p className="admin-note">These are status-class counts since process start. A disconnected request is recorded as 499. No patient details, URLs, or request bodies are included.</p></details>
      <h3 className="admin-heading">Server capabilities</h3>
      <p className="admin-note">Reported implementation support, not certification or a deployment security audit.</p>
      <dl className="admin-rows">
        <Value label="Account recovery" value="Administrator-issued one-use code" />
        <Capability label="Multi-factor authentication" supported={metrics.features.mfa} />
        <Capability label="Single sign-on" supported={metrics.features.sso} />
        <Capability label="Tenant isolation" supported={metrics.features.multiTenant} />
        <Capability label="Full-volume storage" supported={metrics.features.volumeStorage} />
        <Capability label="Durable inference jobs" supported={metrics.features.durableInferenceJobs} />
      </dl>
    </>}
  </section>
}
function Value({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div> }
function Capability({ label, supported }: { label: string; supported: boolean }) { return <Value label={label} value={supported ? 'Supported by this server' : 'Not implemented'} /> }
