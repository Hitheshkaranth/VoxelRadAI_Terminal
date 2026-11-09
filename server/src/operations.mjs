import { randomUUID } from 'node:crypto'

// Do not retain paths, query strings, identities, session cookies or request bodies.
export function createOperations({ now = () => performance.now(), log = line => console.log(line) } = {}) {
  const started = now()
  const totals = { completed: 0, failed: 0, inFlight: 0, durationMs: 0, maxDurationMs: 0 }
  const statuses = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 }
  return {
    begin(res) {
      const requestId = randomUUID(), start = now()
      totals.inFlight++
      res.setHeader('X-Request-ID', requestId)
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        const durationMs = Math.max(0, now() - start)
        const status = res.writableFinished ? res.statusCode : 499
        totals.inFlight--; totals.completed++; totals.durationMs += durationMs
        totals.maxDurationMs = Math.max(totals.maxDurationMs, durationMs)
        if (status >= 500) totals.failed++
        const bucket = `${Math.floor(status / 100)}xx`
        if (bucket in statuses) statuses[bucket]++
        log(JSON.stringify({ event: 'http.request', requestId, status, durationMs: Math.round(durationMs) }))
      }
      res.once('finish', finish); res.once('close', finish)
      return requestId
    },
    snapshot() {
      return { scope: 'process', uptimeSeconds: Math.floor((now() - started) / 1000), requests: { ...totals, meanDurationMs: totals.completed ? Math.round(totals.durationMs / totals.completed) : 0 }, statuses: { ...statuses } }
    },
  }
}
