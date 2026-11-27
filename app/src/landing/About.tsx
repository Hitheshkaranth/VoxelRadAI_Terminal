import { useState } from 'react'
import { Check, Copy, Globe } from 'lucide-react'
import { track } from '@vercel/analytics'
import { BENCHMARKS, BUILDS } from '../lib/openModels'
import { Reveal } from './ui'
import { BrandIcon, type Brand } from '../components/BrandIcon'

const brandOf: Record<string, Brand> = { GitHub: 'github', 'Hugging Face': 'huggingface', X: 'x' }

type Member = { name: string; role: string; initials: string; photo: string; bio: string; profiles: readonly (readonly [string, string, string])[] }

const team: readonly Member[] = [
  { name: 'Hithesh Karanth', role: 'Founder & CEO', initials: 'HK', photo: '/team/hithesh-karanth.webp',
    bio: 'Builds the RadGenis reading workspace, the volume viewer and the Skanda models, from training to benchmarks.', profiles: [
    ['GitHub', 'https://github.com/Hitheshkaranth', '@Hitheshkaranth'],
    ['Hugging Face', 'https://huggingface.co/hitheshkaranth', 'hitheshkaranth'],
    ['X', 'https://x.com/HitheshKaranth', '@HitheshKaranth'],
    ['Website', 'https://hitheshkaranth.dev', 'hitheshkaranth.dev'],
  ] },
  { name: 'Dr\u00a0Skanda Kumar Udupa', role: 'Co-Founder & CMO · Radiologist', initials: 'SU', photo: '/team/skanda-kumar-udupa.webp',
    bio: 'Radiologist and clinical lead: sets what the models must find and reviews their outlines and reports.', profiles: [
    ['X', 'https://x.com/skandaudupa14g1', '@skandaudupa14g1'],
  ] },
  { name: 'Karishma Karanth', role: 'Co-Founder & COO', initials: 'KK', photo: '/team/karishma-karanth.webp',
    bio: 'Runs operations, partnerships and clinical pilots. MBA, University of Leeds.', profiles: [] },
]

const heldOut = BENCHMARKS[0].groups.reduce((n, g) => n + Number.parseInt(g.cases, 10), 0)

const bibtex = `@misc{karanth2026skanda,
  author       = {Karanth, Hithesh and Udupa, Skanda Kumar},
  title        = {Skanda-0: a grounded vision-language model for chest X-ray, CT and MRI},
  year         = {2026},
  publisher    = {Hugging Face},
  howpublished = {\\url{https://huggingface.co/hitheshkaranth/Skanda-0}},
  note         = {RadGenis, https://radgenis.com}
}`

export function About() {
  return <section className="sk-about" id="about" aria-labelledby="about-title">
    <div className="sk-wrap">
      <Reveal className="sk-team-head">
        <div><p className="sk-eyebrow">Team</p><h2 id="about-title" className="sk-h2">The people behind <em>RadGenis</em></h2></div>
        <div className="sk-team-intro">
          <p>A radiologist, an engineer and an operator. The workspace, Skanda V1, the open-source Skanda-0 and every benchmark on this page are built in-house.</p>
          <dl className="sk-about-facts">
            <div><dt>Modalities</dt><dd>X-ray · CT · MRI</dd></div>
            <div><dt>Open builds</dt><dd>{BUILDS.length}</dd></div>
            <div><dt>Held-out cases</dt><dd>{heldOut}</dd></div>
          </dl>
        </div>
      </Reveal>
      <Reveal className="sk-team">
        {team.map((m) => <article key={m.name} className="sk-person" aria-labelledby={`person-${m.initials}`}>
          <div className="sk-person-photo">
            <img src={m.photo} alt={`Portrait of ${m.name.replace('\u00a0', ' ')}`} width={640} height={800} loading="lazy" decoding="async" />
          </div>
          <div className="sk-person-body">
            <p className="sk-person-role">{m.role}</p>
            <h3 id={`person-${m.initials}`}>{m.name}</h3>
            <p className="sk-person-bio">{m.bio}</p>
            {m.profiles.length > 0 && <ul className="sk-person-links">{m.profiles.map(([label, href, handle]) =>
              <li key={label}><a href={href} target="_blank" rel="noreferrer" aria-label={`${m.name.replace('\u00a0', ' ')} on ${label} (${handle})`} title={handle} onClick={() => track('profile_open', { site: label, who: m.initials })}>{brandOf[label] ? <BrandIcon name={brandOf[label]} size={16} /> : <Globe size={16} aria-hidden="true" />}</a></li>)}</ul>}
          </div>
        </article>)}
      </Reveal>
      <Reveal className="sk-team-cite"><CiteCard /></Reveal>
    </div>
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
        <p className="sk-cite-foot">Skanda-0 weights are CC BY-NC 4.0. For commercial use or collaboration, reach out on <a className="sk-inline-link" href="https://huggingface.co/hitheshkaranth/Skanda-0/discussions">Hugging Face</a> or on X at <a className="sk-inline-link" href="https://x.com/HitheshKaranth">@HitheshKaranth</a>.</p>
      </div>
  </>
}
