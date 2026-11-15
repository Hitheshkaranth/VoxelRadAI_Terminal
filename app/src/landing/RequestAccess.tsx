import { useState, type FormEvent } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { track } from '@vercel/analytics'
import { Reveal } from './ui'

const roles = ['Radiologist', 'Radiology resident', 'Radiographer', 'Researcher', 'ML engineer', 'Other']
type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'done' } | { kind: 'error'; message: string }

/** Public request form for a hosted workspace account. Requests land in the admin panel for review. */
export function RequestAccess() {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const data = Object.fromEntries(['name', 'email', 'organization', 'role', 'useCase', 'website'].map((key) => [key, String(form.get(key) ?? '')]))
    setState({ kind: 'sending' })
    try {
      const response = await fetch('/api/access-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      if (response.ok) { setState({ kind: 'done' }); track('access_request', { role: data.role || 'unspecified' }); return }
      const body = await response.json().catch(() => ({})) as { error?: string }
      setState({ kind: 'error', message: body.error ?? 'Your request could not be sent. Try again in a moment.' })
    } catch {
      setState({ kind: 'error', message: 'Your request could not be sent. Check your connection and try again.' })
    }
  }
  return <section className="sk-access" id="access" aria-labelledby="access-title">
    <Reveal className="sk-wrap sk-access-grid">
      <div className="sk-access-copy">
        <p className="sk-eyebrow">Hosted workspace · invite only</p>
        <h2 id="access-title" className="sk-h2">Request <em>access</em></h2>
        <p>The hosted workspace runs Skanda V1 and is opened to people one at a time while it is evaluated. Tell us who you are and what you would read; every request is reviewed by hand and answered by email.</p>
        <ul className="sk-access-points">
          <li><Check size={15} /><span>Research and evaluation use only. Please don’t upload identifiable patient data.</span></li>
          <li><Check size={15} /><span>Prefer to self-host? <a className="sk-inline-link" href="#weights">Skanda-0 is open source</a>.</span></li>
          <li><Check size={15} /><span>Your details are used only to answer this request. See <a className="sk-inline-link" href="/privacy">privacy</a>.</span></li>
        </ul>
      </div>
      {state.kind === 'done'
        ? <div className="sk-access-card sk-access-done" role="status"><span className="sk-access-tick"><Check size={28} /></span><h3>Request received</h3><p>Thanks. We will reply to the email address you gave. While you wait, you can <a className="sk-inline-link" href="#demo">watch a read</a> or <a className="sk-inline-link" href="#weights">download Skanda-0</a>.</p></div>
        : <form className="sk-access-card" onSubmit={submit} noValidate={false}>
          <div className="sk-form-row">
            <label className="sk-form-field"><span>Name</span><input name="name" required maxLength={120} autoComplete="name" /></label>
            <label className="sk-form-field"><span>Work email</span><input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
          </div>
          <div className="sk-form-row">
            <label className="sk-form-field"><span>Organization</span><input name="organization" required maxLength={160} autoComplete="organization" /></label>
            <label className="sk-form-field"><span>Role</span><select name="role" defaultValue=""><option value="">Choose…</option>{roles.map((r) => <option key={r}>{r}</option>)}</select></label>
          </div>
          <label className="sk-form-field"><span>What would you use it for?</span><textarea name="useCase" required minLength={10} maxLength={1000} rows={4} placeholder="For example: comparing Skanda’s CT outlines with our residents’ reads on teaching cases." /></label>
          <label className="sk-hp" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
          <div aria-live="polite">{state.kind === 'error' && <p className="sk-access-error" role="alert">{state.message}</p>}</div>
          <button type="submit" className="sk-pill sk-pill-light sk-access-submit" disabled={state.kind === 'sending'}>{state.kind === 'sending' ? 'Sending…' : <>Send request <ArrowRight size={15} /></>}</button>
        </form>}
    </Reveal>
  </section>
}
