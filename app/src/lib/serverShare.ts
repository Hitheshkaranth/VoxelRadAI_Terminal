import type { Study } from '../types.ts'

export interface HostedShare { id: string; expiresAt: number; createdAt: number; revokedAt: number | null }
export interface CreatedShare { id: string; expiresAt: number; url: string }

function timestamp(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN
  if (!Number.isFinite(parsed)) throw new Error('The server returned an invalid share date.')
  return parsed
}
async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init, headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } })
  if (response.status === 401) throw new Error('Your session expired. Sign in again before creating or managing links.')
  if (response.status === 403) throw new Error('Your account cannot share this study.')
  if (response.status === 413) throw new Error('This study is too large for the server. Download a file or ask your administrator about the upload limit.')
  if (!response.ok) throw new Error('The share service could not complete this request. Check your connection and try again.')
  try { return await response.json() }
  catch { throw new Error('The server returned an unreadable response. Refresh link history before retrying.') }
}
export async function listHostedShares(studyId: string, signal?: AbortSignal): Promise<HostedShare[]> {
  const result = await request(`/api/studies/${encodeURIComponent(studyId)}/shares`, { signal }) as { shares?: unknown }
  if (!result || !Array.isArray(result.shares)) throw new Error('The server returned an invalid share list.')
  return result.shares.map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string' || !('expiresAt' in item) || !('createdAt' in item) || !('revokedAt' in item)) throw new Error('The server returned an invalid share list.')
    return { id: item.id, expiresAt: timestamp(item.expiresAt), createdAt: timestamp(item.createdAt), revokedAt: item.revokedAt == null ? null : timestamp(item.revokedAt) }
  })
}
export async function createHostedShare(study: Study, options: { expiresInHours: number; includeIdentity: boolean; includeImages: boolean }): Promise<CreatedShare> {
  await request('/api/studies', { method: 'POST', body: JSON.stringify(study) })
  const result = await request(`/api/studies/${encodeURIComponent(study.id)}/shares`, { method: 'POST', body: JSON.stringify(options) }) as { share?: { id?: unknown; expiresAt?: unknown; url?: unknown } }
  const share = result?.share
  if (!share || typeof share.id !== 'string' || typeof share.url !== 'string') throw new Error('The link was requested but its response was invalid. Refresh link history before retrying.')
  const url = new URL(share.url, window.location.origin)
  if (url.origin !== window.location.origin || url.username || url.password || !url.pathname.startsWith('/api/shared/') || !['http:', 'https:'].includes(url.protocol)) throw new Error('The server returned an unexpected share address. Refresh link history before retrying.')
  return { id: share.id, expiresAt: timestamp(share.expiresAt), url: url.href }
}
export async function revokeHostedShare(id: string): Promise<void> {
  await request(`/api/shares/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
