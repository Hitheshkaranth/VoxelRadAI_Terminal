// Patient register panel in Patient details (hosted site): find a patient by name, RadGenis ID, phone, ABHA or Aadhaar
// and link this study to them, or register them once and get a permanent RadGenis ID. Linked studies share the ID, so
// patient history follows the patient.
import { useEffect, useId, useRef, useState } from 'react'
import { BadgeCheck, Search, UserPlus } from 'lucide-react'
import { ShellButton } from './ShellButton'
import { toast } from './toastStore'
import {
  DuplicatePatientError, getRegistryPatient, linkPatient, registerPatient, searchPatients, studySexToRegistry, updateRegistryPatient,
  type RegistryInput, type RegistryPatient,
} from '../../lib/patientRegistry'
import type { PatientInfo } from '../../types'

const AADHAAR_NOTE = 'Aadhaar is only used to match the patient. RadGenis keeps a one-way code and the last 4 digits, never the number.'
const sexLabel = { M: 'M', F: 'F', O: 'Other', '': '' } as const

export function PatientRegistry({ patient, onLink }: { patient: PatientInfo; onLink: (patch: Partial<PatientInfo>) => void }) {
  const [linked, setLinked] = useState<RegistryPatient | null>(null)
  const [mode, setMode] = useState<'find' | 'register' | 'edit'>('find')
  useEffect(() => {
    if (!patient.registryId) { setLinked(null); return }
    if (linked?.id === patient.registryId) return
    let live = true
    getRegistryPatient(patient.registryId).then((p) => { if (live) setLinked(p) }).catch(() => { if (live) setLinked(null) })
    return () => { live = false }
  }, [patient.registryId, linked?.id])

  const use = (p: RegistryPatient) => { setLinked(p); onLink(linkPatient(patient, p)); setMode('find') }

  if (patient.registryId && mode !== 'register') {
    return <section className="pr" aria-label="Patient register">
      <div className="pr-linked">
        <BadgeCheck aria-hidden="true" />
        <div className="pr-linked-text">
          <span className="pr-label">RadGenis patient ID</span>
          <strong className="pr-mrn">{linked?.mrn ?? patient.patientId}</strong>
          {linked ? <span className="pr-ids">{[linked.abhaNumber && `ABHA ${linked.abhaNumber}`, linked.abhaAddress, linked.aadhaarMasked && `Aadhaar ${linked.aadhaarMasked}`].filter(Boolean).join(' · ') || 'No ABHA or Aadhaar on record'}</span> : null}
        </div>
        <div className="pr-actions">
          {linked && mode !== 'edit' ? <ShellButton type="button" className="btn btn-sm" onClick={() => setMode('edit')}>Add ABHA / Aadhaar</ShellButton> : null}
          <ShellButton type="button" className="btn btn-sm btn-plain" onClick={() => { onLink({ registryId: undefined }); setLinked(null); setMode('find') }}>Change patient</ShellButton>
        </div>
      </div>
      {mode === 'edit' && linked ? <IdentifierForm patient={linked} onDone={(p) => { if (p) setLinked(p); setMode('find') }} /> : null}
    </section>
  }
  if (mode === 'register') return <section className="pr" aria-label="Patient register"><RegisterForm patient={patient} onCancel={() => setMode('find')} onRegistered={use} /></section>
  return <section className="pr" aria-label="Patient register"><Finder onUse={use} onRegister={() => setMode('register')} /></section>
}

