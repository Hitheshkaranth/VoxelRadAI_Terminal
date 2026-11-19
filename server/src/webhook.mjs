// Outbound webhooks for finished API reads. The destination is chosen by an API client, so every
// request is guarded against server-side request forgery: HTTPS only, no credentials in the URL, and
// every address the host resolves to must be public. The check runs again inside the connection's own
// DNS lookup, so a host cannot pass validation and then rebind to a private address. Redirects are
// never followed.
import { BlockList, isIP } from 'node:net'
import { lookup as dnsLookup, promises as dns } from 'node:dns'
import https from 'node:https'
import { createHmac } from 'node:crypto'

const blocked = new BlockList()
for (const [network, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(network, prefix, 'ipv4')
// Includes NAT64, Teredo and 6to4 ranges, which can embed a private IPv4 address, and ::/96 (unspecified, loopback and
// the deprecated IPv4-compatible ::a.b.c.d form). IPv4-mapped addresses (::ffff:a.b.c.d) are refused in isPublicAddress:
// a BlockList rule for ::ffff:0:0/96 would also match every IPv4 address.
for (const [network, prefix] of [['::', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) blocked.addSubnet(network, prefix, 'ipv6')

export const WEBHOOK_TIMEOUT_MS = 10_000
export const WEBHOOK_RETRIES = 3

/** True for a literal IP address that is routable on the public internet. */
export function isPublicAddress(address) {
  const family = isIP(address)
  if (!family) return false
  if (family === 6 && /^[0:]*:ffff:/i.test(address)) return false
  return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6')
}

const bare = hostname => hostname.replace(/^\[|\]$/g, '')
const resolveAll = async hostname => (await dns.lookup(hostname, { all: true, verbatim: true })).map(entry => entry.address)

/**
 * Validate a client-supplied webhook URL and resolve its host now. Returns { url } or { error }.
 * `resolve` is injectable for tests; it returns every address for the host.
 */
export async function checkWebhookUrl(value, { resolve = resolveAll, timeoutMs = 3000 } = {}) {
  if (typeof value !== 'string' || !value || value.length > 2048) return { error: 'webhook_url must be an HTTPS URL of at most 2048 characters.' }
  let url
  try { url = new URL(value) } catch { return { error: 'webhook_url is not a valid URL.' } }
  if (url.protocol !== 'https:') return { error: 'webhook_url must use https.' }
  if (url.username || url.password) return { error: 'webhook_url must not contain credentials.' }
  const host = bare(url.hostname).toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return { error: 'webhook_url must point to a public host.' }
  let addresses
  if (isIP(host)) addresses = [host]
  else {
    try {
      addresses = await Promise.race([resolve(host), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs).unref?.())])
    } catch { return { error: 'webhook_url host could not be resolved.' } }
  }
  if (!Array.isArray(addresses) || !addresses.length) return { error: 'webhook_url host could not be resolved.' }
  if (!addresses.every(isPublicAddress)) return { error: 'webhook_url must not resolve to a private, loopback or reserved address.' }
  return { url: url.href }
}

/** Connection-time DNS lookup that refuses private addresses (closes the gap between validation and connect). */
export function guardedLookup(resolver = dnsLookup) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {} }
    resolver(hostname, { all: true, verbatim: true }, (error, entries) => {
      if (error) return callback(error)
      const list = Array.isArray(entries) ? entries : []
      if (!list.length || !list.every(entry => isPublicAddress(entry.address))) return callback(Object.assign(new Error('Webhook host resolves to a non-public address.'), { code: 'EPRIVATEADDR' }))
      if (options?.all) return callback(null, list)
      callback(null, list[0].address, list[0].family)
    })
  }
}

/**
 * X-VoxelRad-Signature value: HMAC-SHA256 over `${timestamp}.${rawBody}`, where `timestamp` is the Unix time in
 * seconds sent as X-VoxelRad-Timestamp. Signing the time lets a receiver refuse a captured delivery replayed later.
 */
export const signWebhook = (secret, timestamp, rawBody) => 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')

/** One HTTPS POST without redirects. Resolves to the status code; rejects on network errors or timeout. `ca` is for tests. */
export function postJson(target, rawBody, headers, timeoutMs, { lookup = guardedLookup(), ca } = {}) {
  return new Promise((resolve, reject) => {
    let url
    try { url = new URL(target) } catch (error) { return reject(error) }
    if (url.protocol !== 'https:') return reject(new Error('Webhook URL must use https.'))
    const host = bare(url.hostname)
    // Node skips the lookup hook for literal addresses, so check them here.
    if (isIP(host) && !isPublicAddress(host)) return reject(Object.assign(new Error('Webhook host is not a public address.'), { code: 'EPRIVATEADDR' }))
    let timer
    const settle = (fn, value) => { clearTimeout(timer); fn(value) }
    const request = https.request({ method: 'POST', hostname: host, port: url.port || 443, path: url.pathname + url.search, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(rawBody), ...headers }, lookup, agent: false, ...(ca ? { ca } : {}) }, response => {
      response.resume()
      response.on('end', () => settle(resolve, response.statusCode))
      response.on('error', error => settle(reject, error))
      response.on('close', () => settle(reject, new Error('Webhook response closed before it ended.')))
    })
    // A wall-clock limit for the whole attempt. A socket idle timeout restarts on every byte, so a receiver that
    // drips its handshake or response slowly could otherwise hold the attempt (and the function) open indefinitely.
    timer = setTimeout(() => request.destroy(new Error('Webhook request timed out.')), timeoutMs)
    request.on('error', error => settle(reject, error))
    request.end(rawBody)
  })
}

/**
 * Deliver one webhook: up to 1 + WEBHOOK_RETRIES attempts with 1 s, 2 s, 4 s backoff, never past `deadline`
 * (epoch ms). Only a 2xx response counts as delivered; a 3xx is not followed.
 */
export async function deliverWebhook({ url, payload, secret, deadline = Date.now() + 60_000, post = postJson, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now }) {
  const rawBody = JSON.stringify(payload)
  let attempts = 0, lastStatus = null
  for (let attempt = 0; attempt <= WEBHOOK_RETRIES; attempt++) {
    if (attempt > 0) {
      const wait = 1000 * 2 ** (attempt - 1)
      if (now() + wait + 1000 > deadline) break
      await sleep(wait)
    }
    const remaining = deadline - now()
    if (remaining < 1000) break
    attempts++
    // Signed afresh for every attempt, so a retry carries its own current timestamp.
    const timestamp = String(Math.floor(now() / 1000))
    const headers = { 'User-Agent': 'VoxelRad-Webhooks/1', 'X-VoxelRad-Timestamp': timestamp, 'X-VoxelRad-Signature': signWebhook(secret, timestamp, rawBody) }
    try {
      lastStatus = await post(url, rawBody, headers, Math.min(WEBHOOK_TIMEOUT_MS, remaining))
      if (lastStatus >= 200 && lastStatus < 300) return { delivered: true, attempts, status: lastStatus }
    } catch (error) {
      lastStatus = null
      if (error?.code === 'EPRIVATEADDR') break
    }
  }
  return { delivered: false, attempts, status: lastStatus }
}
