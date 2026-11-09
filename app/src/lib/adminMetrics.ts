import type { Study } from '../types.ts'

/** Aggregate only: no IDs, patient fields, image data, clinical text or model output. */
export function localMetrics(studies: Study[]) {
  const images = studies.flatMap((study) => study.images)
  return {
    studies: studies.length,
    images: images.length,
    analyzed: images.filter((image) => image.status === 'done').length,
    analyzing: images.filter((image) => image.status === 'analyzing').length,
    errors: images.filter((image) => image.status === 'error').length,
    reports: studies.filter((study) => study.report).length,
    signed: studies.filter((study) => study.report?.signed).length,
  }
}

export interface OrganizationMetrics {
  scope: 'organization'
  generatedAt: string
  users: { total: number; active30d: number }
  studies: { total: number }
  images: { total: number }
  reports: { total: number; signed: number }
  shares: { active: number; revoked: number }
  jobs: { queued: number; running: number; failed: number; available?: boolean }
  events: { total30d: number }
}

const fields = { users: ['total', 'active30d'], studies: ['total'], images: ['total'], reports: ['total', 'signed'], shares: ['active', 'revoked'], jobs: ['queued', 'running', 'failed'], events: ['total30d'] } as const
export function validateOrganizationMetrics(value: unknown): OrganizationMetrics {
  if (!value || typeof value !== 'object') throw new Error('Invalid analytics response')
  const input = value as Record<string, unknown>
  if (input.scope !== 'organization' || typeof input.generatedAt !== 'string' || !Number.isFinite(Date.parse(input.generatedAt))) throw new Error('Invalid analytics response')
  const output: Record<string, unknown> = { scope: 'organization', generatedAt: input.generatedAt }
  for (const [group, names] of Object.entries(fields)) {
    const source = input[group]
    if (!source || typeof source !== 'object') throw new Error('Invalid analytics response')
    const safe: Record<string, number> = {}
    for (const name of names) {
      const count = (source as Record<string, unknown>)[name]
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid analytics count')
      safe[name] = count
    }
    output[group] = safe
  }
  const metrics = output as unknown as OrganizationMetrics
  const jobs = input.jobs as Record<string, unknown>
  if (jobs.available !== undefined) {
    if (typeof jobs.available !== 'boolean') throw new Error('Invalid jobs availability')
    metrics.jobs.available = jobs.available
  }
  if (metrics.users.active30d > metrics.users.total || metrics.reports.signed > metrics.reports.total) throw new Error('Inconsistent analytics totals')
  return metrics
}

export async function fetchOrganizationMetrics(signal?: AbortSignal): Promise<OrganizationMetrics> {
  const response = await fetch('/api/admin/metrics', { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store', signal })
  if (response.status === 401) throw new Error('Sign in to view organization analytics.')
  if (response.status === 403) throw new Error('An administrator account is required.')
  if (response.status === 404) throw new Error('Organization analytics are not configured on this server.')
  if (!response.ok) throw new Error('Analytics could not be loaded. Try again.')
  try { return validateOrganizationMetrics(await response.json()) }
  catch { throw new Error('The server did not return valid analytics. Check the API configuration.') }
}
