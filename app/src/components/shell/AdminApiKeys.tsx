import { ShellButton } from './ShellButton'
import { useEffect, useState, type FormEvent } from 'react'
import { Copy } from 'lucide-react'
import { createApiKey, listApiKeys, revokeApiKey, type ApiKey, type ApiKeyKind, type ApiKeyList, type CreatedApiKey } from '../../lib/apiKeys'

const date = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString() : 'Never'

/** Server-to-server API keys for the /api/v1 model API. Keys are shown once, at creation. */
export function AdminApiKeys() {
  const [list, setList] = useState<ApiKeyList | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [organisationId, setOrganisationId] = useState('') // '' = a new organisation
  const [organisation, setOrganisation] = useState('')
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<ApiKeyKind>('test')
  const [limit, setLimit] = useState('')
  const [agreement, setAgreement] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [created, setCreated] = useState<CreatedApiKey | null>(null)
  const [copied, setCopied] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void listApiKeys(controller.signal).then((value) => { if (!controller.signal.aborted) { setList(value); setError('') } })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'API keys could not be loaded.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [attempt])
  const reload = () => { setLoading(true); setError(''); setAttempt((value) => value + 1) }
  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const dailyReadLimit = limit.trim() === '' ? null : Number(limit)
    if (dailyReadLimit !== null && (!Number.isInteger(dailyReadLimit) || dailyReadLimit < 0 || dailyReadLimit > 10000)) { setMessage('Daily read limit must be a whole number from 0 to 10,000, or empty for the default.'); return }
    setBusy(true); setMessage('')
    try {
      const result = await createApiKey({ organisationId: organisationId || null, organisation, label, kind, dailyReadLimit, dataAgreementId: agreement, currentPassword: adminPassword })
      setCreated(result); setCopied('')
      setOrganisationId(''); setOrganisation(''); setLabel(''); setLimit(''); setAgreement(''); setAdminPassword(''); setKind('test')
      reload()
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'The key could not be created.') }
    finally { setBusy(false) }
  }
  const revoke = async (key: ApiKey) => {
    if (busy || !window.confirm(`Revoke “${key.label}” for ${key.organisation}? Systems using ${key.prefix}… stop working immediately. This cannot be undone.`)) return
    setBusy(true); setMessage('')
    try { await revokeApiKey(key.id); setMessage(`Revoked ${key.prefix}…`); reload() }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'The key could not be revoked.') }
    finally { setBusy(false) }
  }
  const copy = async (name: string, value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(name) } catch { setCopied(''); setMessage('Copy failed. Select the text and copy it manually.') }
  }
  const defaults = list?.defaults
  const organisations = list?.organisations ?? []
  const namesake = organisationId === '' && organisation.trim() !== '' && organisations.some((item) => item.name.trim().toLowerCase() === organisation.trim().toLowerCase())
  return <section className="admin-audit admin-api-keys" aria-labelledby="admin-api-keys-heading">
    <div className="admin-refresh"><h3 className="admin-heading" id="admin-api-keys-heading">API keys</h3><ShellButton className="btn" disabled={loading} onClick={reload}>Refresh</ShellButton></div>
    <p className="admin-note">Keys let another organisation's server call the model API at /api/v1 with Authorization: Bearer. They work only for model reads, never for studies, sharing or administration. Reads made with a key are never kept for model training. Output is for research and review support, not diagnosis.</p>
    {list && !list.apiAvailable && <p className="admin-error" role="status">The hosted model service is not configured on this server, so every key request is refused until MODEL_UPSTREAM_URL and BRIDGE_SECRET are set.</p>}
    {error && <div><p className="admin-error" role="alert">{error}</p><ShellButton className="btn" onClick={reload}>Retry keys</ShellButton></div>}
    {loading && !list ? <p role="status" className="admin-note">Loading keys...</p> : list && <div className="admin-table-wrap"><table className="admin-table admin-key-table"><thead><tr><th scope="col">Label</th><th scope="col">Organisation</th><th scope="col">Key</th><th scope="col">Kind</th><th scope="col">Reads / day</th><th scope="col">Last used</th><th scope="col">Status</th></tr></thead>
      <tbody>{list.keys.length === 0 && <tr><td colSpan={7} className="admin-muted">No keys yet.</td></tr>}{list.keys.map((key) => <tr key={key.id} className={key.revokedAt ? 'admin-muted' : undefined}>
        <td>{key.label}{key.dataAgreementId && <small className="admin-subject"> · {key.dataAgreementId}</small>}{list.webhooksConfigured && !key.webhooks && <small className="admin-muted"> · no webhooks</small>}</td><td>{key.organisation}</td><td><code className="admin-subject">{key.prefix}…</code></td><td>{key.kind === 'live' ? 'Live' : 'Test'}</td>
        <td>{key.dailyReadLimit.toLocaleString()}{!key.customLimit && <small className="admin-muted"> default</small>}</td><td>{date(key.lastUsedAt)}</td>
        <td>{key.revokedAt ? `Revoked ${date(key.revokedAt)}` : <ShellButton className="btn btn-destructive" disabled={busy} onClick={() => { void revoke(key) }}>Revoke</ShellButton>}</td></tr>)}</tbody></table></div>}
    {created && <section className="admin-key-reveal" role="alert" aria-labelledby="admin-key-reveal-heading">
      <h4 id="admin-key-reveal-heading">Copy this key now. It will not be shown again.</h4>
      <p className="admin-note">RadGenie stores only a hash of the key. Send it to {created.key.organisation} through your approved secure channel. If it is lost, revoke it and create a new one.</p>
      <label>API key ({created.key.prefix}…)<span className="admin-secret"><code>{created.secret}</code><ShellButton className="btn" onClick={() => { void copy('key', created.secret) }}><Copy aria-hidden="true" />{copied === 'key' ? 'Copied' : 'Copy'}</ShellButton></span></label>
      {created.webhookSecret
        ? <label>Webhook signing secret<span className="admin-secret"><code>{created.webhookSecret}</code><ShellButton className="btn" onClick={() => { void copy('webhook', created.webhookSecret ?? '') }}><Copy aria-hidden="true" />{copied === 'webhook' ? 'Copied' : 'Copy'}</ShellButton></span><small>Verifies the X-VoxelRad-Signature header on read webhooks.</small></label>
        : <p className="admin-note">Webhooks are off on this server (API_WEBHOOK_SECRET is not set), so no webhook secret was issued. This key can submit and poll reads, but it can never register a webhook, even after webhooks are turned on; issue a new key then.</p>}
      <ShellButton className="btn btn-primary" onClick={() => { setCreated(null); setCopied('') }}>I have stored the key</ShellButton>
    </section>}
    {message && <p role="status" className="admin-note">{message}</p>}
    <details className="admin-create"><summary>Create an API key</summary><form onSubmit={(event) => { void create(event) }}>
      <label>Organisation<select value={organisationId} onChange={(event) => setOrganisationId(event.target.value)} disabled={busy}>
        <option value="">New organisation</option>
        {organisations.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.activeKeys} active {item.activeKeys === 1 ? 'key' : 'keys'} · since {date(item.createdAt)}</option>)}
      </select><small>Keys of the same organisation can poll and cancel each other's reads. Pick an existing one to add a key for the same customer.</small></label>
      {organisationId === '' && <label>New organisation name<input autoComplete="organization" required maxLength={120} value={organisation} onChange={(event) => setOrganisation(event.target.value)} disabled={busy} />
        <small>{namesake ? 'An organisation with this name already exists. A new one keeps its reads separate; choose it from the list above to share them.' : 'The name is a label only. Access is tied to the organisation record, not its name.'}</small></label>}
      <label>Label<input autoComplete="off" required maxLength={120} value={label} onChange={(event) => setLabel(event.target.value)} disabled={busy} /><small>Which system uses the key, for example “PACS bridge, staging”.</small></label>
      <label>Kind<select value={kind} onChange={(event) => setKind(event.target.value as ApiKeyKind)} disabled={busy}><option value="test">Test (same model, {defaults?.test ?? 20} reads/day by default)</option><option value="live">Live ({defaults?.live ?? 200} reads/day by default)</option></select></label>
      <label>Daily read limit<input type="number" inputMode="numeric" min={0} max={10000} step={1} placeholder={`Default: ${defaults ? defaults[kind] : kind === 'live' ? 200 : 20}`} value={limit} onChange={(event) => setLimit(event.target.value)} disabled={busy} /><small>Leave empty to use the server default. Every read spends the shared GPU quota.</small></label>
      <label>Data agreement reference (optional)<input autoComplete="off" maxLength={200} value={agreement} onChange={(event) => setAgreement(event.target.value)} disabled={busy} /><small>Recorded for a possible future opt-in only. API reads are not captured for training.</small></label>
      <label>Your administrator password<input type="password" autoComplete="current-password" required value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} disabled={busy} /><small>Confirms it is you before issuing a key.</small></label>
      <ShellButton type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Creating key...' : 'Create key'}</ShellButton>
    </form></details>
  </section>
}
