import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Accordion, Tabs } from 'radix-ui'
import { ArrowRight, ArrowUpRight, Pause, Play, Plus, Minus, Layers3, ScanLine, FileText, Check, RotateCcw, ArrowLeft } from 'lucide-react'
import './landing.css'

const views = [
  { label: 'CT · Axial', image: '/login/ct-poster.webp', title: 'CT brain', detail: 'Move through the volume.', description: 'Play the axial cine or pause to take a closer look.' },
  { label: 'MRI · Axial', image: '/login/mr-axial.webp', title: 'MRI brain', detail: 'A different perspective.', description: 'Explore the same MRI teaching volume in three planes.' },
  { label: 'MRI · Coronal', image: '/login/mr-coronal.webp', title: 'MRI brain', detail: 'See the whole picture.', description: 'Switch views without losing the context of the study.' },
  { label: 'MRI · Sagittal', image: '/login/mr-sagittal.webp', title: 'MRI brain', detail: 'Follow the anatomy.', description: 'Bring another plane into your review.' },
]
const questions = [
  ['What can I open?', 'The workspace supports X-ray images and supported DICOM frames, plus CT and MRI volumes in NRRD format. Included teaching samples let you explore the tools before opening your own study.'],
  ['Is AI analysis available?', 'The viewer and reporting tools are available now. AI analysis requires a configured model server; hosted inference is not enabled yet. When connected, model-generated findings remain drafts for clinician review.'],
  ['How do I get access?', 'Sign in with an account created by your workspace administrator. If you already have a recovery code, choose “Need access or help signing in?” on the sign-in page to set your password.'],
  ['Is this a diagnostic system?', 'VoxelRad AI is a research and evaluation workspace. It is not a clinically validated diagnostic system. Clinical use requires independent validation and qualified professional review.'],
]

function ScanPreview() {
  const [selected, setSelected] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(1)
  const video = useRef<HTMLVideoElement>(null)
  const view = views[selected]
  const tabs = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })
  useLayoutEffect(() => {
    const list = tabs.current
    if (!list) return
    const measure = () => { const active = list.querySelector<HTMLElement>('[data-state=active]'); if (active) setIndicator({ left: active.offsetLeft, width: active.offsetWidth }) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [selected])
  useEffect(() => {
    if (selected !== 0) return
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const stop = () => { if (document.hidden || preference.matches) video.current?.pause() }
    if (!preference.matches) void video.current?.play().catch(() => {})
    preference.addEventListener('change', stop)
    document.addEventListener('visibilitychange', stop)
    return () => { preference.removeEventListener('change', stop); document.removeEventListener('visibilitychange', stop) }
  }, [selected])
  return <div className="lp-preview" data-ui id="preview">
    <div className="lp-preview-top"><span><img src="/skanda-mark.png" alt="" /> Teaching collection</span><span>Interactive preview</span></div>
    <Tabs.Root value={String(selected)} onValueChange={(value) => { setSelected(Number(value)); setZoom(1); setPlaying(false) }}>
    <Tabs.List ref={tabs} className="lp-view-options" aria-label="Choose a teaching scan">
      <span className="lp-tab-indicator" aria-hidden="true" style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }} />
      {views.map((item, index) => <Tabs.Trigger key={item.label} value={String(index)}>{item.label}</Tabs.Trigger>)}
    </Tabs.List>
    <Tabs.Content key={selected} value={String(selected)} className="lp-scan-panel">
    <div className="lp-scan-stage">
      <div className="lp-scan-info"><strong>{view.title}</strong><span>{selected === 0 ? 'Axial cine · 76 slices' : `${view.label.split(' · ')[1]} view`}</span></div>
      <span className="lp-orientation">{selected === 3 ? 'A' : 'R'}</span>
      {selected === 0 ? <video ref={video} style={{ transform: `scale(${zoom})` }} muted loop playsInline preload="metadata" poster={view.image} aria-label="CT brain teaching sample, axial cine" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}><source src="/login/ct-cine.mp4" type="video/mp4" /></video> : <img key={view.image} style={{ transform: `scale(${zoom})` }} src={view.image} alt={`${view.title}, ${view.label.split(' · ')[1].toLowerCase()} teaching slice`} />}
      <div className="lp-scan-tools">
        {selected === 0 && <button onClick={() => { if (playing) video.current?.pause(); else void video.current?.play().catch(() => {}) }} aria-label={playing ? 'Pause CT cine' : 'Play CT cine'}>{playing ? <Pause size={16} /> : <Play size={16} />}<span>{playing ? 'Pause' : 'Play'}</span></button>}
        <button aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z - .25))}><Minus size={16} /></button><output aria-label="Zoom level">{Math.round(zoom * 100)}%</output><button aria-label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom((z) => Math.min(2, z + .25))}><Plus size={16} /></button>
      </div>
      <span className="lp-sample-caption">Public teaching sample</span>
    </div>
    </Tabs.Content>
    </Tabs.Root>
    <div className="lp-preview-bottom" aria-live="polite"><strong>{view.detail}</strong><span>{view.description}</span></div>
  </div>
}

