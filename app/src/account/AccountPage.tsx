// /account — the reader's profile in the landing-page style: photo and details, centre and machines, plan, usage by
// day / month / year (model reads = credits, new studies, storage) and a way into report letterhead templates.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Building2, Camera, FileText, Gauge, HardDrive, Plus, ScanLine, Trash2, Upload } from 'lucide-react'
import { logout, useSession } from '../lib/session'
import { ThemeSwitch } from '../components/shell/ThemeSwitch'
import { UserAvatar, refreshUserAvatar } from '../components/shell/UserAvatar'
import { Roll } from '../landing/ui'
import '../landing/skanda-landing.css'
import './account.css'

type Machine = { modality: string; manufacturer: string; model: string; year?: string }
interface Profile {
  email: string; role: 'admin' | 'clinician'; fullName: string; organization: string; jobRole: string
  centerName: string; centerLocation: string; phone: string; equipment: Machine[]; avatar: string | null; centerLogo: string | null
  memberSince: string; lastSignIn: string | null
}
interface Bucket { start: string; reads: number; studies: number }
interface Usage { daily: Bucket[]; monthly: Bucket[]; yearly: Bucket[]; totals: { reads: number; studies: number; readsToday: number; readsThisMonth: number }; byModality: { modality: string; n: number }[] }
interface Storage { usedBytes?: number; quotaBytes?: number; used?: number; quota?: number; [k: string]: unknown }
interface AccountData { profile: Profile; usage: Usage; storage: Storage; plan: { name: string; price: string; readsPerDay: number } }

