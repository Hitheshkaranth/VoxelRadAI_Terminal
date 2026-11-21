// Prometheus text exposition for one process (API replica or read worker). Scrape it from the private network;
// it is answered only with `Authorization: Bearer $METRICS_TOKEN` and holds no identities, paths or patient data.
import { timingSafeEqual, createHash } from 'node:crypto'

const digest = value => createHash('sha256').update(String(value)).digest()

/** True when the request carries the configured metrics token. False (route hidden) when none is configured. */
export function metricsAuthorized(req, token) {
  if (typeof token !== 'string' || token.length < 16) return false
  const header = req.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  return timingSafeEqual(digest(header.slice(7)), digest(token))
}

const label = value => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')

/**
 * `role` is 'api' or 'worker'. `operations` is createOperations(); `pool` a pg Pool; `upstreams` the model pool
 * snapshot; `queue` { queued, running } or null when the database could not be asked.
 */
export function renderMetrics({ role, operations, pool, upstreams = [], queue = null, worker = null }) {
  const lines = []
  const metric = (name, type, help, samples) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`)
    for (const [labels, value] of samples) {
      const text = Object.entries(labels).map(([key, val]) => `${key}="${label(val)}"`).join(',')
      lines.push(`${name}${text ? `{${text}}` : ''} ${Number.isFinite(value) ? value : 0}`)
    }
  }
  const base = { role }
  if (operations) {
    const snap = operations.snapshot()
    metric('voxelrad_http_requests_total', 'counter', 'Completed HTTP requests by status class.', Object.entries(snap.statuses).map(([cls, n]) => [{ ...base, class: cls }, n]))
    metric('voxelrad_http_requests_in_flight', 'gauge', 'HTTP requests being handled.', [[base, snap.requests.inFlight]])
    metric('voxelrad_http_request_duration_ms_sum', 'counter', 'Total handling time of completed requests.', [[base, Math.round(snap.requests.durationMs)]])
    metric('voxelrad_http_request_duration_ms_count', 'counter', 'Completed requests counted in the duration sum.', [[base, snap.requests.completed]])
    metric('voxelrad_http_request_duration_ms_max', 'gauge', 'Slowest completed request since start.', [[base, Math.round(snap.requests.maxDurationMs)]])
  }
  if (pool) metric('voxelrad_db_pool_connections', 'gauge', 'Database pool connections by state.', [[{ ...base, state: 'total' }, pool.totalCount], [{ ...base, state: 'idle' }, pool.idleCount], [{ ...base, state: 'waiting' }, pool.waitingCount]])
  if (upstreams.length) {
    const tag = upstream => ({ ...base, upstream: String(upstream.index), host: upstream.host })
    metric('voxelrad_model_upstream_up', 'gauge', '1 when the upstream circuit is closed.', upstreams.map(u => [tag(u), u.up ? 1 : 0]))
    metric('voxelrad_model_upstream_in_flight', 'gauge', 'Reads streaming from the upstream in this process.', upstreams.map(u => [tag(u), u.inFlight]))
    metric('voxelrad_model_upstream_started_total', 'counter', 'Reads the upstream accepted.', upstreams.map(u => [tag(u), u.started]))
    metric('voxelrad_model_upstream_failures_total', 'counter', 'Reads the upstream refused or could not take.', upstreams.map(u => [tag(u), u.failures]))
  }
  if (queue) metric('voxelrad_api_reads', 'gauge', 'Asynchronous API reads in the durable queue, by status (all replicas).', [[{ status: 'queued' }, queue.queued], [{ status: 'running' }, queue.running]])
  if (worker) {
    metric('voxelrad_worker_reads_active', 'gauge', 'Reads this worker is executing.', [[base, worker.active]])
    metric('voxelrad_worker_reads_completed_total', 'counter', 'Reads this worker finished (any outcome).', [[base, worker.completed]])
    metric('voxelrad_worker_concurrency', 'gauge', 'Reads this worker may execute at once.', [[base, worker.concurrency]])
  }
  const memory = process.memoryUsage()
  metric('voxelrad_process_resident_memory_bytes', 'gauge', 'Resident memory.', [[base, memory.rss]])
  metric('voxelrad_process_uptime_seconds', 'gauge', 'Seconds since the process started.', [[base, Math.floor(process.uptime())]])
  return lines.join('\n') + '\n'
}
