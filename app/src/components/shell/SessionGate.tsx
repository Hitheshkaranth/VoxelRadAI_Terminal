import { ShellButton } from './ShellButton'
import { RecoveryForm } from './AccountSecurity'
import { OrganizationSignIn } from './OrganizationSignIn'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, Eye, EyeOff, RotateCw } from 'lucide-react'
import { Roll } from '../../landing/ui'
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
  if (SERVER_MODE && state === 'ready' && !currentUser) return <SessionLayout><section className="session-card" aria-labelledby="session-title"><h1 id="session-title">Session <em>ended</em></h1><p className="session-intro">Reload to sign in and open your workspace.</p><ShellButton className="btn btn-primary session-submit" onClick={() => window.location.reload()}><Roll>Reload workspace</Roll><ArrowRight aria-hidden="true" /></ShellButton></section></SessionLayout>
  if (state === 'ready') return children
  const heading = state === 'checking' ? <>Opening your <em>workspace</em></> : state === 'error' ? <>Workspace <em>unavailable</em></> : recovering ? <>Recover your <em>account</em></> : <>Back to the <em>reading room</em></>
  const intro = state === 'checking' ? 'One moment while we confirm your sign-in.' : state === 'error' ? 'We could not confirm your session.' : recovering ? 'Set a new password with an administrator-issued code.' : 'Sign in to review your studies and continue your work.'
  return <SessionLayout><section className="session-card" aria-labelledby="session-title" aria-busy={state === 'checking'}>
    <h1 id="session-title">{heading}</h1>
    <p className="session-intro">{intro}</p>
    {state === 'checking' ? <p role="status" className="session-status"><span className="session-spinner" aria-hidden="true" />Checking your session…</p> : state === 'error' ? <><p role="alert" className="session-error">{error}</p><ShellButton className="btn btn-primary session-submit" onClick={() => { setState('checking'); setError(''); setAttempt((value) => value + 1) }}><Roll>Try again</Roll><RotateCw aria-hidden="true" /></ShellButton></> : recovering ? <RecoveryForm onBack={() => setRecovering(false)} /> : <LoginForm onSuccess={async (user) => { const previous = useSession.getState().user; if (previous && previous.id !== user.id) { window.location.reload(); return }; await configure.current(user); useSession.getState().setUser(user); setState('ready') }} />}
    {state === 'login' && !recovering && <><OrganizationSignIn /><details className="session-help"><summary>Need access or help signing in?<ChevronDown aria-hidden="true" /></summary><div className="session-help-body"><p>No account yet? <a href="/#access">Request access</a> and we will reply by email, or <a href="/demo">try the demo workspace</a> without one. If your organization already uses RadGenis, ask its administrator for an account or a recovery code, and sign in with the email address they registered for you.</p><ShellButton className="btn session-secondary" onClick={() => setRecovering(true)}>Use a recovery code</ShellButton></div></details></>}
  </section></SessionLayout>
}

function SessionLayout({ children }: { children: ReactNode }) {
  return <div className="session-page">
    <div className="session-glow" aria-hidden="true" />
    <header className="session-top">
      <a className="session-brand" href="/" aria-label="RadGenis home"><img src="/radgenis-mark.png" alt="" width="24" height="24" /><span>RadGenis</span></a>
      <nav className="session-top-end" aria-label="Site">
        <a className="session-pill session-pill-ghost" href="/"><ArrowLeft aria-hidden="true" /><Roll>Home</Roll></a>
        <a className="session-pill session-pill-light session-top-access" href="/#access"><Roll>Request access</Roll></a>
        <ThemeSwitch compact />
      </nav>
    </header>
    <main className="session-main" id="session-access" tabIndex={-1}>
      <div className="session-access">{children}</div>
      <aside className="session-visual" aria-label="CT teaching sample"><LoginCine /></aside>
    </main>
    <footer className="session-foot">
      <p>Research and review-support software, not a medical device. Findings are drafts for clinician review.</p>
      <p><a href="/demo">Demo</a><a href="/docs">Docs</a><span>radgenis.com</span></p>
    </footer>
  </div>
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
    <div className="session-field"><label htmlFor="session-email">Work email</label><input id="session-email" name="email" type="email" autoComplete="username" inputMode="email" placeholder="you@hospital.org" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} /></div>
    <div className="session-field"><label htmlFor="session-password">Password</label><div className="session-password"><input id="session-password" name="password" type={visible ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} /><ShellButton type="button" aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} onClick={() => setVisible((value) => !value)}>{visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</ShellButton></div></div>
    {error && <p role="alert" className="session-error">{error}</p>}
    <ShellButton className="btn btn-primary session-submit" type="submit" disabled={busy}><Roll>{busy ? 'Signing in…' : 'Open workspace'}</Roll>{busy ? <span className="session-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}</ShellButton>
  </form>
}
