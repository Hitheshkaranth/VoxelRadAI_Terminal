// Admin client for server-to-server API keys (/api/admin/api-keys). The plaintext key and webhook secret
// exist only in the create response: they are never stored by this module or put in browser storage.

export type ApiKeyKind = 'live' | 'test'
export interface ApiKey {
  id: string
  /** The organisation record. Reads are shared by id, never by name: two organisations may share a name. */
  organisationId: string
  organisation: string
  label: string
  prefix: string
  kind: ApiKeyKind
  dailyReadLimit: number
  customLimit: boolean
  dataAgreementId: string | null
  /** False when the key was issued without a webhook signing secret; it cannot register webhooks. */
  webhooks: boolean
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}
export interface ApiOrganisation { id: string; name: string; createdAt: string; activeKeys: number }
export interface ApiKeyList { keys: ApiKey[]; organisations: ApiOrganisation[]; defaults: Record<ApiKeyKind, number>; webhooksConfigured: boolean; apiAvailable: boolean }
export interface CreatedApiKey { key: ApiKey; secret: string; webhookSecret: string | null }
/** A key joins an existing organisation (`organisationId`) or creates a new one named `organisation`. */
export interface NewApiKey { organisationId: string | null; organisation: string; label: string; kind: ApiKeyKind; dailyReadLimit: number | null; dataAgreementId: string; currentPassword: string }

const isKey = (value: unknown): value is ApiKey => {
  const item = value as Partial<ApiKey> | null
  return !!item && typeof item.id === 'string' && typeof item.organisationId === 'string' && typeof item.organisation === 'string' && typeof item.label === 'string' && typeof item.prefix === 'string'
    && (item.kind === 'live' || item.kind === 'test') && typeof item.dailyReadLimit === 'number' && typeof item.createdAt === 'string'
}
const isOrganisation = (value: unknown): value is ApiOrganisation => {
  const item = value as Partial<ApiOrganisation> | null
  return !!item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.activeKeys === 'number'
}

async function failure(response: Response, fallback: string): Promise<never> {
  if (response.status === 403) throw new Error('Your administrator password is incorrect, or this account is not an administrator.')
  if (response.status === 429) throw new Error('Too many attempts. Try again in 15 minutes.')
  if (response.status === 404) throw new Error('This server does not support API keys yet. Deploy the latest API.')
  if (response.status === 400) {
    const value = await response.json().catch(() => null) as { error?: unknown } | null
    throw new Error(typeof value?.error === 'string' ? value.error : fallback)
  }
  throw new Error(fallback)
}

export async function listApiKeys(signal?: AbortSignal): Promise<ApiKeyList> {
  const response = await fetch('/api/admin/api-keys', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal })
  if (!response.ok) return failure(response, 'API keys could not be loaded. Try again.')
  const value = await response.json() as Partial<ApiKeyList>
  if (!Array.isArray(value.keys) || !value.defaults || typeof value.defaults.live !== 'number' || typeof value.defaults.test !== 'number') throw new Error('The server returned an invalid key list.')
  const organisations = Array.isArray(value.organisations) ? value.organisations.filter(isOrganisation) : []
  return { keys: value.keys.filter(isKey).map((key) => ({ ...key, webhooks: key.webhooks === true })), organisations, defaults: value.defaults, webhooksConfigured: value.webhooksConfigured === true, apiAvailable: value.apiAvailable === true }
}

export async function createApiKey(input: NewApiKey): Promise<CreatedApiKey> {
  const body = { ...(input.organisationId ? { organisationId: input.organisationId } : { organisation: input.organisation.trim() }), label: input.label.trim(), kind: input.kind, dailyReadLimit: input.dailyReadLimit, dataAgreementId: input.dataAgreementId.trim() || null, currentPassword: input.currentPassword }
  const response = await fetch('/api/admin/api-keys', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) return failure(response, 'The key could not be created. Check the fields and try again.')
  const value = await response.json() as Partial<CreatedApiKey>
  if (!isKey(value.key) || typeof value.secret !== 'string' || !/^vr_(live|test)_[A-Za-z0-9_-]{43}$/.test(value.secret)) throw new Error('The server returned an invalid key.')
  return { key: value.key, secret: value.secret, webhookSecret: typeof value.webhookSecret === 'string' ? value.webhookSecret : null }
}

export async function revokeApiKey(id: string): Promise<ApiKey> {
  const response = await fetch(`/api/admin/api-keys/${encodeURIComponent(id)}/revoke`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  if (!response.ok) return failure(response, 'The key could not be revoked. Try again.')
  const value = await response.json() as { key?: unknown }
  if (!isKey(value.key)) throw new Error('The server returned an invalid key.')
  return value.key
}
