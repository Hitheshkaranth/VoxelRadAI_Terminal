// Guideline helper: deterministic recommendation wording for common incidental findings. Decision support only;
// the reader confirms the guideline applies before the sentence goes into Recommendations.
import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Sparkles, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { ShellButton } from '../shell/ShellButton'
import {
  adrenal, birads, bosniak, fleischner, lungRads, recommendationSentence, tirads, tiradsPoints, TIRADS_FEATURES,
  type BiradsCategory, type BosniakClass, type GuidelineResult, type NoduleType, type TiradsInput,
} from '../../lib/guidelines'
import { useGuidelineBus } from '../../lib/guidelineBus'
import type { GuidelineSuggestion } from '../../lib/guidelineSuggest'
import './guidelineHelper.css'

type Kind = 'fleischner' | 'lungRads' | 'tirads' | 'bosniak' | 'adrenal' | 'birads'
const KINDS: { key: Kind; label: string }[] = [
  { key: 'fleischner', label: 'Fleischner 2017 (incidental lung nodule)' },
  { key: 'lungRads', label: 'Lung-RADS v2022 (screening)' },
  { key: 'tirads', label: 'ACR TI-RADS (thyroid nodule)' },
  { key: 'bosniak', label: 'Bosniak 2019 (cystic renal mass)' },
  { key: 'adrenal', label: 'ACR incidental adrenal mass' },
  { key: 'birads', label: 'BI-RADS assessment' },
]

const num = (text: string) => (text.trim() === '' ? Number.NaN : Number(text))

const DEFAULT_TIRADS: TiradsInput = {
  composition: 'solid or almost completely solid', echogenicity: 'hypoechoic', shape: 'wider-than-tall', margin: 'smooth or ill-defined', foci: [],
}