function Finder({ onUse, onRegister }: { onUse: (p: RegistryPatient) => void; onRegister: () => void }) {
  const id = useId()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<RegistryPatient[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const latest = useRef<AbortController | null>(null)
  useEffect(() => {
    const query = q.trim()
    const digits = query.replace(/[\s-]/g, '')
    // Wait for a whole Aadhaar (12) or ABHA (14) number rather than searching on every digit.
    if (/^\d+$/.test(digits) && digits.length > 10 && digits.length !== 12 && digits.length !== 14) { setResults(null); setError(''); return }
    const timer = setTimeout(() => {
      latest.current?.abort()
      const ctl = new AbortController(); latest.current = ctl
      setBusy(true); setError('')
      searchPatients(query, ctl.signal).then((r) => setResults(r.patients)).catch((e: unknown) => {
        if ((e as Error)?.name !== 'AbortError') { setResults(null); setError(e instanceof Error ? e.message : 'Search failed.') }
      }).finally(() => { if (latest.current === ctl) setBusy(false) })
    }, query ? 300 : 0)
    return () => clearTimeout(timer)
  }, [q])
  return <>
    <label className="field-label" htmlFor={id}>Find a registered patient</label>
    <div className="pr-search">
      <Search aria-hidden="true" />
      <input id={id} className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" spellCheck={false}
        placeholder="Name, RadGenis ID, phone, ABHA or Aadhaar" aria-describedby={`${id}-note`} />
    </div>
    <p id={`${id}-note`} className="pr-note">{AADHAAR_NOTE}</p>
    {error ? <p className="pr-error" role="alert">{error}</p> : null}
    {results && results.length > 0 ? <ul className="pr-results" aria-label={q.trim() ? 'Matching patients' : 'Recent patients'} aria-busy={busy}>
      {results.map((p) => <li key={p.id}>
        <div>
          <strong>{p.name || 'Unnamed'}</strong> <span className="pr-mrn-sm">{p.mrn}</span>
          <span className="pr-ids">{[sexLabel[p.sex], p.birthDate && `born ${p.birthDate}`, p.abhaNumber && `ABHA ${p.abhaNumber}`, p.aadhaarMasked, p.studyCount ? `${p.studyCount} ${p.studyCount === 1 ? 'study' : 'studies'}` : 'no saved studies'].filter(Boolean).join(' · ')}</span>
        </div>
        <ShellButton type="button" className="btn btn-sm btn-primary" onClick={() => onUse(p)} aria-label={`Use ${p.name || p.mrn} for this study`}>Use</ShellButton>
      </li>)}
    </ul> : null}
    {results && results.length === 0 && q.trim() ? <p className="pr-note" role="status">No registered patient matches. Register them below.</p> : null}
    <ShellButton type="button" className="btn btn-sm pr-register" onClick={onRegister}><UserPlus aria-hidden="true" /> Register as a new patient</ShellButton>
  </>
}

function IdFields({ value, set, aadhaarOnFile }: { value: RegistryInput & { aadhaar?: string | null }; set: (v: RegistryInput) => void; aadhaarOnFile?: string | null }) {
  const id = useId()
  return <div className="pr-grid">
    <label className="pr-field"><span className="field-label">ABHA number</span><input className="input" inputMode="numeric" autoComplete="off" placeholder="12-3456-7890-1234" value={value.abhaNumber ?? ''} onChange={(e) => set({ ...value, abhaNumber: e.target.value })} /></label>
    <label className="pr-field"><span className="field-label">ABHA address</span><input className="input" autoComplete="off" spellCheck={false} placeholder="name@abdm" value={value.abhaAddress ?? ''} onChange={(e) => set({ ...value, abhaAddress: e.target.value })} /></label>
    <label className="pr-field"><span className="field-label">Aadhaar{aadhaarOnFile ? ` (on file: ${aadhaarOnFile})` : ''}</span><input className="input" inputMode="numeric" autoComplete="off" placeholder={aadhaarOnFile ? 'Enter to replace' : '12 digits'} value={value.aadhaar ?? ''} aria-describedby={`${id}-a`} onChange={(e) => set({ ...value, aadhaar: e.target.value })} /></label>
    <p id={`${id}-a`} className="pr-note pr-span">{AADHAAR_NOTE}</p>
  </div>
}

/** Only send identifiers that were filled in; '' would clear them. */
const filled = (v: RegistryInput): RegistryInput => Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string' ? x.trim() !== '' : x !== undefined)) as RegistryInput

function RegisterForm({ patient, onCancel, onRegistered }: { patient: PatientInfo; onCancel: () => void; onRegistered: (p: RegistryPatient) => void }) {
  const [v, setV] = useState<RegistryInput>({ name: patient.name, sex: studySexToRegistry(patient.sex), birthDate: '', phone: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dup, setDup] = useState<RegistryPatient | null>(null)
  const submit = async () => {
    setBusy(true); setError(''); setDup(null)
    try { const p = await registerPatient(filled(v)); toast(`Registered ${p.name} as ${p.mrn}.`, 'success'); onRegistered(p) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not register.'); if (e instanceof DuplicatePatientError) setDup(e.patient) }
    finally { setBusy(false) }
  }
  return <form className="pr-form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
    <h3 className="pr-title">Register a new patient</h3>
    <div className="pr-grid">
      <label className="pr-field"><span className="field-label">Name</span><input className="input" required maxLength={120} value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
      <label className="pr-field"><span className="field-label">Sex</span><select className="input" value={v.sex ?? ''} onChange={(e) => setV({ ...v, sex: e.target.value as RegistryInput['sex'] })}><option value="">—</option><option value="F">Female</option><option value="M">Male</option><option value="O">Other</option></select></label>
      <label className="pr-field"><span className="field-label">Date of birth</span><input className="input" type="date" max={new Date().toISOString().slice(0, 10)} value={v.birthDate ?? ''} onChange={(e) => setV({ ...v, birthDate: e.target.value })} /></label>
      <label className="pr-field"><span className="field-label">Phone</span><input className="input" type="tel" autoComplete="off" maxLength={20} value={v.phone ?? ''} onChange={(e) => setV({ ...v, phone: e.target.value })} /></label>
    </div>
    <IdFields value={v} set={setV} />
    {error ? <p className="pr-error" role="alert">{error}</p> : null}
    {dup ? <ShellButton type="button" className="btn btn-sm btn-primary" onClick={() => onRegistered(dup)}>Use {dup.name || dup.mrn} ({dup.mrn}) instead</ShellButton> : null}
    <div className="pr-actions">
      <ShellButton type="submit" className="btn btn-primary btn-sm" disabled={busy || !v.name?.trim()}>{busy ? 'Registering…' : 'Register and link this study'}</ShellButton>
      <ShellButton type="button" className="btn btn-sm btn-plain" onClick={onCancel}>Cancel</ShellButton>
    </div>
  </form>
}

function IdentifierForm({ patient, onDone }: { patient: RegistryPatient; onDone: (p?: RegistryPatient) => void }) {
  const [v, setV] = useState<RegistryInput>({ abhaNumber: patient.abhaNumber ?? '', abhaAddress: patient.abhaAddress ?? '', aadhaar: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    setBusy(true); setError('')
    // ABHA fields are sent as they stand (empty clears); Aadhaar only when a new number was typed.
    const patch: RegistryInput = { abhaNumber: v.abhaNumber?.trim() || null, abhaAddress: v.abhaAddress?.trim() || null, ...(v.aadhaar?.trim() ? { aadhaar: v.aadhaar } : {}) }
    try { const p = await updateRegistryPatient(patient.id, patch); toast('Patient identifiers saved.', 'success'); onDone(p) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') }
    finally { setBusy(false) }
  }
  return <form className="pr-form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
    <IdFields value={v} set={setV} aadhaarOnFile={patient.aadhaarMasked} />
    {error ? <p className="pr-error" role="alert">{error}</p> : null}
    <div className="pr-actions">
      <ShellButton type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save identifiers'}</ShellButton>
      <ShellButton type="button" className="btn btn-sm btn-plain" onClick={() => onDone()}>Cancel</ShellButton>
    </div>
  </form>
}
