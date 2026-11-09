import { ShellButton } from './ShellButton'
import { AdminRecovery } from './AccountSecurity'
import { useEffect, useState, type FormEvent } from 'react'
import { useSession } from '../../lib/session'

interface AdminUser { id: string; email: string; role: 'admin' | 'clinician'; createdAt: string; lastSeenAt: string | null; disabled?: boolean }
const PAGE_SIZE = 25
export function AdminUsers() {
  const currentUser = useSession((state) => state.user)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'clinician'>('clinician')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [manage, setManage] = useState<AdminUser | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [manageError, setManageError] = useState('')
  const refreshUsers = () => { setLoading(true); setError(''); setAttempt((value) => value + 1) }
  const showPage = (next: number) => { setLoading(true); setError(''); setOffset(next) }
  const changeUser = async (patch: { disabled: boolean } | { password: string }) => {
    if (!manage || saving) return
    setSaving(true); setManageError('')
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(manage.id)}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      if (!response.ok) throw new Error(response.status === 403 ? 'This account change is not permitted.' : 'The account could not be updated. Please try again.')
      setManage(null); setResetPassword(''); refreshUsers()
    } catch (reason) { setManageError(reason instanceof Error ? reason.message : 'The account could not be updated.') }
    finally { setSaving(false) }
  }
  useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/admin/users?limit=${PAGE_SIZE}&offset=${offset}`, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(response.status === 403 ? 'An administrator account is required.' : 'Accounts could not be loaded. Try again.')
      const data = await response.json()
      if (!Array.isArray(data.users) || !Number.isSafeInteger(data.total) || data.total < 0 || !data.users.every((user: AdminUser) => typeof user.id === 'string' && typeof user.email === 'string' && ['admin', 'clinician'].includes(user.role))) throw new Error('The server returned an invalid account list.')
      if (!controller.signal.aborted) { setUsers(data.users); setTotal(data.total) }
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Accounts could not be loaded.') }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [offset, attempt])
  const createUser = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    setSaving(true); setMessage('')
    try {
      const response = await fetch('/api/admin/users', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password, role }) })
      if (!response.ok) throw new Error(response.status === 409 ? 'An account with this email already exists.' : response.status === 403 ? 'An administrator account is required.' : 'Account could not be created. Check the fields and try again.')
      setEmail(''); setPassword(''); setRole('clinician'); setMessage('Account created. Give the credentials to the intended user through your approved secure channel.'); setOffset(0); refreshUsers()
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Account could not be created.') }
    finally { setSaving(false) }
  }
  return <section className="admin-users" aria-labelledby="admin-users-heading">
    <h3 className="admin-heading" id="admin-users-heading">User accounts</h3>
    <p className="admin-note">Manage access to this server. Administrators can view organization activity and create accounts.</p>
    {error && <div><p className="admin-error" role="alert">{error}</p><ShellButton className="btn" onClick={refreshUsers}>Retry accounts</ShellButton></div>}
    {loading ? <p role="status" className="admin-note">Loading accounts...</p> : !error && <>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Last sign-in</th><th scope="col">Access</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td>{user.email}{user.id === currentUser?.id && <small> (you)</small>}</td><td>{user.role === 'admin' ? 'Administrator' : 'Clinician'}</td><td>{user.lastSeenAt && Number.isFinite(Date.parse(user.lastSeenAt)) ? new Date(user.lastSeenAt).toLocaleDateString() : 'Never'}</td><td><ShellButton className="btn" disabled={saving} onClick={() => { setManage(user); setResetPassword(''); setManageError('') }}>{user.disabled ? 'Disabled' : 'Manage'}</ShellButton></td></tr>)}</tbody></table></div>
      <div className="admin-pagination"><span>{total ? `${offset + 1}-${Math.min(offset + users.length, total)} of ${total}` : 'No accounts'}</span><ShellButton className="btn" disabled={offset === 0} onClick={() => showPage(Math.max(0, offset - PAGE_SIZE))}>Previous</ShellButton><ShellButton className="btn" disabled={offset + PAGE_SIZE >= total} onClick={() => showPage(offset + PAGE_SIZE)}>Next</ShellButton></div>
    </>}
    {manage && <section className="admin-create"><h3 className="admin-heading">Manage {manage.email}</h3><p className="admin-note">Disabling an account or resetting its password ends its active sessions.</p>
      <ShellButton className="btn" disabled={saving || manage.id === currentUser?.id} onClick={() => { void changeUser({ disabled: !manage.disabled }) }}>{manage.disabled ? 'Enable account' : 'Disable account'}</ShellButton>
      {manage.id === currentUser?.id && <p className="admin-note">You cannot disable your own account.</p>}
      <form onSubmit={(event) => { event.preventDefault(); void changeUser({ password: resetPassword }) }}><label>New password<input type="password" autoComplete="new-password" minLength={12} required value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} disabled={saving} /></label><ShellButton className="btn" disabled={saving} type="submit">Reset password</ShellButton></form>
      {manageError && <p role="alert" className="admin-error">{manageError}</p>}
      {!manage.disabled && <AdminRecovery key={manage.id} userId={manage.id} />}
      <ShellButton className="btn" disabled={saving} onClick={() => { setManage(null); setResetPassword('') }}>Close account controls</ShellButton>
    </section>}
    <details className="admin-create"><summary>Create an account</summary><form onSubmit={(event) => { void createUser(event) }}>
      <label>Email address<input type="email" autoComplete="off" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={saving} /></label>
      <label>Initial password<input type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} disabled={saving} /><small>At least 12 characters. No email is sent automatically.</small></label>
      <label>Role<select value={role} onChange={(event) => setRole(event.target.value as 'admin' | 'clinician')} disabled={saving}><option value="clinician">Clinician</option><option value="admin">Administrator</option></select></label>
      {role === 'admin' && <p className="admin-note">This account will be able to create users and view organization analytics.</p>}
      <ShellButton type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating account...' : 'Create account'}</ShellButton>
      {message && <p role="status" className="admin-note">{message}</p>}
    </form></details>
  </section>
}
