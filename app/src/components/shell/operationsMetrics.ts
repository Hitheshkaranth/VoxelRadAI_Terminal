export interface OperationsMetrics {
  scope: 'process'
  generatedAt: string
  uptimeSeconds: number
  requests: { completed: number; failed: number; inFlight: number; durationMs: number; maxDurationMs: number; meanDurationMs: number }
  statuses: { '2xx': number; '3xx': number; '4xx': number; '5xx': number }
  database: { status: 'ready'; connections: number; idle: number; waiting: number }
  memory: { rssBytes: number }
  features: { accountRecovery: 'administrator-issued-token'; mfa: boolean; sso: boolean; multiTenant: boolean; volumeStorage: boolean; durableInferenceJobs: boolean }
}

const invalid = () => new Error('The server returned invalid operational metrics.')
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  return value as Record<string, unknown>
}
function number(value: unknown, integer = true): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) throw invalid()
  return value
}
function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw invalid()
  return value
}

/** Explicit allowlist: operational display never retains identities, paths or payloads. */
export function validateOperationsMetrics(value: unknown): OperationsMetrics {
  const input = object(value)
  if (input.scope !== 'process' || typeof input.generatedAt !== 'string' || !Number.isFinite(Date.parse(input.generatedAt))) throw invalid()
  const requests = object(input.requests), statuses = object(input.statuses), database = object(input.database), memory = object(input.memory), features = object(input.features)
  if (database.status !== 'ready' || features.accountRecovery !== 'administrator-issued-token') throw invalid()
  const output: OperationsMetrics = {
    scope: 'process', generatedAt: input.generatedAt, uptimeSeconds: number(input.uptimeSeconds),
    requests: { completed: number(requests.completed), failed: number(requests.failed), inFlight: number(requests.inFlight), durationMs: number(requests.durationMs, false), maxDurationMs: number(requests.maxDurationMs, false), meanDurationMs: number(requests.meanDurationMs, false) },
    statuses: { '2xx': number(statuses['2xx']), '3xx': number(statuses['3xx']), '4xx': number(statuses['4xx']), '5xx': number(statuses['5xx']) },
    database: { status: 'ready', connections: number(database.connections), idle: number(database.idle), waiting: number(database.waiting) },
    memory: { rssBytes: number(memory.rssBytes) },
    features: { accountRecovery: 'administrator-issued-token', mfa: flag(features.mfa), sso: flag(features.sso), multiTenant: flag(features.multiTenant), volumeStorage: flag(features.volumeStorage), durableInferenceJobs: flag(features.durableInferenceJobs) },
  }
  if (output.requests.failed > output.requests.completed || output.database.idle > output.database.connections) throw invalid()
  return output
}

export async function fetchOperationsMetrics(signal?: AbortSignal): Promise<OperationsMetrics> {
  const response = await fetch('/api/admin/operations', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal })
  if (response.status === 401) throw new Error('Sign in to view server operations.')
  if (response.status === 403) throw new Error('An administrator account is required to view server operations.')
  if (response.status === 404) throw new Error('Operational metrics are not available on this server version.')
  if (!response.ok) throw new Error('Server operations could not be loaded. Try again.')
  return validateOperationsMetrics(await response.json())
}