export function GuidelineHelper({ disabled, onInsert, suggestions = [] }: {
  disabled?: boolean
  onInsert: (sentence: string) => void
  /** Guideline-worthy findings spotted in the dictated text; each opens the helper pre-filled. */
  suggestions?: GuidelineSuggestion[]
}) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind>('fleischner')
  const [size, setSize] = useState('')
  const [solid, setSolid] = useState('')
  const [hu, setHu] = useState('')
  const [type, setType] = useState<NoduleType>('solid')
  const [multiple, setMultiple] = useState(false)
  const [highRisk, setHighRisk] = useState(false)
  const [status, setStatus] = useState<'baseline' | 'new' | 'growing' | 'stable'>('baseline')
  const [juxtapleural, setJuxtapleural] = useState(false)
  const [cancer, setCancer] = useState(false)
  const [fat, setFat] = useState(false)
  const [stable, setStable] = useState(false)
  const [bosniakClass, setBosniakClass] = useState<BosniakClass>('II')
  const [biradsCategory, setBiradsCategory] = useState<BiradsCategory>('2')
  const [ti, setTi] = useState<TiradsInput>(DEFAULT_TIRADS)
  // The dictated sentence the open helper was pre-filled from, shown so the reader can check the values against it.
  const [from, setFrom] = useState<GuidelineSuggestion | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const rowRef = useRef<HTMLDivElement>(null)
  const visible = suggestions.filter((s) => !dismissed.has(s.id))

  /** Start from the blank form, then set only what was dictated. */
  const openWith = (suggestion?: GuidelineSuggestion) => {
    const p = suggestion?.prefill ?? {}
    if (suggestion) {
      setKind(suggestion.kind)
      setSize(p.size != null ? String(p.size) : '')
      setSolid(p.solidMm != null ? String(p.solidMm) : '')
      setHu(p.hu != null ? String(p.hu) : '')
      setType(p.type ?? 'solid')
      setMultiple(p.multiple ?? false)
      setHighRisk(false)
      setStatus(p.status ?? 'baseline')
      setJuxtapleural(p.juxtapleural ?? false)
      setCancer(false)
      setFat(p.fat ?? false)
      setStable(false)
      if (p.bosniakClass) setBosniakClass(p.bosniakClass)
      if (p.biradsCategory) setBiradsCategory(p.biradsCategory)
      setTi({ ...DEFAULT_TIRADS, ...p.tirads })
    }
    setFrom(suggestion ?? null)
    // Opened by voice or a chip while the reader is elsewhere in the report: bring the helper on screen first, so the
    // pre-filled values can be checked before "insert guideline".
    rowRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' })
    setOpen(true)
  }

  const outcome = useMemo((): { result?: GuidelineResult; error?: string } => {
    try {
      if (kind === 'bosniak') return { result: bosniak(bosniakClass) }
      if (kind === 'birads') return { result: birads(biradsCategory) }
      if (!size.trim()) return {}
      if (kind === 'fleischner') return { result: fleischner({ sizeMm: num(size), type, multiple, highRisk }) }
      if (kind === 'lungRads') return { result: lungRads({ sizeMm: num(size), type, status, juxtapleural, solidMm: type === 'part-solid' ? num(solid) : undefined }) }
      if (kind === 'tirads') return { result: tirads(tiradsPoints(ti), num(size)) }
      return { result: adrenal({ sizeCm: num(size), unenhancedHu: hu.trim() ? num(hu) : undefined, macroscopicFat: fat, cancerHistory: cancer, stableOneYear: stable }) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Check the values.' }
    }
  }, [kind, size, solid, hu, type, multiple, highRisk, status, juxtapleural, cancer, fat, stable, bosniakClass, biradsCategory, ti])

  const insert = (result: GuidelineResult) => {
    onInsert(recommendationSentence(result))
    if (from) setDismissed((d) => new Set(d).add(from.id))
    setFrom(null)
    setOpen(false)
  }

  // Dictation drives the helper through the bus; the handle reads the latest render's state.
  const latest = useRef({ open, outcome, openWith, insert })
  latest.current = { open, outcome, openWith, insert }
  useEffect(() => {
    const { register } = useGuidelineBus.getState()
    register({
      open: (suggestion) => latest.current.openWith(suggestion),
      insert: () => {
        const { open: isOpen, outcome: current, insert: doInsert } = latest.current
        if (!isOpen) return 'closed'
        if (!current.result) return 'incomplete'
        doInsert(current.result)
        return 'inserted'
      },
      close: () => { setOpen(false); setFrom(null) },
    })
    return () => register(null)
  }, [])
  const visibleKey = visible.map((s) => s.id).join('\n')
  useEffect(() => {
    useGuidelineBus.getState().setSuggestions(visible)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the ids, not the array identity
  }, [visibleKey])
  useEffect(() => () => useGuidelineBus.getState().setSuggestions([]), [])

  const sizeLabel = kind === 'tirads' ? 'Maximum diameter (cm)' : kind === 'adrenal' ? 'Size (cm)' : kind === 'lungRads' ? (type === 'part-solid' ? 'Total mean diameter (mm)' : 'Mean diameter (mm)') : 'Average diameter (mm)'
  const check = (label: string, value: boolean, set: (v: boolean) => void) =>
    <label key={label} className="gh-check"><input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} />{label}</label>
  const select = (key: 'composition' | 'echogenicity' | 'shape' | 'margin', label: string) =>
    <label>{label}<select value={ti[key]} onChange={(e) => setTi({ ...ti, [key]: e.target.value })}>
      {Object.entries(TIRADS_FEATURES[key]).map(([name, points]) => <option key={name} value={name}>{name} ({points})</option>)}
    </select></label>

  return (
    <div className="gh-row" ref={rowRef}>
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setFrom(null) }}>
        <PopoverTrigger asChild>
          <ShellButton type="button" className="btn btn-sm gh-trigger" disabled={disabled} onClick={() => setFrom(null)}><BookOpen size={14} /> Guideline helper</ShellButton>
        </PopoverTrigger>
        <PopoverContent className="gh-popover" align="start" aria-label="Guideline helper">
          <h3>Guideline helper</h3>
          <p className="gh-note">Decision support to verify: check the guideline applies to this patient and finding before inserting.</p>
          {from ? (
            <p className="gh-from"><Sparkles size={12} aria-hidden /> Pre-filled from your report: <q>{from.evidence}</q> Check each value; anything not dictated is left at its default.</p>
          ) : null}
          <label>Guideline<select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select></label>

          {kind !== 'bosniak' && kind !== 'birads' ? (
            <label>{sizeLabel}<input inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} placeholder="e.g. 7" /></label>
          ) : null}

          {kind === 'fleischner' || kind === 'lungRads' ? (
            <label>Nodule type<select value={type} onChange={(e) => setType(e.target.value as NoduleType)}>
              <option value="solid">Solid</option><option value="part-solid">Part-solid</option><option value="ground-glass">Ground-glass (non-solid)</option>
            </select></label>
          ) : null}
          {kind === 'fleischner' ? <>
            {check('Multiple nodules', multiple, setMultiple)}
            {type === 'solid' ? check('High-risk patient', highRisk, setHighRisk) : null}
          </> : null}
          {kind === 'lungRads' ? <>
            {type === 'part-solid' ? <label>Solid component (mm)<input inputMode="decimal" value={solid} onChange={(e) => setSolid(e.target.value)} /></label> : null}
            <label>Status<select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="baseline">Baseline</option><option value="new">New</option><option value="growing">Growing</option><option value="stable">Stable at follow-up</option>
            </select></label>
            {type === 'solid' ? check('Juxtapleural, smooth, oval/lentiform/triangular', juxtapleural, setJuxtapleural) : null}
          </> : null}
          {kind === 'tirads' ? <>
            {select('composition', 'Composition')}
            {select('echogenicity', 'Echogenicity')}
            {select('shape', 'Shape')}
            {select('margin', 'Margin')}
            <fieldset className="gh-foci"><legend>Echogenic foci (add all present)</legend>
              {(Object.keys(TIRADS_FEATURES.foci) as TiradsInput['foci']).map((focus) => check(`${focus} (${TIRADS_FEATURES.foci[focus]})`, ti.foci.includes(focus),
                (on) => setTi({ ...ti, foci: on ? [...ti.foci, focus] : ti.foci.filter((f) => f !== focus) })))}
            </fieldset>
          </> : null}
          {kind === 'adrenal' ? <>
            <label>Unenhanced CT (HU), if available<input inputMode="decimal" value={hu} onChange={(e) => setHu(e.target.value)} /></label>
            {check('Macroscopic fat', fat, setFat)}
            {check('History of cancer', cancer, setCancer)}
            {check('Stable for 1 year or more', stable, setStable)}
          </> : null}
          {kind === 'bosniak' ? (
            <label>Bosniak class<select value={bosniakClass} onChange={(e) => setBosniakClass(e.target.value as BosniakClass)}>
              {(['I', 'II', 'IIF', 'III', 'IV'] as const).map((c) => <option key={c} value={c}>{c}</option>)}
            </select></label>
          ) : null}
          {kind === 'birads' ? (
            <label>Assessment category<select value={biradsCategory} onChange={(e) => setBiradsCategory(e.target.value as BiradsCategory)}>
              {(['0', '1', '2', '3', '4', '4A', '4B', '4C', '5', '6'] as const).map((c) => <option key={c} value={c}>{c}</option>)}
            </select></label>
          ) : null}

          {outcome.error ? <p className="gh-error" role="alert">{outcome.error}</p> : null}
          {outcome.result ? (
            <div className="gh-result" aria-live="polite">
              <p className="gh-sentence">{recommendationSentence(outcome.result)}</p>
              {outcome.result.notes.length ? <ul className="gh-notes">{outcome.result.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
              <p className="gh-cite">{outcome.result.citation}</p>
            </div>
          ) : null}
          <ShellButton type="button" className="btn btn-primary btn-sm" disabled={!outcome.result}
            onClick={() => { if (outcome.result) insert(outcome.result) }}>
            Insert into Recommendations
          </ShellButton>
        </PopoverContent>
      </Popover>
      {!disabled && visible.length ? (
        <ul className="gh-suggest" aria-label="Suggested guidelines">
          {visible.map((s) => (
            <li key={s.id}>
              <ShellButton type="button" className="btn btn-sm gh-chip" title={`From: ${s.evidence}`} onClick={() => openWith(s)}>
                <Sparkles size={12} aria-hidden /> {s.label}
              </ShellButton>
              <ShellButton type="button" className="btn btn-sm btn-plain gh-chip-x" aria-label={`Dismiss ${s.label}`}
                onClick={() => setDismissed((d) => new Set(d).add(s.id))}><X size={12} /></ShellButton>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
