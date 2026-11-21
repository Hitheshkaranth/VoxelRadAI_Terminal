// Several interchangeable model upstreams behind one proxy (the ZeroGPU Space, dedicated GPU servers from
// deploy/gpu, or both). Each read goes to the least-loaded healthy upstream; an upstream that keeps failing is
// skipped for a cool-down (a simple circuit breaker). Fail-over happens only for reads that never started on a GPU,
// so a read is never run twice and quota refunds keep their meaning (see modelProxy.openRead).

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * HTTPS upstream (or plain http for loopback, or for a host named in `httpHosts`: private service names such as a
 * Compose GPU container), without a trailing slash. Null when unusable.
 */
export function upstreamBase(value, httpHosts = []) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    const plainAllowed = LOOPBACK.has(url.hostname) || httpHosts.includes(url.hostname)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && plainAllowed)) return null
    if (url.username || url.password || url.search || url.hash) return null
    return url.href.replace(/\/+$/, '')
  } catch { return null }
}

const httpHostsFrom = env => typeof env.MODEL_UPSTREAM_HTTP_HOSTS === 'string'
  ? env.MODEL_UPSTREAM_HTTP_HOSTS.split(',').map(host => host.trim().toLowerCase()).filter(host => /^[a-z0-9][a-z0-9.-]{0,252}$/.test(host))
  : []

/** Distinct usable upstream bases: MODEL_UPSTREAMS (comma-separated) when set, else MODEL_UPSTREAM_URL. */
export function parseUpstreams(env) {
  const httpHosts = httpHostsFrom(env)
  const raw = typeof env.MODEL_UPSTREAMS === 'string' && env.MODEL_UPSTREAMS.trim() ? env.MODEL_UPSTREAMS.split(',') : [env.MODEL_UPSTREAM_URL]
  const bases = []
  for (const entry of raw) {
    const base = upstreamBase(entry, httpHosts)
    if (base && !bases.includes(base)) bases.push(base)
  }
  return bases
}

/**
 * `failureThreshold` consecutive start failures open an upstream's circuit for `cooldownMs`; after that one read
 * may try it again (half-open), and a success closes it. When every circuit is open the upstreams are still tried,
 * oldest-opened first: refusing outright would turn a brief network fault into a full outage.
 */
export function createUpstreamPool(bases, { failureThreshold = 3, cooldownMs = 30_000, now = Date.now } = {}) {
  const upstreams = bases.map((base, index) => ({ index, base, host: new URL(base).host, inFlight: 0, consecutiveFailures: 0, openUntil: 0, started: 0, failures: 0 }))
  let turn = 0
  const isOpen = upstream => upstream.openUntil > now()
  return {
    size: upstreams.length,
    /** Upstreams in the order a new read should try them. */
    candidates() {
      turn = (turn + 1) % Math.max(1, upstreams.length)
      const rotated = upstreams.map((upstream, i) => upstreams[(i + turn) % upstreams.length])
      const closed = rotated.filter(upstream => !isOpen(upstream)).sort((a, b) => a.inFlight - b.inFlight)
      const open = rotated.filter(isOpen).sort((a, b) => a.openUntil - b.openUntil)
      return [...closed, ...open]
    },
    started(upstream) { upstream.started++; upstream.consecutiveFailures = 0; upstream.openUntil = 0 },
    failed(upstream) {
      upstream.failures++
      upstream.consecutiveFailures++
      if (upstream.consecutiveFailures >= failureThreshold) upstream.openUntil = now() + cooldownMs
    },
    /** Count a read against an upstream until `release` is called (exactly once). */
    track(upstream) {
      upstream.inFlight++
      let released = false
      return () => { if (!released) { released = true; upstream.inFlight-- } }
    },
    snapshot() {
      return upstreams.map(upstream => ({ index: upstream.index, host: upstream.host, up: !isOpen(upstream), inFlight: upstream.inFlight, started: upstream.started, failures: upstream.failures }))
    },
  }
}

/** Wrap a response body so `release` runs once the consumer finishes, stops early or fails. */
export async function* releasing(body, release) {
  try { for await (const chunk of body) yield chunk } finally { release() }
}
