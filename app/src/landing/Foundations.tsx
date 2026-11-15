import { ArrowUpRight } from 'lucide-react'
import { APP_MODELS, DATASET_COUNT, FOUNDATIONS, TRAINING_DATA, TRAINING_TOTAL, groupTotal } from '../lib/foundations'
import { Reveal } from './ui'
import { BrandIcon } from '../components/BrandIcon'

const max = Math.max(...TRAINING_DATA.flatMap((g) => g.sets.map((s) => s.records)))
const n = (v: number) => v.toLocaleString('en-US')

/** The foundation models Skanda is built on, the other models in the app, and the data Skanda was trained on. */
export function Foundations() {
  return <section className="sk-wrap sk-found" id="foundations" aria-labelledby="found-title">
    <Reveal className="sk-found-head">
      <div><p className="sk-eyebrow">Under the hood</p><h2 id="found-title" className="sk-h2">Built on <em>foundation models</em></h2></div>
      <p>Skanda joins a large vision-language model to a segmentation model, so every finding it writes comes with an outline. Both foundations are open, and both were fine-tuned on labelled X-ray, CT and MRI scans, with radiologist outlines where the dataset has them.</p>
    </Reveal>

    <Reveal className="sk-found-grid">{FOUNDATIONS.map((f, i) => <article key={f.name} className="sk-found-card" style={{ ['--i' as string]: i }}>
      <span className="sk-found-logo" aria-hidden="true">{f.logo === 'skanda' ? <img src="/skanda-mark.png" alt="" /> : <BrandIcon name={f.logo} size={26} />}</span>
      <span className="sk-plan-label">{f.by}</span>
      <h3>{f.name}</h3>
      <p className="sk-found-role">{f.role}</p>
      <ul>{f.facts.map((x) => <li key={x}>{x}</li>)}</ul>
      <p className="sk-found-trained"><b>Fine-tuned for Skanda.</b> {f.trained}</p>
      <a className="sk-found-link" href={f.href} {...(f.href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}>{f.licence}<ArrowUpRight size={13} /></a>
    </article>)}</Reveal>

    <Reveal className="sk-data">
      <div className="sk-data-total">
        <p className="sk-plan-label">Training data</p>
        <b>{n(TRAINING_TOTAL)}</b>
        <p>labelled training records, each one image, slice or volume, from {DATASET_COUNT} public datasets, split by patient.</p>
        <ul className="sk-data-mods">{TRAINING_DATA.map((g) => <li key={g.modality}><span>{g.modality}</span><b>{n(groupTotal(g))}</b></li>)}</ul>
      </div>
      <div className="sk-data-sets">{TRAINING_DATA.map((g) => <div key={g.modality} className="sk-data-group">
        <h3>{g.modality}<span>{n(groupTotal(g))} records</span></h3>
        {g.sets.map((s, i) => <div key={s.name} className="sk-data-row" style={{ ['--r' as string]: i }}>
          <span className="sk-data-name"><b>{s.name}</b><small>{s.what}</small></span>
          <span className="sk-data-bar" aria-hidden="true"><i style={{ width: `${(s.records / max) * 100}%` }} /></span>
          <span className="sk-data-n">{n(s.records)}</span>
        </div>)}
      </div>)}</div>
    </Reveal>
    <p className="sk-chart-foot sk-found-foot">These are the training records of Skanda-0 (runs 2–3), from its public data card. Skanda V1 continues from Skanda-0 with more training data, not yet itemised. Held-out test cases are never trained on, and only datasets whose licences allow commercial use were included. Baseline models were never used as training text.</p>

    <Reveal className="sk-found-also"><p className="sk-plan-label">Also in the app</p>
      <ul>{APP_MODELS.map((m) => <li key={m.name}><b>{m.logo && <BrandIcon name={m.logo} size={15} />}{m.name}</b><small>{m.by}</small><span>{m.role}</span></li>)}</ul>
    </Reveal>
  </section>
}
