// Guideline helper: deterministic recommendation wording for common incidental findings. Decision support only;
// the reader confirms the guideline applies before the sentence goes into Recommendations.
import { useMemo, useState } from 'react'
import { BookOpen } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { ShellButton } from '../shell/ShellButton'
import {
  adrenal, birads, bosniak, fleischner, lungRads, recommendationSentence, tirads, tiradsPoints, TIRADS_FEATURES,
  type BiradsCategory, type BosniakClass, type GuidelineResult, type NoduleType, type TiradsInput,
} from '../../lib/guidelines'
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

export function GuidelineHelper({ disabled, onInsert }: { disabled?: boolean; onInsert: (sentence: string) => void }) {
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
  const [ti, setTi] = useState<TiradsInput>({
    composition: 'solid or almost completely solid', echogenicity: 'hypoechoic', shape: 'wider-than-tall', margin: 'smooth or ill-defined', foci: [],
  })

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

  const sizeLabel = kind === 'tirads' ? 'Maximum diameter (cm)' : kind === 'adrenal' ? 'Size (cm)' : kind === 'lungRads' ? (type === 'part-solid' ? 'Total mean diameter (mm)' : 'Mean diameter (mm)') : 'Average diameter (mm)'
  const check = (label: string, value: boolean, set: (v: boolean) => void) =>
    <label key={label} className="gh-check"><input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} />{label}</label>
  const select = (key: 'composition' | 'echogenicity' | 'shape' | 'margin', label: string) =>
    <label>{label}<select value={ti[key]} onChange={(e) => setTi({ ...ti, [key]: e.target.value })}>
      {Object.entries(TIRADS_FEATURES[key]).map(([name, points]) => <option key={name} value={name}>{name} ({points})</option>)}
    </select></label>

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ShellButton type="button" className="btn btn-sm gh-trigger" disabled={disabled}><BookOpen size={14} /> Guideline helper</ShellButton>
      </PopoverTrigger>
      <PopoverContent className="gh-popover" align="start" aria-label="Guideline helper">
        <h3>Guideline helper</h3>
        <p className="gh-note">Decision support to verify: check the guideline applies to this patient and finding before inserting.</p>
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
          onClick={() => { if (outcome.result) { onInsert(recommendationSentence(outcome.result)); setOpen(false) } }}>
          Insert into Recommendations
        </ShellButton>
      </PopoverContent>
    </Popover>
  )
}
