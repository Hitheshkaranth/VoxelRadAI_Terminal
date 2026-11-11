import { useEffect, useRef, useState } from 'react'
import { Accordion } from 'radix-ui'
import { ArrowLeft, ArrowRight, ArrowUpRight, Bone, Boxes, Brain, ChevronDown, Database, FileImage, FileText, Flame, GitBranch, GitCompareArrows, Layers, Microscope, ScanLine, ScanSearch, Server, Shapes, Sparkles, SquareDashed, Stethoscope, Waypoints, BookOpen, Package, FileCode2 } from 'lucide-react'
import { faqs, img, models, reads, wall } from './data'
import { Pill, Reveal, frac, pct, useReducedMotion } from './ui'

/* ------------------------------------------------------------------ 3 · stack */
const stack = [
  [FileImage, 'DICOM'], [Boxes, 'NRRD'], [Stethoscope, 'ChestX-Det'], [Brain, 'BraTS'],
  [Shapes, 'SAM 2'], [Microscope, 'TorchXRayVision'], [Database, 'PostgreSQL'], [Server, 'Orthanc'],
] as const
export function Stack() {
  return <section className="sk-stack" aria-label="Built on and evaluated with">
    <ul>{stack.map(([Icon, name]) => <li key={name}><Icon size={22} strokeWidth={1.7} /><span>{name}</span></li>)}</ul>
  </section>
}

/* ------------------------------------------------------------------ 4 · intro + scan wall */
export function Intro() {
  const rows = [0, 8, 15].map((start) => Array.from({ length: 11 }, (_, i) => wall[(start + i) % wall.length]))
  const section = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()
  useEffect(() => {
    const el = section.current
    if (!el || reduced) return
    let frame = 0
    const render = () => {
      frame = 0
      const r = el.getBoundingClientRect()
      if (r.bottom < 0 || r.top > innerHeight) return
      el.style.setProperty('--drift', `${(innerHeight - r.top) * 0.18}px`)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(render) }
    render()
    addEventListener('scroll', schedule, { passive: true })
    return () => { cancelAnimationFrame(frame); removeEventListener('scroll', schedule) }
  }, [reduced])
  return <section ref={section} className="sk-intro" id="model" aria-labelledby="intro-title">
    <div className="sk-wall" aria-hidden="true">{rows.map((row, r) => <div key={r} className="sk-wall-row" data-row={r}>{row.map((name, i) => <figure key={i}><img src={img(name)} alt="" loading="lazy" /></figure>)}</div>)}</div>
    <Reveal className="sk-intro-copy">
      <h2 id="intro-title">Reads that speak.<br />Evidence that shows.</h2>
      <p>Skanda V1 writes the report and draws where each finding is: a box, an outline, a region you can check against the film. Combining a grounded reader with your judgement, every read stays reviewable from first pixel to final sign-off.</p>
      <div className="sk-actions sk-actions-left"><Pill href="#approach">How it reads</Pill><Pill href="#reads" tone="ghost">See the reads</Pill></div>
    </Reveal>
  </section>
}

