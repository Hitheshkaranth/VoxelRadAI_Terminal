import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { modelColor, models } from './data'
import { Pill, Reveal, frac, pct } from './ui'

type Stat = { k: number; n: number; pct: number; ci: readonly number[]; source?: string }
/** One decimal for right finding type, so 40.5 (Skanda) and 40.9 (MedGemma) don't both round to 41%. */
const digitsFor = (label: string) => (label.startsWith('Right finding type') ? 1 : 0)
const method = 'https://github.com/Hitheshkaranth/skanda-radiology/blob/main/benchmark/README.md'

const cards = {
  skanda: { label: 'Base model · Skanda V1', blurb: 'Our grounded reader. Writes the report and outlines each finding. Read twice; mean of both reads.' },
  medgemma: { label: 'Generalist · MedGemma 27B', blurb: 'Google’s open medical VLM, served in the same pipeline with the same prompts and parser.' },
  maira: { label: 'Grounded · MAIRA-2', blurb: 'Microsoft’s grounded CXR reporting model. One box per sentence; no severity or confidence.' },
} as const

const headlineRows = [
  ['normals', 'Normal films called normal'],
  ['abnormal', 'Abnormal films flagged'],
  ['rightType', 'Right finding type, all labels'],
  ['localised', 'Box centre on the lesion'],
] as const

const views = {
  Headline: headlineRows.map(([key, label]) => ({ label, digits: digitsFor(label), get: (m: (typeof models)[number]) => m.headline[key] as Stat })),
  'By finding': (['Cardiomegaly', 'Effusion', 'Consolidation', 'Pneumothorax', 'Mass', 'Nodule', 'Atelectasis', 'Pleural Thickening'] as const)
    .map((key) => ({ label: key, get: (m: (typeof models)[number]) => (m.sensitivity as Record<string, Stat>)[key] })),
  Precision: (['consolidation / opacity', 'effusion', 'cardiomegaly', 'pneumothorax', 'nodule / mass'] as const)
    .map((key) => ({ label: key[0].toUpperCase() + key.slice(1), get: (m: (typeof models)[number]) => (m.precision as Record<string, Stat>)[key] })),
}
const notes: Record<keyof typeof views, string> = {
  Headline: 'Share of films. Specificity, sensitivity to any abnormality, exact finding type across all 220 labels, and localisation of detected findings that carried a box.',
  'By finding': 'Sensitivity per radiologist label: a film counts when the model reports a finding of that type.',
  Precision: 'Of the films where the model reported this finding type, how many truly had it.',
}

export function Benchmarks() {
  const [view, setView] = useState<keyof typeof views>('Headline')
  const [hover, setHover] = useState<string | null>(null)
  return <section className="sk-bench" id="benchmarks" aria-labelledby="bench-title">
    <div className="sk-wrap"><h2 id="bench-title" className="sk-giant">Benchmarks</h2></div>
    <Reveal className="sk-wrap sk-plans">{models.map((m) => {
      const c = cards[m.key]
      return <article key={m.key} className="sk-plan" data-model={m.key}>
        <span className="sk-plan-label">{c.label}</span>
        <p className="sk-plan-price"><small>localised</small>{pct(m.headline.localised.pct)}</p>
        <p className="sk-plan-blurb">{c.blurb}</p>
        <ul>{headlineRows.slice(0, 3).map(([key, label]) => { const s = m.headline[key] as Stat; return <li key={key}><span>{label}</span><b>{pct(s.pct, digitsFor(label))}</b></li> })}
          <li><span>Cardiomegaly found</span><b>{frac(m.sensitivity.Cardiomegaly.k, m.sensitivity.Cardiomegaly.n)}</b></li></ul>
        <div className="sk-plan-actions"><Pill href={m.key === 'skanda' ? '/workspace' : method} tone={m.key === 'skanda' ? 'light' : 'grey'}>{m.key === 'skanda' ? 'Read with Skanda' : 'See the method'}</Pill><a href={method} className="sk-details">Details <ArrowRight size={13} /></a></div>
      </article>
    })}</Reveal>

    <Reveal className="sk-wrap sk-chart-card">
      <div className="sk-chart-head">
        <div><h3>Head to head</h3><p className="sk-bench-sub">Three models, the same 111 held-out ChestX-Det films, labelled and boxed by three radiologists. One scorer, Wilson 95% intervals, nothing typed by hand.</p><p>{notes[view]}</p></div>
        <div className="sk-seg sk-seg-lg" role="tablist" aria-label="Benchmark view">{(Object.keys(views) as (keyof typeof views)[]).map((v) => <button key={v} role="tab" aria-selected={v === view} onClick={() => setView(v)}>{v}</button>)}</div>
      </div>
      <div className="sk-legend">{models.map((m) => <span key={m.key}><i style={{ background: modelColor[m.key] }} />{m.name}</span>)}<span className="sk-legend-ci"><i />95% interval</span></div>
      <div className="sk-bars" key={view}>
        {views[view].map((row, r) => <div className="sk-bar-row" key={row.label} style={{ ['--r' as string]: r }}>
          <span className="sk-bar-label">{row.label}</span>
          <div className="sk-bar-group">{models.map((m) => {
            const s = row.get(m)
            const id = `${row.label}-${m.key}`
            const d = 'digits' in row ? row.digits : 0
            if (!s || s.n === 0) return <div key={m.key} className="sk-bar sk-bar-empty"><span>{m.name}: not reported</span></div>
            return <div key={m.key} className="sk-bar" data-model={m.key} onPointerEnter={() => setHover(id)} onPointerLeave={() => setHover(null)} tabIndex={0} onFocus={() => setHover(id)} onBlur={() => setHover(null)} aria-label={`${m.name}, ${row.label}: ${frac(s.k, s.n)}, ${pct(s.pct, d)}, 95% interval ${pct(s.ci[0])} to ${pct(s.ci[1])}${s.source ? `, ${s.source}` : ''}`}>
              <i className="sk-bar-fill" style={{ width: `${s.pct}%`, background: modelColor[m.key] }} />
              <i className="sk-bar-ci" style={{ left: `${s.ci[0]}%`, width: `${s.ci[1] - s.ci[0]}%` }} />
              <b>{pct(s.pct, d)}</b>
              {hover === id && <span className="sk-tip">{m.name} · {frac(s.k, s.n)} · CI {pct(s.ci[0])}–{pct(s.ci[1])}{s.source ? ` · ${s.source}` : ''}</span>}
            </div>
          })}</div>
        </div>)}
      </div>
      <p className="sk-chart-foot">Skanda V1: two reads of every film, mean shown with single-read intervals. Right finding type is from the run-3 checkpoint (docs/benchmark-card.svg); the other Skanda figures are from the run-2 results committed in benchmark/. MedGemma 27B and MAIRA-2: one read each. Single-run differences under ~15 labels are within run-to-run noise. Chest X-ray only; CT and MRI were evaluated separately on small selected slices. <a href={method}>Full method</a></p>
    </Reveal>
  </section>
}