const MODALITIES = ['X-ray', 'CT', 'MRI', 'Ultrasound', 'Mammography', 'Fluoroscopy', 'Other']
const fmtBytes = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`
const storageOf = (s: Storage) => {
  const used = Number(s.usedBytes ?? s.used ?? (s as { totalBytes?: number }).totalBytes ?? 0)
  const quota = Number(s.quotaBytes ?? s.quota ?? (s as { limitBytes?: number }).limitBytes ?? 0)
  return { used: Number.isFinite(used) ? used : 0, quota: Number.isFinite(quota) ? quota : 0 }
}

/** Resize an uploaded image so it fits the server's 300 KB cap; WebP keeps logo transparency. */
async function shrinkImage(file: File, maxEdge: number): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  for (const q of [0.9, 0.8, 0.7, 0.6]) {
    const url = canvas.toDataURL('image/webp', q)
    if (url.length < 380 * 1024) return url
  }
  throw new Error('That image is too detailed to store. Try a smaller one.')
}

export function AccountPage() {
  const user = useSession((s) => s.user)
  const [data, setData] = useState<AccountData | null>(null)
  const [error, setError] = useState('')
  const [range, setRange] = useState<'daily' | 'monthly' | 'yearly'>('daily')
  useEffect(() => {
    document.title = 'Your profile · RadGenis'
    void fetch('/api/account/profile', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (r) => { if (!r.ok) throw new Error('Your profile could not be loaded. Refresh to try again.'); setData(await r.json()) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Your profile could not be loaded.'))
  }, [])
  const save = async (patch: Partial<Profile>) => {
    const r = await fetch('/api/account/profile', { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Could not save. Try again.')
    setData((d) => d && { ...d, profile: body.profile })
    if ('avatar' in patch) refreshUserAvatar()
    if (user && 'fullName' in patch) useSession.getState().setUser({ ...user, ...(body.profile.fullName ? { fullName: body.profile.fullName } : { fullName: undefined }) })
  }

  return <div className="sk-page acc">
    <header className="acc-top">
      <div className="sk-wrap acc-top-row">
        <a className="sk-brand acc-brand" href="/" aria-label="RadGenis home"><img src="/skanda-mark.png" alt="" /><span>RadGenis</span></a>
        <nav className="acc-top-end" aria-label="Account">
          <a className="sk-pill sk-pill-ghost sk-pill-sm" href="/workspace"><ArrowLeft size={15} aria-hidden="true" /><Roll>Workspace</Roll></a>
          <button type="button" className="sk-pill sk-pill-grey sk-pill-sm" onClick={() => { void logout().then(() => { window.location.href = '/' }) }}><Roll>Sign out</Roll></button>
          <ThemeSwitch compact />
          <UserAvatar size={36} />
        </nav>
      </div>
    </header>
    <main className="sk-wrap acc-main" id="main">
      {error && <p className="acc-alert" role="alert">{error}</p>}
      {!data && !error && <p className="acc-loading" role="status">Loading your profile…</p>}
      {data && <>
        <Identity profile={data.profile} onSave={save} />
        <section className="acc-grid-2" aria-label="Plan and allowance">
          <PlanCard data={data} />
          <AllowanceCard data={data} />
        </section>
        <UsageSection usage={data.usage} range={range} setRange={setRange} readsPerDay={data.plan.readsPerDay} />
        <CenterSection profile={data.profile} onSave={save} />
        <LetterheadSection />
      </>}
    </main>
    <footer className="sk-wrap acc-foot"><p>Research and review-support software, not a medical device. Findings are drafts for clinician review.</p></footer>
  </div>
}

function Card({ className = '', children, label }: { className?: string; children: ReactNode; label?: string }) {
  return <section className={`acc-card ${className}`} aria-label={label}>{children}</section>
}

function Identity({ profile, onSave }: { profile: Profile; onSave: (p: Partial<Profile>) => Promise<void> }) {
  const [form, setForm] = useState({ fullName: profile.fullName, jobRole: profile.jobRole, organization: profile.organization, phone: profile.phone })
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const dirty = Object.entries(form).some(([k, v]) => v !== profile[k as keyof Profile])
  const submit = async () => {
    setBusy(true); setStatus('')
    try { await onSave(form); setStatus('Saved.') } catch (e) { setStatus(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) }
  }
  const photo = async (f: File | undefined) => {
    if (!f) return
    try { await onSave({ avatar: await shrinkImage(f, 384) }); setStatus('Photo updated.') } catch (e) { setStatus(e instanceof Error ? e.message : 'Photo could not be saved.') }
  }
  const initials = (profile.fullName || profile.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')
  return <section className="acc-hero" aria-labelledby="acc-title">
    <div className="acc-avatar-wrap">
      {profile.avatar ? <img className="acc-avatar" src={profile.avatar} alt="Your profile photo" /> : <span className="acc-avatar acc-avatar--empty" aria-hidden="true">{initials || '?'}</span>}
      <button type="button" className="acc-avatar-btn" onClick={() => file.current?.click()} aria-label="Change profile photo"><Camera size={16} aria-hidden="true" /></button>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { void photo(e.target.files?.[0]); e.target.value = '' }} />
    </div>
    <div className="acc-hero-text">
      <p className="sk-eyebrow">Your profile</p>
      <h1 id="acc-title" className="sk-h2 acc-name">{profile.fullName || <em>Add your name</em>}</h1>
      <p className="acc-sub">{[profile.jobRole, profile.organization].filter(Boolean).join(' · ') || 'Add your role and organization'}{' · '}{profile.email}</p>
      <p className="acc-meta"><span className="acc-badge">{profile.role === 'admin' ? 'Administrator' : 'Clinician'}</span>Member since {new Date(profile.memberSince).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}{profile.avatar && <button type="button" className="acc-link" onClick={() => { void onSave({ avatar: null }) }}>Remove photo</button>}</p>
    </div>
    <Card className="acc-hero-form" label="Your details">
      <div className="acc-fields">
        <Field label="Full name" hint="Printed on reports you sign"><input value={form.fullName} maxLength={120} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Dr A Rao" /></Field>
        <Field label="Role"><input value={form.jobRole} maxLength={80} onChange={(e) => setForm({ ...form, jobRole: e.target.value })} placeholder="Consultant radiologist" /></Field>
        <Field label="Organization"><input value={form.organization} maxLength={160} onChange={(e) => setForm({ ...form, organization: e.target.value })} placeholder="City Diagnostics" /></Field>
        <Field label="Phone"><input value={form.phone} maxLength={40} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 …" inputMode="tel" /></Field>
      </div>
      <div className="acc-actions"><button type="button" className="sk-pill sk-pill-light" disabled={!dirty || busy} onClick={() => { void submit() }}><Roll>{busy ? 'Saving…' : 'Save details'}</Roll></button><span role="status" className="acc-status">{status}</span></div>
    </Card>
  </section>
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="acc-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

function PlanCard({ data }: { data: AccountData }) {
  const { quota } = storageOf(data.storage)
  return <Card className="acc-plan" label="Your plan">
    <p className="sk-plan-label">Plan</p>
    <h2 className="acc-card-title">{data.plan.name}</h2>
    <p className="acc-muted">{data.plan.price}</p>
    <ul className="acc-plan-list">
      <li><ScanLine size={16} aria-hidden="true" /><span><b>{data.plan.readsPerDay || '—'}</b> Skanda V1 reads per day</span></li>
      <li><HardDrive size={16} aria-hidden="true" /><span><b>{quota ? fmtBytes(quota) : '10 GB'}</b> account storage</span></li>
      <li><FileText size={16} aria-hidden="true" /><span>Reports, templates, export and patient history</span></li>
    </ul>
    <a className="sk-pill sk-pill-ghost sk-pill-sm" href="/#pricing"><Roll>Compare plans</Roll></a>
  </Card>
}

function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return <div className="acc-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}><span style={{ width: `${pct}%` }} data-high={pct >= 85 || undefined} /></div>
}

function AllowanceCard({ data }: { data: AccountData }) {
  const { used, quota } = storageOf(data.storage)
  const t = data.usage.totals
  return <Card className="acc-allowance" label="Today and storage">
    <div className="acc-stat">
      <p className="sk-plan-label"><Gauge size={14} aria-hidden="true" /> Credits today</p>
      <p className="acc-stat-num">{t.readsToday}<small> / {data.plan.readsPerDay || '—'} reads</small></p>
      <Meter value={t.readsToday} max={data.plan.readsPerDay} label="Model reads used today" />
      <p className="acc-muted">Resets at 05:30 IST (00:00 UTC). {t.readsThisMonth} reads this month.</p>
    </div>
    <div className="acc-stat">
      <p className="sk-plan-label"><HardDrive size={14} aria-hidden="true" /> Storage</p>
      <p className="acc-stat-num">{fmtBytes(used)}<small> of {quota ? fmtBytes(quota) : '—'}</small></p>
      <Meter value={used} max={quota} label="Account storage used" />
      <p className="acc-muted">Saved scans, patient details, reports and analysis.</p>
    </div>
  </Card>
}

const RANGE_LABEL = { daily: 'Last 30 days', monthly: 'Last 12 months', yearly: 'Last 5 years' } as const
function bucketLabel(start: string, range: 'daily' | 'monthly' | 'yearly', long = false) {
  const d = new Date(`${start}T00:00:00Z`)
  if (range === 'yearly') return String(d.getUTCFullYear())
  if (range === 'monthly') return d.toLocaleDateString(undefined, { month: long ? 'long' : 'short', year: long ? 'numeric' : undefined, timeZone: 'UTC' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function UsageSection({ usage, range, setRange, readsPerDay }: { usage: Usage; range: 'daily' | 'monthly' | 'yearly'; setRange: (r: 'daily' | 'monthly' | 'yearly') => void; readsPerDay: number }) {
  const buckets = usage[range]
  const sum = (k: 'reads' | 'studies') => buckets.reduce((n, b) => n + b[k], 0)
  return <section className="acc-usage" aria-labelledby="acc-usage-title">
    <div className="acc-section-head">
      <div><p className="sk-eyebrow">Usage</p><h2 id="acc-usage-title" className="sk-h2 acc-h2">Your <em>activity</em></h2></div>
      <div className="acc-seg" role="group" aria-label="Time range">{(['daily', 'monthly', 'yearly'] as const).map((r) => <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>{r === 'daily' ? 'Daily' : r === 'monthly' ? 'Monthly' : 'Yearly'}</button>)}</div>
    </div>
    <div className="acc-tiles">
      <Tile label={`Reads · ${RANGE_LABEL[range].toLowerCase()}`} value={sum('reads')} />
      <Tile label={`New studies · ${RANGE_LABEL[range].toLowerCase()}`} value={sum('studies')} />
      <Tile label="Reads, all time" value={usage.totals.reads} />
      <Tile label="Studies, all time" value={usage.totals.studies} />
    </div>
    <div className="acc-grid-2">
      <BarChart title="Model reads (credits)" subtitle={`${RANGE_LABEL[range]} · UTC`} buckets={buckets} k="reads" range={range} cap={range === 'daily' ? readsPerDay : 0} unit="reads" />
      <BarChart title="New studies saved" subtitle={`${RANGE_LABEL[range]} · UTC`} buckets={buckets} k="studies" range={range} unit="studies" />
    </div>
    {usage.byModality.length > 0 && <Card className="acc-modality" label="Activity by modality">
      <p className="sk-plan-label">By modality · all time</p>
      <ul>{usage.byModality.map((m) => { const max = usage.byModality[0].n || 1; return <li key={m.modality}><span>{m.modality}</span><span className="acc-hbar"><span style={{ width: `${(m.n / max) * 100}%` }} /></span><b>{m.n}</b></li> })}</ul>
    </Card>}
  </section>
}

function Tile({ label, value }: { label: string; value: number }) {
  return <div className="acc-tile"><p>{label}</p><b>{value.toLocaleString()}</b></div>
}

/** Single-series bars (one hue, rounded data ends, 2px gaps), hover tooltip, optional daily-allowance rule, table view. */
function BarChart({ title, subtitle, buckets, k, range, cap = 0, unit }: { title: string; subtitle: string; buckets: Bucket[]; k: 'reads' | 'studies'; range: 'daily' | 'monthly' | 'yearly'; cap?: number; unit: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  // Draw at the card's real width so axis text stays at its intended size on phones (no scaled-down SVG text).
  const plotRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  useEffect(() => {
    const el = plotRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [table])
  const values = buckets.map((b) => b[k])
  const max = Math.max(1, cap, ...values)
  const nice = useMemo(() => { const step = Math.pow(10, Math.floor(Math.log10(max))); const m = Math.ceil(max / step) * step; return m < max ? max : m }, [max])
  const W = width, H = width < 420 ? 200 : 220, padL = 32, padB = 22, padT = 10
  const plotW = W - padL - 4, plotH = H - padB - padT
  const slot = plotW / Math.max(1, buckets.length), barW = Math.max(3, slot - 2)
  const y = (v: number) => padT + plotH - (v / nice) * plotH
  const every = Math.max(1, Math.ceil(buckets.length / Math.max(3, Math.floor(W / 70))))
  const total = values.reduce((a, b) => a + b, 0)
  const h = hover !== null ? buckets[hover] : null
  return <Card className="acc-chart" label={title}>
    <div className="acc-chart-head">
      <div><h3>{title}</h3><p className="acc-muted">{subtitle}</p></div>
      <button type="button" className="acc-link" aria-pressed={table} onClick={() => setTable(!table)}>{table ? 'Show chart' : 'Show table'}</button>
    </div>
    {table ? <table className="acc-table"><thead><tr><th scope="col">{range === 'daily' ? 'Day' : range === 'monthly' ? 'Month' : 'Year'}</th><th scope="col">{unit[0].toUpperCase() + unit.slice(1)}</th></tr></thead>
      <tbody>{buckets.map((b) => <tr key={b.start}><td>{bucketLabel(b.start, range, true)}</td><td>{b[k]}</td></tr>)}</tbody></table>
    : total === 0 ? <div className="acc-chart-empty"><p>No {unit} in this period yet.</p></div>
    : <div className="acc-chart-plot" ref={plotRef} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}, ${subtitle}: ${total} ${unit} in total`}>
        {(nice % 2 === 0 ? [0, 0.5, 1] : [0, 1]).map((f) => <g key={f}><line x1={padL} x2={W - 4} y1={y(nice * f)} y2={y(nice * f)} className="acc-grid-line" /><text x={padL - 6} y={y(nice * f) + 4} className="acc-axis" textAnchor="end">{Math.round(nice * f)}</text></g>)}
        {cap > 0 && <g><line x1={padL} x2={W - 4} y1={y(cap)} y2={y(cap)} className="acc-cap" /><text x={W - 6} y={y(cap) - 5} className="acc-axis" textAnchor="end">daily allowance {cap}</text></g>}
        {buckets.map((b, i) => {
          const v = b[k], x = padL + i * slot + (slot - barW) / 2, top = y(v), height = Math.max(0, padT + plotH - top)
          const r = Math.min(4, barW / 2, height)
          return <g key={b.start}>
            {v > 0 && <path className="acc-bar" data-on={hover === i || undefined} d={`M${x},${padT + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${padT + plotH} Z`} />}
            <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1} />
            {i % every === 0 && <text x={x + barW / 2} y={H - 6} className="acc-axis" textAnchor="middle">{bucketLabel(b.start, range)}</text>}
          </g>
        })}
        <line x1={padL} x2={W - 4} y1={padT + plotH} y2={padT + plotH} className="acc-baseline" />
      </svg>
      {h && hover !== null && <div className="acc-tip" style={{ left: `${((padL + hover * slot + slot / 2) / W) * 100}%` }} role="status"><b>{h[k]}</b> {unit}<span>{bucketLabel(h.start, range, true)}</span></div>}
    </div>}
  </Card>
}