/* ------------------------------------------------------------------ 5 · reads helix */
export function Reads() {
  const section = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()
  useEffect(() => {
    const el = section.current
    if (!el || reduced) return
    let frame = 0
    const cards = [...el.querySelectorAll<HTMLElement>('.sk-helix-card')]
    const render = () => {
      frame = 0
      const r = el.getBoundingClientRect()
      if (r.bottom < 0 || r.top > innerHeight) return
      const p = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - innerHeight)))
      const radius = Math.min(560, innerWidth * 0.36)
      cards.forEach((card, i) => {
        const a = i * (Math.PI * 2 / 6.2) + p * Math.PI * 3.2
        const x = Math.sin(a) * radius
        const z = Math.cos(a) * radius
        const y = (i - cards.length / 2) * innerHeight * (innerWidth < 760 ? 0.075 : 0.11) - (p - 0.5) * innerHeight * 1.1
        card.style.transform = `translate3d(${x}px, ${y}px, ${z - radius * 0.35}px) rotateY(${Math.sin(a) * 38}deg)`
        card.style.zIndex = String(Math.round(z + 1000))
        card.style.filter = `brightness(${0.45 + (Math.cos(a) + 1) * 0.3})`
      })
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(render) }
    render()
    addEventListener('scroll', schedule, { passive: true })
    addEventListener('resize', schedule)
    return () => { cancelAnimationFrame(frame); removeEventListener('scroll', schedule); removeEventListener('resize', schedule) }
  }, [reduced])
  return <section ref={section} className="sk-reads" id="reads" aria-labelledby="reads-title" data-static={reduced}>
    <div className="sk-reads-sticky">
      <div className="sk-streaks" aria-hidden="true"><svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">{[0, 1, 2, 3, 4, 5, 6].map((i) => <path key={i} d={`M-100 ${120 + i * 110} C 300 ${-80 + i * 160}, 700 ${980 - i * 120}, 1700 ${160 + i * 95}`} />)}</svg></div>
      <h2 id="reads-title">Our <em>Reads</em></h2>
      <div className="sk-helix">{reads.map((r) => <a key={r.image} className="sk-helix-card" href="#top"><img src={img(r.image)} alt={`${r.title}, ${r.meta}`} loading="lazy" /><span><b>{r.title}</b><small>{r.meta}</small></span></a>)}</div>
      <p className="sk-reads-note">Chest and BraTS overlays are recorded model output. CT and MR head overlays are illustrative.</p>
    </div>
  </section>
}

/* ------------------------------------------------------------------ 6 · capabilities */
const capabilities = [
  [Stethoscope, 'Chest', 'X-ray reads'], [ScanLine, 'CT', 'Slice reads'], [Brain, 'MRI', 'Sequence reads'], [SquareDashed, 'Grounded', 'Finding boxes'], [Waypoints, 'SAM 2', 'Outlines'],
  [Flame, 'Evidence', 'Heatmaps'], [GitCompareArrows, 'Second', 'Reader check'], [FileText, 'Structured', 'Report drafts'], [Layers, 'Multiplanar', 'Volume review'], [ScanSearch, 'Clinician', 'Sign-off'],
] as const
export function Capabilities() {
  return <section className="sk-wrap sk-caps" id="capabilities" aria-labelledby="caps-title">
    <Reveal className="sk-head-row"><h2 id="caps-title">Elevate every<br />clinical read.</h2><div className="sk-actions"><Pill href="#approach">View the approach</Pill><Pill href="/workspace" tone="grey">Open workspace</Pill></div></Reveal>
    <Reveal className="sk-cap-grid">{capabilities.map(([Icon, a, b], i) => <a key={a} href="#approach" style={{ ['--i' as string]: i }}><Icon size={26} strokeWidth={1.8} /><span>{a}<br />{b}</span></a>)}</Reveal>
    <Platform />
  </section>
}

const formats = [[Stethoscope, 'X-ray'], [ScanLine, 'CT'], [Brain, 'MRI'], [FileImage, 'DICOM'], [Boxes, 'NRRD'], [Bone, 'DRR'], [FileText, 'PDF report'], [Database, 'PACS']] as const
function Platform() {
  return <Reveal className="sk-platform">
    <div className="sk-platform-copy"><h3>Modality flexibility.<br />Model consistency.</h3><p>Whatever the study, the reading stays <b>consistent</b>, <b>grounded</b>, <b>reviewable</b>, and built to be checked.</p><Pill href="#reads" tone="grey">See the reads</Pill></div>
    <ul className="sk-platform-grid">{formats.map(([Icon, name]) => <li key={name} title={name}><Icon size={30} strokeWidth={1.6} /><span>{name}</span></li>)}</ul>
  </Reveal>
}

/* ------------------------------------------------------------------ 8 · ticker */
export function Ticker() {
  const words = ['Chest X-ray', 'CT volumes', 'MRI sequences', 'Grounded findings', 'Evidence heatmaps', 'Report drafts']
  return <div className="sk-ticker" aria-hidden="true"><div>{[...words, ...words, ...words].map((w, i) => <span key={i}>{w}<i>•</i></span>)}</div></div>
}

