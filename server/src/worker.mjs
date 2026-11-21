// Read worker: executes asynchronous /api/v1 reads from the durable queue (api_reads) on the model upstreams.
// Run as many as GPU capacity needs, each with READ_WORKER_CONCURRENCY slots; they coordinate only through
// PostgreSQL (FOR UPDATE SKIP LOCKED claims plus renewable leases), so a worker can die at any point and its reads
// are retried by another. Pair with READ_EXECUTION=worker on the API so the API only accepts and stores reads.
//
//   DATABASE_URL, BRIDGE_SECRET, MODEL_UPSTREAMS (or MODEL_UPSTREAM_URL)   as for the API
//   READ_WORKER_CONCURRENCY   reads at once per worker (default 2; roughly the GPUs this worker should keep busy)
//   READ_WORKER_POLL_MS       idle poll interval (default 2000); NOTIFY on submit wakes workers sooner
//   WORKER_PORT               /healthz and /metrics listener (default 9090; 0 disables)
//   READ_WORKER_DRAIN_SECONDS on SIGTERM, time to let running reads finish before releasing them (default 240)
import http from 'node:http'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { migrate } from './migrate.mjs'
import { createModelProxy } from './modelProxy.mjs'
import { createPublicApi, createReadStore, READ_CHANNEL } from './publicApi.mjs'
import { metricsAuthorized, renderMetrics } from './metrics.mjs'

const positive = (value, fallback, max) => { const n = Number(value); return Number.isInteger(n) && n > 0 && n <= max ? n : fallback }

/** The worker loop, separated from process wiring so tests can drive it with in-memory stores. */
export function createWorker({ publicApi, concurrency = 2, pollMs = 2000, log = line => console.log(line), setTimer = setTimeout, clearTimer = clearTimeout }) {
  const active = new Map() // read id -> promise
  let stopping = false, timer = null, ticking = false, wakeAgain = false, completed = 0, sweepAt = 0
  async function tick() {
    if (ticking) { wakeAgain = true; return }
    ticking = true
    try {
      // Recovery runs here as well as on API requests, so lapsed reads come back even when no client is calling.
      if (Date.now() >= sweepAt) { sweepAt = Date.now() + 15_000; await publicApi.recover() }
      const free = concurrency - active.size
      if (!stopping && free > 0) {
        const started = await publicApi.runQueued(free).catch(error => { log(JSON.stringify({ event: 'worker.claim_failed', code: error.code || error.name })); return [] })
        for (const run of started) {
          const id = randomUUID()
          active.set(id, run.finally(() => { active.delete(id); completed++; if (!stopping) wake() }))
        }
        // A full batch suggests more is waiting.
        if (started.length === free && free > 0) wakeAgain = true
      }
    } finally {
      ticking = false
      if (!stopping) schedule(wakeAgain ? 0 : pollMs)
      wakeAgain = false
    }
  }
  function schedule(ms) { if (timer) clearTimer(timer); timer = setTimer(() => { timer = null; tick() }, ms) }
  function wake() { schedule(0) }
  return {
    start() { wake(); return this },
    wake,
    tick,
    stats: () => ({ active: active.size, completed, concurrency }),
    /** Stop claiming; give running reads `drainMs`, then hand whatever is left back to the queue. */
    async stop(drainMs = 240_000) {
      stopping = true
      if (timer) { clearTimer(timer); timer = null }
      const pending = [...active.values()]
      await Promise.race([Promise.allSettled(pending), new Promise(resolve => setTimer(resolve, drainMs))])
      return active.size
    },
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const { Pool } = process.env.DATABASE_DRIVER === 'neon' ? await import('@neondatabase/serverless') : pg
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_SIZE || 5), connectionTimeoutMillis: 5000, statement_timeout: 10000 })
  pool.on('error', () => console.error('Database connection interrupted'))
  if (process.env.MIGRATE_ON_START !== 'false') await migrate(pool)
  const send = () => { throw new Error('workers do not answer HTTP API requests') }
  const body = send
  const modelProxy = createModelProxy({ pool, body, send })
  if (!modelProxy.enabled) console.warn('Read worker: no model upstream configured (MODEL_UPSTREAMS/MODEL_UPSTREAM_URL and BRIDGE_SECRET); queued reads will wait.')
  const apiKeys = { authenticate: async () => ({ error: { status: 401 } }), auditDenied: async () => {} }
  const leaseOwner = `worker-${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`
  const publicApi = createPublicApi({ readStore: createReadStore(pool), body, send, modelProxy, apiKeys, publicOrigin: new URL(process.env.PUBLIC_ORIGIN || 'http://localhost:5173').origin, leaseOwner })
  const concurrency = modelProxy.enabled ? positive(process.env.READ_WORKER_CONCURRENCY, 2, 64) : 0
  const worker = createWorker({ publicApi, concurrency, pollMs: positive(process.env.READ_WORKER_POLL_MS, 2000, 60_000) }).start()

  // LISTEN for new reads (native driver only; the poll covers everything else, including missed notifications).
  let listener = null
  if (process.env.DATABASE_DRIVER !== 'neon') {
    try {
      listener = new pg.Client({ connectionString: process.env.DATABASE_URL })
      listener.on('error', () => { listener = null })
      await listener.connect()
      listener.on('notification', () => worker.wake())
      await listener.query(`LISTEN ${READ_CHANNEL}`)
    } catch { listener = null }
  }

  const port = Number(process.env.WORKER_PORT ?? 9090)
  let server = null, healthy = true
  if (port > 0) {
    server = http.createServer(async (req, res) => {
      const path = new URL(req.url, 'http://internal').pathname
      if (path === '/healthz') {
        const ok = healthy && await pool.query('SELECT 1').then(() => true, () => false)
        res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ status: ok ? 'ok' : 'unavailable', ...worker.stats() }))
      }
      if (path === '/metrics' && metricsAuthorized(req, process.env.METRICS_TOKEN)) {
        const queue = await publicApi.depth().catch(() => null)
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' })
        return res.end(renderMetrics({ role: 'worker', pool, upstreams: modelProxy.upstreams(), queue, worker: worker.stats() }))
      }
      res.writeHead(404); res.end()
    }).listen(port, '0.0.0.0')
  }
  console.log(JSON.stringify({ event: 'worker.started', concurrency, upstreams: modelProxy.upstreams().length }))

  let shuttingDown = false
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
    if (shuttingDown) return
    shuttingDown = true; healthy = false
    const left = await worker.stop(positive(process.env.READ_WORKER_DRAIN_SECONDS, 240, 3600) * 1000)
    // Anything still running goes back to the queue for another worker, without using an attempt.
    if (left) {
      const held = await pool.query("SELECT id FROM api_reads WHERE status='running' AND lease_owner=$1", [leaseOwner]).catch(() => ({ rows: [] }))
      await Promise.allSettled(held.rows.map(row => publicApi.release(row.id)))
    }
    server?.close(); await listener?.end().catch(() => {}); await pool.end().catch(() => {})
    process.exit(0)
  })
}
