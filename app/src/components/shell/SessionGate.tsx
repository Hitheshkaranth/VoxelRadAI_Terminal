import { ShellButton } from './ShellButton'
import { RecoveryForm } from './AccountSecurity'
import { OrganizationSignIn } from './OrganizationSignIn'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { login, readSession, SERVER_MODE, useSession, type SessionUser } from '../../lib/session'
import './session.css'
import { ThemeSwitch } from './ThemeSwitch'
import { LoginCine } from './LoginCine'

/** Children mount only after authenticated storage is configured in server mode. */
export function SessionGate({ children, onAuthenticated }: { children: ReactNode; onAuthenticated: (user: SessionUser) => void | Promise<void> }) {
  const [state, setState] = useState<'checking' | 'login' | 'ready' | 'error'>(SERVER_MODE ? 'checking' : 'ready')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [recovering, setRecovering] = useState(false)
  const currentUser = useSession((session) => session.user)
  const configure = useRef(onAuthenticated)
  useLayoutEffect(() => { configure.current = onAuthenticated }, [onAuthenticated])
  useEffect(() => {
    if (!SERVER_MODE) return
    const controller = new AbortController()
    void readSession(controller.signal).then(async (user) => {
      if (controller.signal.aborted) return
      if (!user) { setState('login'); return }
      const previous = useSession.getState().user
      if (previous && previous.id !== user.id) { window.location.reload(); return }
      await configure.current(user)
      if (!controller.signal.aborted) { useSession.getState().setUser(user); setState('ready') }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : 'Unable to check your session.'); setState('error') }
    })
    return () => controller.abort()
  }, [attempt])
  useEffect(() => {
    if (!SERVER_MODE || state !== 'ready') return
    let checking = false
    const check = async () => {
      if (checking || document.visibilityState === 'hidden') return
      checking = true
      try {
        const user = await readSession()
        const active = useSession.getState().user
        // Reload discards old in-memory jobs and studies before any account change.
        if (!user || user.id !== active?.id || user.role !== active?.role) {
          useSession.getState().setUser(null)
          window.location.reload()
        }
      } catch {
        // Fail closed when session validity cannot be established.
        setError('Your session could not be verified. Reconnect and try again.'); setState('error')
      } finally { checking = false }
    }
    const interval = window.setInterval(() => { void check() }, 60_000)
    const onFocus = () => { void check() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [state])
  // Hide patient data immediately, even if an active-job beforeunload prompt delays reload.
  if (SERVER_MODE && state === 'ready' && !currentUser) return <SessionLayout><section className="session-card"><h1>Session ended</h1><p className="session-intro">Reload to sign in and open your workspace.</p><ShellButton className="btn btn-primary session-submit" onClick={() => window.location.reload()}>Reload workspace <ArrowRight aria-hidden="true" /></ShellButton></section></SessionLayout>
  if (state === 'ready') return children
  return <SessionLayout><section className="session-card" aria-labelledby="session-title">
    <h1 id="session-title">{state === 'checking' ? 'Opening your workspace.' : recovering ? 'Recover your account.' : 'Back to the\nreading room.'}</h1>
    <p className="session-intro">{recovering ? 'Set a new password with an administrator-issued code.' : 'Sign in to review your studies and continue your work.'}</p>
    {state === 'checking' ? <p role="status" className="session-status">Checking your session…</p> : state === 'error' ? <><p role="alert" className="session-error">{error}</p><ShellButton className="btn btn-primary" onClick={() => { setState('checking'); setError(''); setAttempt((value) => value + 1) }}>Try again</ShellButton></> : recovering ? <RecoveryForm onBack={() => setRecovering(false)} /> : <LoginForm onSuccess={async (user) => { const previous = useSession.getState().user; if (previous && previous.id !== user.id) { window.location.reload(); return }; await configure.current(user); useSession.getState().setUser(user); setState('ready') }} />}
    {state === 'login' && !recovering && <><OrganizationSignIn /><details className="session-help"><summary>Need access or help signing in?</summary><p>Contact your organization administrator to request an account or a recovery code. Use the email address they registered for you.</p><ShellButton className="btn" onClick={() => setRecovering(true)}>Use a recovery code</ShellButton></details></>}
  </section></SessionLayout>
}

function SessionLayout({ children }: { children: ReactNode }) {
  return <main className="session-page">
    <a className="session-skip" href="#session-access">Skip to sign in</a>
    <section className="session-visual" aria-label="VoxelRad AI imaging workspace introduction">
      <div className="session-brand"><img src="/skanda-mark.png" alt="" width="40" height="40" /><span>voxelrad<span className="session-brand-descriptor">AI</span></span></div>
      <LoginCine />
      <div className="session-visual-copy"><h2>A clearer view.<br />A focused read.</h2><p>One workspace for<br />X-ray, CT and MRI.</p></div>
    </section>
    <div className="session-access" id="session-access" tabIndex={-1}>
      <div className="session-access-top"><span>Your reading workspace</span><ThemeSwitch /></div>
      {children}
      <footer className="session-access-footer"><span>VoxelRad AI</span><span>voxelradai.com</span></footer>
    </div>
  </main>
}

function LoginForm({ onSuccess }: { onSuccess: (user: SessionUser) => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try { const user = await login(email, password); setPassword(''); await onSuccess(user) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Sign-in failed. Check your connection and try again.') }
    finally { setBusy(false) }
  }
  return <form className="session-form" aria-busy={busy} onSubmit={(event) => { void submit(event) }}>
    <label htmlFor="session-email">Work email</label><input id="session-email" name="email" type="email" autoComplete="username" inputMode="email" placeholder="you@hospital.org" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} />
    <label htmlFor="session-password">Password</label><div className="session-password"><input id="session-password" name="password" type={visible ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} /><ShellButton type="button" aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} onClick={() => setVisible((value) => !value)}>{visible ? <EyeOff /> : <Eye />}</ShellButton></div>
    {error && <p role="alert" className="session-error">{error}</p>}
    <ShellButton className="btn btn-primary session-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Open workspace'}<ArrowRight aria-hidden="true" /></ShellButton>
  </form>
}
