import { useState } from 'react'
import { ArrowUpRight, Check, Copy } from 'lucide-react'
import { track } from '@vercel/analytics'
import { BENCHMARKS, BUILDS } from '../lib/openModels'
import { Reveal } from './ui'

const builders = [
  { name: 'Hithesh Karanth', initials: 'HK', profiles: [
    ['GitHub', 'https://github.com/Hitheshkaranth', '@Hitheshkaranth'],
    ['Hugging Face', 'https://huggingface.co/hitheshkaranth', 'hitheshkaranth'],
    ['X', 'https://x.com/HitheshKaranth', '@HitheshKaranth'],
  ] },
  { name: 'Skanda Kumar Udupa', initials: 'SU', profiles: [
    ['X', 'https://x.com/skandaudupa14g1', '@skandaudupa14g1'],
  ] },
] as const

const heldOut = BENCHMARKS[0].groups.reduce((n, g) => n + Number.parseInt(g.cases, 10), 0)

const bibtex = `@misc{karanth2026skanda,
  author       = {Karanth, Hithesh and Udupa, Skanda Kumar},
  title        = {Skanda-0: a grounded vision-language model for chest X-ray, CT and MRI},
  year         = {2026},
  publisher    = {Hugging Face},
  howpublished = {\\url{https://huggingface.co/hitheshkaranth/Skanda-0}},
  note         = {VoxelRad AI, https://voxelradai.com}
}`

export function About() {
  return <section className="sk-about" id="about" aria-labelledby="about-title">
    <Reveal className="sk-wrap sk-about-grid">
      <div className="sk-about-card">
        <div><p className="sk-plan-label">Built by</p><h2 id="about-title" className="sk-about-names">{builders.map((b) => b.name).join(' & ')}</h2></div>
        <p className="sk-about-text">VoxelRad AI and the Skanda models are built end to end by {builders[0].name} and {builders[1].name}: the reading workspace and volume viewer, Skanda V1 that the workspace serves, the open-source Skanda-0 and its quantized builds, and the benchmarks and fault reports on this page.</p>
        <dl className="sk-about-facts">
          <div><dt>Modalities</dt><dd>X-ray · CT · MRI</dd></div>
          <div><dt>Open builds</dt><dd>{BUILDS.length}</dd></div>
          <div><dt>Held-out cases</dt><dd>{heldOut}</dd></div>
        </dl>
        <ul className="sk-builders">{builders.map((b) => <li key={b.name}>
          <span className="sk-monogram" aria-hidden="true">{b.initials}</span>
          <div><b>{b.name}</b><ul className="sk-about-links">{b.profiles.map(([label, href, handle]) =>
            <li key={label}><a href={href} target="_blank" rel="noreferrer" onClick={() => track('profile_open', { site: label, who: b.initials })}><span>{label}</span><small>{handle}</small><ArrowUpRight size={15} /></a></li>)}</ul></div>
        </li>)}</ul>
      </div>
      <CiteCard />
    </Reveal>
  </section>
}

export function CiteCard() {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bibtex)
      setCopied(true)
      track('cite_copy')
      setTimeout(() => setCopied(false), 1600)
    } catch { /* the block stays selectable */ }
  }
  return <>
    <div className="sk-about-card sk-cite" id="cite">
        <div className="sk-cite-head">
          <div><p className="sk-plan-label">Cite</p><h3>Using Skanda-0 in your work?</h3></div>
          <button type="button" className={`sk-pill ${copied ? 'sk-pill-light' : 'sk-pill-grey'}`} onClick={copy} aria-live="polite">{copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy BibTeX</>}</button>
        </div>
        <pre tabIndex={0} aria-label="BibTeX citation"><code>{bibtex}</code></pre>
        <p className="sk-cite-foot">Skanda-0 weights are CC BY-NC 4.0. For commercial use or collaboration, reach out on <a className="sk-inline-link" href="https://huggingface.co/hitheshkaranth/Skanda-0/discussions">Hugging Face</a> or <a className="sk-inline-link" href="https://x.com/HitheshKaranth">X</a>.</p>
      </div>
  </>
}
