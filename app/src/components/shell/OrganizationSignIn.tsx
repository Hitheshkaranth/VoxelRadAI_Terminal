import { useEffect, useState, type FormEvent } from 'react'
import { ShellButton } from './ShellButton'

export function OrganizationSignIn({ account = false }: { account?: boolean }) {
  const [provider, setProvider] = useState('')
  const [linked, setLinked] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      const response = await fetch('/api/oidc/config', { signal: controller.signal, cache: 'no-store' })
      if (!response.ok) throw new Error('Organization sign-in could not be checked.')
      const config = await response.json()
      if (config.enabled !== true) return
      if (account) {
        const identity = await fetch('/api/oidc/identity', { signal: controller.signal, cache: 'no-store' })
        if (!identity.ok) throw new Error('Your organization account link could not be checked.')
        const data = await identity.json()
        if (typeof data.linked !== 'boolean') throw new Error('Invalid account link response.')
        setLinked(data.linked)
      }
      setProvider(typeof config.providerName === 'string' ? config.providerName : 'Organization')
    })().catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Organization sign-in is unavailable.') })
    return () => controller.abort()
  }, [account])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch(linked ? '/api/oidc/identity' : '/api/oidc/link', { method: linked ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: password }) })
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Account linking failed. Try again.')
      setPassword('')
      if (linked) { window.location.reload(); return }
      const target = new URL(data.url)
      if (!['https:', 'http:'].includes(target.protocol)) throw new Error('Invalid sign-in address.')
      window.location.assign(target.href)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Account linking failed.'); setBusy(false) }
  }
  if (!provider) return error ? <p role="alert" className="admin-error">{error}</p> : null
  if (!account) return <ShellButton className="btn session-submit" onClick={() => window.location.assign('/api/oidc/login')}>Continue with {provider}</ShellButton>
  return <details className="sh-account-security"><summary>Organization sign-in</summary>
    <p>{linked ? `Your account is linked to ${provider}. Unlinking signs you out of all app sessions.` : `Link your existing workspace to ${provider}. Your organization manages its sign-in and MFA policy.`}</p>
    <form onSubmit={(event) => { void submit(event) }} aria-busy={busy}>
      <label>Current workspace password<input className="input" type="password" autoComplete="current-password" required disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {error && <p role="alert" className="admin-error">{error}</p>}
      <ShellButton className="btn" type="submit" disabled={busy}>{busy ? 'Verifying…' : linked ? 'Unlink organization account' : `Link with ${provider}`}</ShellButton>
    </form>
  </details>
}
