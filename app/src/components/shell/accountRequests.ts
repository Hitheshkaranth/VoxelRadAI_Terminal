/** Account credentials stay in the request body and are never persisted or put in URLs. */
export async function accountRequest(path: string, body: Record<string, string>) {
  if (!/^\/api\/(?:account\/password|password-recovery|admin\/users\/[^/]+\/recovery)$/.test(path)) throw new Error('Invalid account action.')
  const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) {
    if (response.status === 429) throw new Error('Too many attempts. Wait a few minutes and try again.')
    if (response.status === 401 || response.status === 403) throw new Error('Your credentials could not be verified. Check your password and session.')
    if (response.status === 400 || response.status === 410) throw new Error('Check the credentials and use a password of at least 12 characters. Recovery codes may have expired or already been used.')
    throw new Error('The account could not be updated. Check your connection and try again.')
  }
  const result: unknown = await response.json()
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('The server returned an invalid account response.')
  const record = result as Record<string, unknown>
  if (path.startsWith('/api/admin/')) {
    if (typeof record.token !== 'string' || !record.token || typeof record.expiresAt !== 'string' || !Number.isFinite(Date.parse(record.expiresAt))) throw new Error('The server returned an invalid recovery response.')
  } else if (record.ok !== true) throw new Error('The server did not confirm the account update.')
  return record
}
