import { useState, type FormEvent } from 'react'
import { ShellButton } from './ShellButton'
import { useSession } from '../../lib/session'
import { accountRequest } from './accountRequests'

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (password !== confirmation) { setError('The new passwords do not match.'); return }
    setBusy(true); setError('')
    try { await accountRequest('/api/account/password', { currentPassword, password }); setCurrentPassword(''); setPassword(''); setConfirmation(''); useSession.getState().setUser(null); window.location.reload() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Password change failed.'); setBusy(false) }
  }
  return <details className="sh-account-security"><summary>Change password</summary>
    <p>Changing your password signs out all sessions. Sign in again with your new password.</p>
    <form onSubmit={(event) => { void submit(event) }} aria-busy={busy}>
      <label>Current password<input className="input" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={busy} /></label>
      <label>New password<input className="input" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} /></label>
      <label>Confirm new password<input className="input" type="password" autoComplete="new-password" required minLength={12} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} /></label>
      <small>Use at least 12 characters.</small>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <ShellButton type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Changing password…' : 'Change password and sign out'}</ShellButton>
    </form>
  </details>
}

export function RecoveryForm({ onBack }: { onBack: () => void }) {
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (password !== confirmation) { setError('The new passwords do not match.'); return }
    setBusy(true); setError('')
    try { await accountRequest('/api/password-recovery', { token: token.trim(), password }); setToken(''); setPassword(''); setConfirmation(''); setComplete(true) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Recovery failed.') }
    finally { setBusy(false) }
  }
  if (complete) return <div><p role="status">Password updated. Sign in with your new password.</p><ShellButton className="btn btn-primary" onClick={onBack}>Back to sign in</ShellButton></div>
  return <form className="session-form" aria-busy={busy} onSubmit={(event) => { void submit(event) }}>
    <p>Ask your administrator for a one-use recovery code. Enter it here within 15 minutes; never put it in a URL.</p>
    <label htmlFor="recovery-token">Recovery code</label><input id="recovery-token" type="password" autoComplete="off" spellCheck={false} required value={token} onChange={(event) => setToken(event.target.value)} disabled={busy} />
    <label htmlFor="recovery-password">New password</label><input id="recovery-password" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
    <label htmlFor="recovery-confirmation">Confirm new password</label><input id="recovery-confirmation" type="password" autoComplete="new-password" minLength={12} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} />
    {error && <p className="session-error" role="alert">{error}</p>}
    <ShellButton type="submit" className="btn btn-primary session-submit" disabled={busy}>{busy ? 'Updating password…' : 'Set new password'}</ShellButton>
    <ShellButton className="btn" disabled={busy} onClick={onBack}>Back to sign in</ShellButton>
  </form>
}

export function AdminRecovery({ userId }: { userId: string }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setToken('')
    try {
      const result = await accountRequest(`/api/admin/users/${encodeURIComponent(userId)}/recovery`, { currentPassword })
      if (typeof result.token !== 'string' || typeof result.expiresAt !== 'string') throw new Error('The server returned an invalid recovery response.')
      setToken(result.token); setExpiresAt(result.expiresAt); setCurrentPassword('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Recovery code creation failed.') }
    finally { setBusy(false) }
  }
  return <details className="sh-account-security"><summary>Issue a recovery code</summary>
    <p>Verify your administrator password to issue a one-use code. Share it with the intended account holder through your approved secure channel. No email is sent.</p>
    <form onSubmit={(event) => { void submit(event) }} aria-busy={busy}>
      <label>Your administrator password<input className="input" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={busy} /></label>
      <ShellButton type="submit" className="btn" disabled={busy}>{busy ? 'Creating code…' : 'Create recovery code'}</ShellButton>
      {error && <p className="admin-error" role="alert">{error}</p>}
    </form>
    {token && <div role="status"><label>One-use recovery code<input className="input" readOnly value={token} onFocus={(event) => event.currentTarget.select()} /></label><p>Expires {new Date(expiresAt).toLocaleString()}. This code is only shown here and is not added to a link.</p><ShellButton className="btn" onClick={() => setToken('')}>Hide code</ShellButton></div>}
  </details>
}