/* ------------------------------------------------------------------ 10 · approach bento */
export function Approach() {
  // Recorded Skanda findings: cxd_69598 (segmentation-outline capture) and BraTS axial 75 (skanda-mri capture)
  const findings = [['Consolidation', 'L mid zone', 'cxr-69598-skanda', 'Outline'], ['Pleural effusion', 'R mid zone', 'cxr-69598-skanda', 'Outline'], ['Consolidation', 'R upper zone', 'cxr-69598', 'Outline'], ['Enhancing tumour', 'L hemisphere', 'mri-brats-75-skanda', 'Outline'], ['Peritumoral oedema', 'L hemisphere', 'mri-brats-skanda-boxes', 'Box']]
  return <section className="sk-wrap sk-approach" id="approach" aria-labelledby="approach-title">
    <Reveal><h2 id="approach-title" className="sk-h2">Our Approach</h2></Reveal>
    <div className="sk-bento">
      <Reveal as="article" className="sk-card sk-card-wide">
        <h3>Source First</h3><p>Every read begins with <b>the original image</b>, kept beside each finding so the evidence is never more than a glance away.</p>
        <div className="sk-collage">{['mr-coronal', 'ct-axial-brain', 'cxr-69598', 'mri-brats-75', 'xr-skull-lateral'].map((n, i) => <img key={n} src={img(n)} alt="" style={{ ['--i' as string]: i }} loading="lazy" />)}</div>
      </Reveal>
      <Reveal as="article" className="sk-card sk-card-planet">
        <h3>Grounded Findings</h3><p>Each finding arrives with <b>a box and an outline</b>, drawn where Skanda saw it.</p>
        <div className="sk-phones"><figure><img src={img('cxr-69598')} alt="Chest film cxd_69598, source" loading="lazy" /><figcaption>Source</figcaption></figure><figure><img src={img('cxr-69598-skanda')} alt="The same film with Skanda's recorded outlines" loading="lazy" /><figcaption>Skanda V1</figcaption></figure></div>
      </Reveal>
      <Reveal as="article" className="sk-card sk-card-swoosh">
        <h3>Evidence Heatmaps</h3><p>A classifier cross-check paints <b>where the evidence is strongest</b>, so a call can be confirmed or questioned.</p>
        <div className="sk-laptop"><div className="sk-laptop-screen"><aside>{['Source', 'Heatmap', 'Boxes', 'Report'].map((t, i) => <span key={t} data-on={i === 1}>{t}</span>)}</aside><img src={img('cxr-45707-heat')} alt="Chest film with recorded classifier heatmap and finding boxes" loading="lazy" /><div className="sk-laptop-stats"><b>17%</b><small>peak on lesion</small><small>TorchXRayVision · held-out</small></div></div><div className="sk-laptop-base" /></div>
      </Reveal>
      <Reveal as="article" className="sk-card sk-card-wide sk-card-stars">
        <h3>Reference-Checked</h3><p>Outlines are scored against <b>radiologist reference masks</b>, slice by slice, before anyone relies on them.</p>
        <div className="sk-triptych"><div className="sk-chrome"><i /><i /><i /><span>BraTS glioma · axial 75 · T1 post-contrast</span><b>Outline Dice 0.84</b></div><figure><img src={img('mri-brats-75')} alt="BraTS axial 75 source" loading="lazy" /><figcaption>Source</figcaption></figure><figure><img src={img('mri-brats-75-reference')} alt="Radiologist reference mask" loading="lazy" /><figcaption>Reference</figcaption><span className="sk-cursor sk-cursor-a">Radiologist</span></figure><figure><img src={img('mri-brats-75-skanda')} alt="Skanda outline and box" loading="lazy" /><figcaption>Skanda V1</figcaption><span className="sk-cursor sk-cursor-b">Skanda</span></figure></div>
      </Reveal>
      <Reveal as="article" className="sk-card sk-card-wide sk-card-silk">
        <h3>Report-Ready</h3><p>Findings flow into <b>a structured draft</b> you can edit, approve and export after review.</p>
        <div className="sk-table" role="table" aria-label="Example findings"><div role="row" className="sk-table-head"><span role="columnheader">Finding</span><span role="columnheader">Zone</span><span role="columnheader">Image</span></div>{findings.map(([f, z, im, t]) => <div role="row" key={f + z}><span role="cell"><FileText size={13} />{f}<small>{t}</small></span><span role="cell">{z}</span><span role="cell"><img src={img(im)} alt="" loading="lazy" /></span></div>)}</div>
      </Reveal>
      <Reveal as="article" className="sk-card sk-card-dial">
        <h3>Seconds per Read</h3><p>In the benchmark run, Skanda's main read took <b>about 15 seconds</b> per chest film.</p>
        <Stopwatch />
      </Reveal>
    </div>
  </section>
}

