// Self-service sign-up on the sign-in page: email + password (confirmed by an emailed link) or Google. New accounts
// wait for an administrator's approval; the server sends the emails and enforces both gates.
import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, MailCheck } from 'lucide-react'
import { ShellButton } from './ShellButton'
import { BrandIcon } from '../BrandIcon'
import { Roll } from '../../landing/ui'

export interface SignupConfig { password: boolean; google: boolean }

/** What the server allows; both off until loaded so nothing flashes. */
export function useSignupConfig(): SignupConfig {
  const [config, setConfig] = useState<SignupConfig>({ password: false, google: false })
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/signup/config', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return
        const data = await response.json()
        if (!controller.signal.aborted) setConfig({ password: data?.password === true, google: data?.google === true })
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])
  return config
}

const NOTICES: Record<string, { tone: 'ok' | 'error'; text: string }> = {
  pending: { tone: 'ok', text: 'Thanks for signing up. An administrator will review your account, and we will email you as soon as it is approved.' },
  verified: { tone: 'ok', text: 'Email confirmed. An administrator will review your account, and we will email you as soon as it is approved.' },
  exists: { tone: 'error', text: 'An account with this Google email already exists. Sign in with your email and password instead.' },
  unavailable: { tone: 'error', text: 'This account is disabled. Contact your administrator.' },
  'google-cancelled': { tone: 'error', text: 'Google sign-in was cancelled.' },
  'google-error': { tone: 'error', text: 'Google sign-in could not be completed. Try again.' },
  'google-off': { tone: 'error', text: 'Google sign-in is not available yet. Use your email and password.' },
  busy: { tone: 'error', text: 'Sign-in is busy. Try again in a few minutes.' },
}

/**
 * Reads ?signup=… (after Google) and #verify=… (the emailed confirmation link), confirms the email if needed, and
 * strips both from the address bar so a reload or shared URL never repeats them.
 */
export function useSignupNotice(): { tone: 'ok' | 'error'; text: string } | null {
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  useEffect(() => {
    const url = new URL(window.location.href)
    const status = url.searchParams.get('signup')
    const token = new URLSearchParams(url.hash.slice(1)).get('verify')
    if (!status && !token) return
    url.searchParams.delete('signup'); url.searchParams.delete('mode'); url.hash = ''
    window.history.replaceState(null, '', url.pathname + url.search)
    if (status && NOTICES[status]) setNotice(NOTICES[status])
    if (!token) return
    setNotice({ tone: 'ok', text: 'Confirming your email…' })
    void fetch('/api/signup/verify', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'This confirmation link could not be used.')
        setNotice(data.approval === 'approved' ? { tone: 'ok', text: 'Email confirmed. You can sign in now.' } : NOTICES.verified)
      })
      .catch((reason: unknown) => setNotice({ tone: 'error', text: reason instanceof Error ? reason.message : 'This confirmation link could not be used.' }))
  }, [])
  return notice
}

/** Full-page navigation: Google's consent screen cannot run inside fetch. */
export function GoogleButton({ label }: { label: string }) {
  return <a className="btn session-secondary session-google" href="/api/auth/google/start"><BrandIcon name="google" size={16} /><span>{label}</span></a>
}

export function SignupForm({ onSignIn }: { onSignIn: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', organization: '', role: '', password: '', website: '' })
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState('')
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/signup', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, email: form.email.trim() }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Sign-up could not be completed. Try again.')
      setSentTo(form.email.trim()); setForm((current) => ({ ...current, password: '' }))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Sign-up could not be completed. Try again.') }
    finally { setBusy(false) }
  }
  if (sentTo) return <div className="session-form" role="status">
    <p className="session-sent"><MailCheck aria-hidden="true" /><span>We sent a confirmation link to <b>{sentTo}</b>. Open it within 24 hours to confirm your email. An administrator then reviews the account, and we email you when it is approved.</span></p>
    <p>No email after a few minutes? Check spam, or sign up again with the same address to get a new link.</p>
    <ShellButton className="btn session-secondary" onClick={onSignIn}>Back to sign in</ShellButton>
  </div>
  return <form className="session-form" aria-busy={busy} onSubmit={(event) => { void submit(event) }}>
    <div className="session-field"><label htmlFor="signup-name">Full name</label><input id="signup-name" autoComplete="name" required maxLength={120} value={form.name} onChange={set('name')} disabled={busy} /></div>
    <div className="session-field"><label htmlFor="signup-email">Work email</label><input id="signup-email" type="email" autoComplete="email" inputMode="email" placeholder="you@hospital.org" required value={form.email} onChange={set('email')} disabled={busy} /></div>
    <div className="session-field"><label htmlFor="signup-org">Organization</label><input id="signup-org" autoComplete="organization" required maxLength={160} value={form.organization} onChange={set('organization')} disabled={busy} /></div>
    <div className="session-field"><label htmlFor="signup-role">Role <span className="session-optional">(optional)</span></label><input id="signup-role" autoComplete="organization-title" placeholder="Radiologist, resident, researcher…" maxLength={80} value={form.role} onChange={set('role')} disabled={busy} /></div>
    <div className="session-field"><label htmlFor="signup-password">Password</label><div className="session-password"><input id="signup-password" type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={12} required value={form.password} onChange={set('password')} disabled={busy} aria-describedby="signup-password-hint" /><ShellButton type="button" aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} onClick={() => setVisible((value) => !value)}>{visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</ShellButton></div><small id="signup-password-hint" className="session-hint">At least 12 characters.</small></div>
    {/* Honeypot: hidden from people and assistive tech; bots that fill it are ignored. */}
    <div className="session-hp" aria-hidden="true"><label htmlFor="signup-website">Website</label><input id="signup-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></div>
    {error && <p role="alert" className="session-error">{error}</p>}
    <ShellButton className="btn btn-primary session-submit" type="submit" disabled={busy}><Roll>{busy ? 'Creating account…' : 'Create account'}</Roll>{busy ? <span className="session-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}</ShellButton>
    <p className="session-fine">New accounts are reviewed by an administrator before they can open the workspace. RadGenis is research and review-support software, not a medical device.</p>
  </form>
}