function VolumeIntroduction() {
  const [moving, setMoving] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [angle, setAngle] = useState(-28)
  const [plane, setPlane] = useState('All planes')
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const pause = () => setMoving(false)
    media.addEventListener('change', pause)
    document.addEventListener('visibilitychange', pause)
    return () => { media.removeEventListener('change', pause); document.removeEventListener('visibilitychange', pause) }
  }, [])
  return <div className="lp2-volume" onFocusCapture={() => setMoving(false)}>
    <div className="lp2-volume-heading"><span><Layers3 size={16} aria-hidden="true" /> A study, in three dimensions</span><button onClick={() => setMoving(!moving)} aria-label={moving ? 'Pause 3D motion' : 'Play 3D motion'}>{moving ? <Pause size={15} /> : <Play size={15} />}</button></div>
    <div className="lp2-volume-stage" role="img" aria-label="Illustration of axial, coronal and sagittal MRI planes intersecting in three-dimensional space">
      <div className="lp2-volume-camera" style={{ transform: `rotateX(-17deg) rotateY(${angle}deg)` }}><div className={`lp2-volume-orbit ${moving ? 'is-moving' : ''}`}>
        <div className="lp2-cube-front" /><div className="lp2-cube-back" /><div className="lp2-cube-side" />
        {['Axial', 'Coronal', 'Sagittal'].map((name, index) => <div className={`lp2-image-plane lp2-plane-${index}`} key={name} style={{ opacity: plane === 'All planes' || plane === name ? .96 : .13 }}><img src={views[index + 1].image} alt="" /><span>{name}</span></div>)}
      </div></div>
    </div>
    <div className="lp2-plane-picker" aria-label="Highlight an imaging plane">{['All planes', 'Axial', 'Coronal', 'Sagittal'].map((name) => <button key={name} aria-pressed={name === plane} onClick={() => setPlane(name)}>{name}</button>)}</div>
    <div className="lp2-rotation"><label htmlFor="volume-rotation">Rotate view</label><input id="volume-rotation" type="range" min="-65" max="35" value={angle} onChange={(e) => { setMoving(false); setAngle(Number(e.target.value)) }} /><button aria-label="Reset 3D view" onClick={() => { setAngle(-28); setPlane('All planes'); setMoving(false) }}><RotateCcw size={15} /></button></div>
    <p className="lp2-volume-caption">Public MRI sample · Illustrative plane arrangement</p>
  </div>
}

const demoSteps = [
  { name: 'Explore the image', icon: ScanLine, title: 'Start with the scan.', text: 'Switch between CT and MRI. Play the CT sequence, pause on a slice, and zoom in to see more detail.', hint: 'Try selecting MRI · Coronal in the viewer.' },
  { name: 'Record an observation', icon: Layers3, title: 'Keep your thoughts close.', text: 'In the full workspace, findings stay beside the image they refer to. Try writing a note here to carry into the next step.', hint: 'This demo note stays in this page and is never uploaded.' },
  { name: 'Review the draft', icon: FileText, title: 'Review before you report.', text: 'Bring the evidence and your interpretation together. In the workspace, you can edit and export your report after review.', hint: 'This is a workflow demonstration, not an AI-generated interpretation.' },
]