function Stopwatch() {
  return <div className="sk-dial" aria-hidden="true">
    <svg viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="96" className="sk-dial-rim" />
      <circle cx="100" cy="100" r="86" className="sk-dial-face" />
      {Array.from({ length: 60 }, (_, i) => { const a = (i / 60) * Math.PI * 2; const long = i % 5 === 0; return <line key={i} x1={100 + Math.sin(a) * (long ? 70 : 76)} y1={100 - Math.cos(a) * (long ? 70 : 76)} x2={100 + Math.sin(a) * 82} y2={100 - Math.cos(a) * 82} className={long ? 'sk-tick-l' : 'sk-tick'} /> })}
      {[0, 5, 10, 15, 20, 25].map((s) => { const a = (s / 30) * Math.PI * 2; return <text key={s} x={100 + Math.sin(a) * 58} y={104 - Math.cos(a) * 58}>{s}</text> })}
      <path d="M100 100 L100 14 A86 86 0 0 1 100 186 Z" className="sk-dial-sweep" />
      <g className="sk-hand-min"><line x1="100" y1="112" x2="100" y2="44" /></g>
      <g className="sk-hand-sec"><line x1="100" y1="118" x2="100" y2="22" /></g>
      <circle cx="100" cy="100" r="4" fill="#fff" />
    </svg>
  </div>
}

/* ------------------------------------------------------------------ 11 · evidence */
export function Evidence() {
  const [s, m, a] = [models[0], models[1], models[2]]
  const notes = [
    { stat: `${frac(s.headline.normals.k, s.headline.normals.n)} normals`, text: `Skanda V1 called ${pct(s.headline.normals.pct)} of normal films normal, the highest of the three models, against ${pct(m.headline.normals.pct)} for MedGemma and MAIRA-2.`, who: 'Specificity · held-out split' },
    { stat: `${pct(s.headline.localised.pct)} localised`, text: `Its boxes landed inside the radiologist's box ${pct(s.headline.localised.pct)} of the time, level with MAIRA-2 (${pct(a.headline.localised.pct)}) and about three times MedGemma (${pct(m.headline.localised.pct)}).`, who: 'Localisation · box centre in reference' },
    { stat: `${frac(s.sensitivity.Pneumothorax.k, s.sensitivity.Pneumothorax.n)} pneumothorax`, text: `It still misses most pneumothoraces and small nodules, where MedGemma found ${frac(m.sensitivity.Pneumothorax.k, m.sensitivity.Pneumothorax.n)}. That is why every finding stays a draft until a clinician signs it off.`, who: 'Known limitation · same split' },
  ]
  const [i, setI] = useState(0)
  const note = notes[i]
  return <section className="sk-evidence" aria-labelledby="evidence-title">
    <div className="sk-globe" aria-hidden="true" />
    <Reveal><h2 id="evidence-title" className="sk-giant">Evidence</h2></Reveal>
    <Reveal className="sk-evidence-grid">
      <div className="sk-stats"><p><b>111</b><span>Held-out chest films</span></p><p><b>3<sup>×</sup></b><span>Radiologists annotating each film</span></p><p><b>13</b><span>Finding classes scored</span></p></div>
      <div className="sk-quote">
        <div className="sk-quote-top"><span><b>{String(i + 1).padStart(2, '0')}</b> / {String(notes.length).padStart(2, '0')}</span><span className="sk-quote-mark">”</span></div>
        <span className="sk-chip">{note.stat}</span>
        <blockquote key={i}>“{note.text}”</blockquote>
        <div className="sk-quote-foot"><span className="sk-quote-who"><img src="/skanda-mark.png" alt="" /><span><b>ChestX-Det test · 111 films</b><small>{note.who}</small></span></span><span className="sk-arrows"><button aria-label="Previous" onClick={() => setI((i + notes.length - 1) % notes.length)}><ArrowLeft size={14} /></button><button aria-label="Next" onClick={() => setI((i + 1) % notes.length)}><ArrowRight size={14} /></button></span></div>
      </div>
    </Reveal>
  </section>
}