function CenterSection({ profile, onSave }: { profile: Profile; onSave: (p: Partial<Profile>) => Promise<void> }) {
  const [form, setForm] = useState({ centerName: profile.centerName, centerLocation: profile.centerLocation })
  const [machines, setMachines] = useState<Machine[]>(profile.equipment.length ? profile.equipment : [])
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const logo = useRef<HTMLInputElement>(null)
  const submit = async () => {
    setBusy(true); setStatus('')
    try { await onSave({ ...form, equipment: machines.filter((m) => m.manufacturer.trim() || m.model.trim()) }); setStatus('Saved.') }
    catch (e) { setStatus(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) }
  }
  const setMachine = (i: number, patch: Partial<Machine>) => setMachines((list) => list.map((m, j) => (j === i ? { ...m, ...patch } : m)))
  const uploadLogo = async (f: File | undefined) => {
    if (!f) return
    try { await onSave({ centerLogo: await shrinkImage(f, 640) }); setStatus('Logo updated.') } catch (e) { setStatus(e instanceof Error ? e.message : 'Logo could not be saved.') }
  }
  return <section className="acc-center" aria-labelledby="acc-center-title">
    <div className="acc-section-head"><div><p className="sk-eyebrow">Centre</p><h2 id="acc-center-title" className="sk-h2 acc-h2">Where you <em>read</em></h2></div></div>
    <div className="acc-grid-2">
      <Card label="Centre details">
        <div className="acc-logo-row">
          {profile.centerLogo ? <img className="acc-logo" src={profile.centerLogo} alt="Centre logo" /> : <span className="acc-logo acc-logo--empty" aria-hidden="true"><Building2 size={22} /></span>}
          <div>
            <button type="button" className="sk-pill sk-pill-ghost sk-pill-sm" onClick={() => logo.current?.click()}><Upload size={14} aria-hidden="true" /><Roll>{profile.centerLogo ? 'Replace logo' : 'Upload logo'}</Roll></button>
            {profile.centerLogo && <button type="button" className="acc-link" onClick={() => { void onSave({ centerLogo: null }) }}>Remove</button>}
            <p className="acc-muted">PNG, JPEG or WebP. Used on your report letterhead.</p>
          </div>
          <input ref={logo} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { void uploadLogo(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        <div className="acc-fields">
          <Field label="Centre name"><input value={form.centerName} maxLength={160} onChange={(e) => setForm({ ...form, centerName: e.target.value })} placeholder="City Diagnostic Centre" /></Field>
          <Field label="Location"><input value={form.centerLocation} maxLength={200} onChange={(e) => setForm({ ...form, centerLocation: e.target.value })} placeholder="Street, city, state" /></Field>
        </div>
      </Card>
      <Card label="Machines used">
        <p className="sk-plan-label">Machines</p>
        {machines.length === 0 && <p className="acc-muted">Add the scanners your centre reads from. It helps describe technique and compare results by machine.</p>}
        <ul className="acc-machines">{machines.map((m, i) => <li key={i}>
          <select aria-label={`Machine ${i + 1} modality`} value={m.modality} onChange={(e) => setMachine(i, { modality: e.target.value })}>{MODALITIES.map((x) => <option key={x}>{x}</option>)}</select>
          <input aria-label={`Machine ${i + 1} manufacturer`} value={m.manufacturer} maxLength={80} placeholder="Manufacturer" onChange={(e) => setMachine(i, { manufacturer: e.target.value })} />
          <input aria-label={`Machine ${i + 1} model`} value={m.model} maxLength={80} placeholder="Model" onChange={(e) => setMachine(i, { model: e.target.value })} />
          <input aria-label={`Machine ${i + 1} year`} value={m.year ?? ''} maxLength={4} placeholder="Year" inputMode="numeric" onChange={(e) => setMachine(i, { year: e.target.value.replace(/\D/g, '') })} />
          <button type="button" className="acc-icon-btn" aria-label={`Remove machine ${i + 1}`} onClick={() => setMachines((list) => list.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
        </li>)}</ul>
        {machines.length < 20 && <button type="button" className="acc-link acc-add" onClick={() => setMachines((list) => [...list, { modality: 'CT', manufacturer: '', model: '' }])}><Plus size={14} aria-hidden="true" /> Add machine</button>}
      </Card>
    </div>
    <div className="acc-actions"><button type="button" className="sk-pill sk-pill-light" disabled={busy} onClick={() => { void submit() }}><Roll>{busy ? 'Saving…' : 'Save centre'}</Roll></button><span role="status" className="acc-status">{status}</span></div>
  </section>
}

function LetterheadSection() {
  return <Card className="acc-letterhead" label="Report letterhead">
    <div><p className="sk-plan-label">Report letterhead</p><h2 className="acc-card-title">Your reports, on your <em>letterhead</em></h2>
      <p className="acc-muted">Upload your logo or a blank page of your existing report, set header lines, signatory and footer. Reports print and export on it.</p></div>
    <a className="sk-pill sk-pill-light" href="/workspace#templates"><FileText size={15} aria-hidden="true" /><Roll>Manage report templates</Roll></a>
  </Card>
}