function GuidedDemo() {
  const [step, setStep] = useState(0)
  const [note, setNote] = useState('')
  const current = demoSteps[step]
  return <div className="lp2-demo-shell">
    <div className="lp2-demo-bar"><span><img src="/skanda-mark.png" alt="" /> VoxelRad AI <span className="lp2-demo-tag">Guided demo</span></span><span>Teaching sample · No account needed</span></div>
    <div className="lp2-demo-layout"><div className="lp2-demo-image"><ScanPreview /></div><div className="lp2-demo-guide">
      <div className="lp2-demo-steps" aria-label="Demo steps">{demoSteps.map((item, index) => <button key={item.name} aria-pressed={index === step} onClick={() => setStep(index)}><span>{index < step ? <Check size={14} /> : index + 1}</span>{item.name}</button>)}</div>
      <div className="lp2-demo-instruction" key={step}><p className="lp2-label">Step {step + 1} of 3</p><h3>{current.title}</h3><p>{current.text}</p>
      {step === 1 && <label className="lp2-demo-note">Your observation<textarea maxLength={500} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: compare the anatomy in another plane." /></label>}
      {step === 2 && <div className="lp2-draft"><span>Example report · Not reviewed</span><h4>Observation</h4><p>{note || 'No observation added. Go back a step to write your own note.'}</p><h4>Impression</h4><p>To be completed by the reviewing clinician.</p></div>}
      <p className="lp2-demo-hint">{current.hint}</p></div>
      <div className="lp2-demo-actions"><button disabled={step === 0} onClick={() => setStep(step - 1)} aria-label="Previous demo step"><ArrowLeft size={18} /></button>{step < 2 ? <button className="lp2-primary" onClick={() => setStep(step + 1)}>Next step <ArrowRight size={17} /></button> : <a className="lp2-primary" href="/workspace">Open workspace <ArrowRight size={17} /></a>}</div>
    </div></div>
  </div>
}

export function LandingPage() {
  useEffect(() => { document.title = 'VoxelRad AI — Your imaging workspace, reimagined' }, [])
  return <div className="landing-page lp2-page">
    <a className="lp-skip" href="#main">Skip to content</a>
    <header className="lp2-header lp2-wrap"><a className="lp2-brand" href="/" aria-label="VoxelRad AI home"><img src="/skanda-mark.png" alt="" /><span>voxelrad<span>AI</span></span></a><nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#for-you">Who it’s for</a><a href="#demo">Try the demo</a></nav><a className="lp2-nav-login" href="/workspace">Sign in <ArrowUpRight size={16} /></a></header>
    <main id="main">
      <section className="lp2-hero lp2-wrap" aria-labelledby="hero-title"><div className="lp2-hero-copy"><p className="lp2-label">The image is just the beginning.</p><h1 id="hero-title">A new view<br />of radiology.</h1><p className="lp2-lead">Go from a scan to a considered report. A browser workspace that brings X-ray, CT, MRI and your clinical thinking into one place.</p><div className="lp2-hero-actions"><a className="lp2-primary" href="#demo"><Play size={16} aria-hidden="true" /> Try the interactive demo</a><a className="lp2-secondary" href="/workspace">Open workspace <ArrowUpRight size={17} /></a></div><div className="lp2-hero-facts"><span><Check size={15} /> Browser-based viewing</span><span><Check size={15} /> Clinician-led review</span></div></div><VolumeIntroduction /></section>
      <section className="lp2-capabilities lp2-wrap" aria-label="Workspace capabilities"><div><strong>X-ray</strong><span>Image review & annotation</span></div><div><strong>CT & MRI</strong><span>Slice navigation & multiplanar views</span></div><div><strong>Findings</strong><span>Evidence beside the image</span></div><div><strong>Reports</strong><span>Draft, review & export</span></div></section>
      <section className="lp2-how lp2-wrap" id="how-it-works" aria-labelledby="how-title"><div className="lp2-section-title"><div><p className="lp2-label">How it works</p><h2 id="how-title">From first look<br />to final review.</h2></div><p>One connected workflow. Open a study, explore the anatomy, and turn your observations into a report you can stand behind.</p></div><div className="lp2-how-grid">
        <article><span className="lp2-step-number">01 / Open</span><h3>Bring in your study.</h3><p>Open supported X-ray images, DICOM frames, or CT and MRI volumes in NRRD format. Start with a teaching sample if you’re just exploring.</p><div className="lp2-file-list"><span><FileText size={18} /> Chest radiograph <small>X-ray</small></span><span><Layers3 size={18} /> Brain volume <small>CT / MRI</small></span></div></article>
        <article><span className="lp2-step-number">02 / Explore</span><h3>Find your perspective.</h3><p>Adjust the window, zoom into detail, and move through slices. Switch between axial, coronal and sagittal views to understand the volume.</p><div className="lp2-mini-planes">{views.slice(1).map(view => <img key={view.image} src={view.image} alt={`${view.label} teaching sample`} loading="lazy" />)}</div></article>
        <article><span className="lp2-step-number">03 / Review</span><h3>Put it into words.</h3><p>Keep findings with the study, refine your impression, and export a reviewed report. When a model is connected, assess its suggestions before using them.</p><div className="lp2-report-line"><span>Findings</span><ArrowRight size={16} /><span>Impression</span><ArrowRight size={16} /><span>Review</span></div></article>
      </div></section>
      <section className="lp2-demo-section" id="demo" aria-labelledby="demo-title"><div className="lp2-wrap"><div className="lp2-section-title"><div><p className="lp2-label">A little less reading. A little more doing.</p><h2 id="demo-title">Take a closer look.</h2></div><p>Try a three-step walkthrough with a real teaching scan. Change the view, add an observation, and see it in a sample draft.</p></div><GuidedDemo /></div></section>
      <section className="lp2-audience lp2-wrap" id="for-you" aria-labelledby="audience-title"><div className="lp2-section-title"><div><p className="lp2-label">Who it’s for</p><h2 id="audience-title">Built for people<br />who look closer.</h2></div><p>For evaluating imaging workflows, learning from anatomy, and exploring model-assisted review.</p></div><div className="lp2-audience-grid">
        <article><span>Clinical evaluation</span><h3>Radiologists & clinicians</h3><p>Explore a focused image-to-report workflow. Keep the source scan visible as you review findings and develop your interpretation.</p><ul><li>Multiplanar CT and MRI review</li><li>Image, findings and report together</li><li>Professional judgment at every step</li></ul></article>
        <article><span>Teaching & learning</span><h3>Residents & educators</h3><p>Make the relationship between planes tangible. Use public samples to practise navigation and discuss observations.</p><ul><li>Included public teaching volumes</li><li>Controls directly on the scan</li><li>A repeatable review workflow</li></ul></article>
        <article><span>Research & development</span><h3>Imaging researchers</h3><p>Connect a supported model server to investigate draft findings and regions alongside their source images.</p><ul><li>Configurable model connection</li><li>Model outputs subject to review</li><li>Hosted inference not yet enabled</li></ul></article>
      </div><p className="lp2-use-note">VoxelRad AI is for research and evaluation. It is not a clinically validated diagnostic system.</p></section>
      <section className="lp2-questions lp2-wrap" aria-labelledby="questions-title"><div><p className="lp2-label">Good to know</p><h2 id="questions-title">A few answers.</h2><p>What’s available, what you need,<br />and where to begin.</p></div><Accordion.Root className="lp-questions" type="single" collapsible>{questions.map(([question, answer], index) => <Accordion.Item className="lp-question" value={String(index)} key={question}><Accordion.Header><Accordion.Trigger>{question}<Plus size={20} aria-hidden="true" /></Accordion.Trigger></Accordion.Header><Accordion.Content className="lp-answer"><p>{answer}</p></Accordion.Content></Accordion.Item>)}</Accordion.Root></section>
      <section className="lp2-close lp2-wrap"><div><img src="/skanda-mark.png" alt="" /><h2>Look closer.<br />Start here.</h2><p>Open the workspace. Give the image your full attention.</p></div><a className="lp2-primary" href="/workspace">Open VoxelRad AI <ArrowRight size={18} /></a></section>
    </main><footer className="lp2-footer lp2-wrap"><a className="lp2-brand" href="/" aria-label="VoxelRad AI home"><img src="/skanda-mark.png" alt="" /><span>voxelrad<span>AI</span></span></a><p>A clearer space for imaging.</p><a href="/workspace">Sign in <ArrowUpRight size={15} /></a><small>voxelradai.com · Public teaching imagery: Slicer CTBrain and MRHead. No patient data is used in this demo.</small></footer>
  </div>
}