/* ------------------------------------------------------------------ 12 · FAQ */
export function Faqs() {
  return <section className="sk-faqs" id="faqs" aria-labelledby="faq-title">
    <Reveal><h2 id="faq-title" className="sk-h2 sk-center">Frequently Asked <em>Questions</em></h2></Reveal>
    <Accordion.Root type="single" collapsible className="sk-faq-list">{faqs.map(([q, a], i) => <Accordion.Item key={q} value={q} className="sk-faq"><Accordion.Header><Accordion.Trigger><span>{i + 1}. {q}</span><ChevronDown size={15} /></Accordion.Trigger></Accordion.Header><Accordion.Content className="sk-faq-a"><p>{a}</p></Accordion.Content></Accordion.Item>)}</Accordion.Root>
  </section>
}

/* ------------------------------------------------------------------ 13 · closing + footer */
export function Closing() {
  return <section className="sk-close" aria-labelledby="close-title">
    <Reveal><h2 id="close-title">See More.<br />Report Better.</h2><div className="sk-actions"><Pill href="#benchmarks" tone="grey">See benchmarks</Pill><Pill href="/workspace">Open workspace</Pill></div></Reveal>
    <div className="sk-close-mark" aria-hidden="true"><img src="/skanda-mark.png" alt="" /></div>
  </section>
}

const social = [[GitBranch, 'GitHub', 'https://github.com/Hitheshkaranth/skanda-radiology'], [BookOpen, 'Reader guide', 'https://github.com/Hitheshkaranth/skanda-radiology/blob/main/docs/reading-with-skanda.md'], [Sparkles, 'Benchmarks', 'https://github.com/Hitheshkaranth/skanda-radiology/blob/main/benchmark/README.md'], [Package, 'Releases', 'https://github.com/Hitheshkaranth/skanda-radiology/releases']] as const
const repo = 'https://github.com/Hitheshkaranth/skanda-radiology/blob/main/'
export function Footer() {
  const cols = [
    ['Product', [['Workspace', '/workspace'], ['Reads', '#reads'], ['Capabilities', '#capabilities'], ['FAQs', '#faqs']]],
    ['Model', [['Skanda V1', '#model'], ['Benchmarks', '#benchmarks'], ['Approach', '#approach'], ['Evidence', '#benchmarks']]],
    ['Resources', [['Benchmark method', `${repo}benchmark/README.md`], ['Validation', `${repo}benchmark/volume-validation/README.md`], ['Deployment', `${repo}docs/deployment.md`], ['Image provenance', '/landing/provenance.json']]],
    ['About', [['Research & evaluation use', '#faqs'], ['Not a diagnostic device', '#faqs'], ['Public teaching imagery', '/samples/provenance.json'], ['Open source', 'https://github.com/Hitheshkaranth/skanda-radiology']]],
  ] as const
  return <footer className="sk-footer">
    <ul className="sk-social">{social.map(([Icon, name, href]) => <li key={name}><a href={href} target="_blank" rel="noreferrer"><span><Icon size={15} />{name}</span><ArrowUpRight size={14} /></a></li>)}</ul>
    <div className="sk-footer-cols">{cols.map(([title, items]) => <div key={title}><h3>{title}</h3><ul>{items.map(([label, href]) => <li key={label}><a href={href}>{label}</a></li>)}</ul></div>)}</div>
    <p className="sk-copy"><FileCode2 size={12} /> © 2026 VoxelRad AI. Research and evaluation use only. Not a diagnostic device.</p>
  </footer>
}
