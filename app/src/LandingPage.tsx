import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Accordion, Tabs } from 'radix-ui'
import { ArrowRight, ArrowUpRight, Pause, Play, Plus, Minus, Layers3, ScanLine, FileText, Check, RotateCcw, ArrowLeft } from 'lucide-react'
import './landing.css'
import { CinematicHero } from './CinematicHero'

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

const flowSteps = [
  { title: 'Add a scan', text: 'Open an X-ray, CT or MRI study. The original image stays available throughout the review.', action: 'Run illustrative AI review' },
  { title: 'See the AI first pass', text: 'Heatmaps draw attention to candidate regions. Boxes locate areas to inspect. These are suggestions, not a diagnosis.', action: 'Review the suggestion' },
  { title: 'Review and approve', text: 'The radiologist checks each suggestion against the scan, then approves, edits or rejects it. The clinical decision stays with you.', action: 'Approve example finding' },
  { title: 'Build the report', text: 'Reviewed findings help form a report draft. Refine the impression and complete a final review before exporting.', action: 'Start again' },
]

function ReviewFlow({ hero = false }: { hero?: boolean }) {
  const flowRef = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(0)
  const [approved, setApproved] = useState(false)
  const [playing, setPlaying] = useState(() => hero && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [modality, setModality] = useState('CT')
  const [overlay, setOverlay] = useState(true)
  const current = flowSteps[step]
  useEffect(() => {
    if (!playing || step >= 2) return
    const timer = window.setTimeout(() => { setStep(step + 1); if (step === 1) setPlaying(false) }, 2600)
    return () => window.clearTimeout(timer)
  }, [playing, step])
  useEffect(() => {
    const pause = () => { if (document.hidden) setPlaying(false) }
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const reduce = () => { if (preference.matches) setPlaying(false) }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => !entry.isIntersecting)) setPlaying(false) })
    if (flowRef.current) observer.observe(flowRef.current)
    preference.addEventListener('change', reduce)
    document.addEventListener('visibilitychange', pause)
    return () => { observer.disconnect(); preference.removeEventListener('change', reduce); document.removeEventListener('visibilitychange', pause) }
  }, [])
  const advance = () => {
    setPlaying(false)
    if (step === 2) setApproved(true)
    if (step === 3) { setStep(0); setApproved(false) } else setStep(step + 1)
  }
  return <div ref={flowRef} id={hero ? "hero-review" : undefined} className={`lp3-flow ${hero ? "lp4-hero-flow" : ""}`} data-current-step={step} data-approved={approved}>
    <ol className="lp3-flow-nav" aria-label="Scan to report workflow">{flowSteps.map((item,index) => <li key={item.title}><button aria-current={step === index ? 'step' : undefined} onClick={() => { setPlaying(false); setStep(index) }}><span>{index + 1}</span>{item.title}</button></li>)}</ol>
    <div className="lp3-flow-progress" aria-hidden="true"><span style={{ transform: `scaleX(${(step + 1) / 4})` }} /></div>
    <div className="lp3-flow-body">
      <div className="lp3-flow-visual" data-step={step}>
        <div className="lp3-flow-scene">
          {step === 1 && <div className="lp3-analysis-caption" aria-hidden="true">Illustrating AI attention</div>}
          <div className="lp3-flow-scan"><div className="lp3-scan-header"><ScanLine size={15} /><span>{modality} teaching scan</span><span>Source image</span></div><img src={modality === 'CT' ? '/login/ct-poster.webp' : '/login/mr-axial.webp'} alt={`${modality} teaching scan with illustrative review overlays`} />
          {step > 0 && overlay && <div key={`${step}-${modality}`} className="lp3-evidence" aria-label="Illustrative heatmap and candidate box, not a model result">{step === 1 && <div className="lp3-scan-sweep" />}<div className="lp3-heatmap" /><div className="lp3-detection-box"><span>Candidate region</span></div></div>}
          <div className="lp3-scan-footer"><span>{step === 0 ? 'Ready for review' : 'Illustrative overlay'}</span><span>{step > 1 && approved ? 'Reviewed in demo' : 'Not reviewed'}</span></div></div>
          <div className={`lp3-finding-card ${step > 0 ? 'is-visible' : ''}`}><span className="lp3-card-label">{step > 1 ? 'Radiologist review' : 'AI first pass'}</span><strong>{approved ? 'Example approved' : 'Candidate finding'}</strong><p>{approved ? 'Added to this demonstration draft.' : 'Compare the highlighted region with the original scan.'}</p><span className="lp3-review-status">{approved ? <Check size={16} /> : <Layers3 size={16} />}{approved ? 'Reviewed' : 'Needs your review'}</span></div>
          <div className={`lp3-flow-report ${step === 3 ? 'is-visible' : ''}`}><FileText size={23} /><span>REPORT DRAFT</span><h3>Your review.<br />In your report.</h3><div><strong>Findings</strong><p>{approved ? 'Example finding approved in this demo.' : 'No finding approved. Return to step 3 to review.'}</p></div><div><strong>Impression</strong><p>To be written and verified by the radiologist.</p></div><span className="lp3-report-status">Draft · Final review required</span></div>
        </div>
        <div className="lp3-flow-tools"><div aria-label="Teaching scan modality">{['CT','MRI'].map(value => <button key={value} aria-pressed={modality === value} onClick={() => setModality(value)}>{value}</button>)}</div>{step > 0 && <button aria-pressed={overlay} onClick={() => setOverlay(!overlay)}>{overlay ? 'Hide overlays' : 'Show overlays'}</button>}<button onClick={() => { setStep(0); setApproved(false); setPlaying(!playing) }}>{playing && step < 2 ? <Pause size={15} /> : <Play size={15} />}{playing && step < 2 ? 'Pause' : 'Play walkthrough'}</button></div>
      </div>
      <div className="lp3-flow-copy" aria-live="polite"><div key={step} className="lp3-step-copy"><p className="lp2-label">{String(step + 1).padStart(2,'0')} / 04</p><h3>{current.title}</h3><p>{current.text}</p>{step === 2 && <p className="lp3-review-hint">Your turn: approve this illustrative finding to see it carried into the report.</p>}<button className="lp2-primary" onClick={advance}>{step === 2 ? <Check size={17} /> : step === 3 ? <RotateCcw size={17} /> : null}{current.action}{step < 2 && <ArrowRight size={17} />}</button><p className="lp3-disclosure">Illustrative workflow, not live inference. No diagnostic finding is made. Hosted AI requires a configured model server.</p></div></div>
    </div>
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
  return <div className="landing-page lp2-page vr-cinematic-page" onKeyDownCapture={(event) => { event.currentTarget.dataset.motionInput = "keyboard" }} onPointerDownCapture={(event) => { event.currentTarget.dataset.motionInput = "pointer" }}>
    <a className="lp-skip" href="#main">Skip to content</a>
    <header className="lp2-header lp2-wrap"><a className="lp2-brand" href="/" aria-label="VoxelRad AI home"><img src="/skanda-mark.png" alt="" /><span>voxelrad<span>AI</span></span></a><nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#for-you">Who it’s for</a><a href="#demo">Try the demo</a></nav><a className="lp2-nav-login" href="/workspace">Sign in <ArrowUpRight size={16} /></a></header>
    <main id="main">
      <CinematicHero />
      <section className="lp2-capabilities lp2-wrap" aria-label="Workspace capabilities"><div><strong>X-ray</strong><span>Image review & annotation</span></div><div><strong>CT & MRI</strong><span>Slice navigation & multiplanar views</span></div><div><strong>Findings</strong><span>Evidence beside the image</span></div><div><strong>Reports</strong><span>Draft, review & export</span></div></section>
      <section className="lp3-flow-section" id="how-it-works" aria-labelledby="flow-title"><div className="lp2-wrap"><div className="lp3-flow-heading"><p className="lp2-label">From scan to report</p><h2 id="flow-title">AI takes the first pass.<br />You make the call.</h2><p>Upload a scan. Let AI highlight areas for attention with heatmaps and boxes. Review the evidence, approve or revise the findings, then bring them into a report.</p></div><div className="lp4-process">{flowSteps.map((item,index) => <article key={item.title}><span>{String(index+1).padStart(2,'0')}</span><h3>{item.title}</h3><p>{item.text}</p></article>)}</div><div className="lp5-workflow" id="hero-review"><ReviewFlow /></div><p className="lp3-flow-benefit">Designed to help radiologists find areas of interest sooner and spend less time assembling reports.</p></div></section>
      <section className="lp2-demo-section" id="demo" aria-labelledby="demo-title"><div className="lp2-wrap"><div className="lp2-section-title"><div><p className="lp2-label">A little less reading. A little more doing.</p><h2 id="demo-title">Meet your workspace.</h2></div><p>Try a three-step walkthrough with a real teaching scan. Change the view, add an observation, and see it in a sample draft.</p></div><GuidedDemo /></div></section>
      <section className="lp2-audience lp2-wrap" id="for-you" aria-labelledby="audience-title"><div className="lp2-section-title"><div><p className="lp2-label">Who it’s for</p><h2 id="audience-title">For people<br />who look closer.</h2></div><p>For evaluating imaging workflows, learning from anatomy, and exploring model-assisted review.</p></div><div className="lp2-audience-grid">
        <article><span>Clinical evaluation</span><h3>Radiologists & clinicians</h3><p>Explore a focused image-to-report workflow. Keep the source scan visible as you review findings and develop your interpretation.</p><ul><li>Multiplanar CT and MRI review</li><li>Image, findings and report together</li><li>Professional judgment at every step</li></ul></article>
        <article><span>Teaching & learning</span><h3>Residents & educators</h3><p>Make the relationship between planes tangible. Use public samples to practise navigation and discuss observations.</p><ul><li>Included public teaching volumes</li><li>Controls directly on the scan</li><li>A repeatable review workflow</li></ul></article>
        <article><span>Research & development</span><h3>Imaging researchers</h3><p>Connect a supported model server to investigate draft findings and regions alongside their source images.</p><ul><li>Configurable model connection</li><li>Model outputs subject to review</li><li>Hosted inference not yet enabled</li></ul></article>
      </div><p className="lp2-use-note">VoxelRad AI is for research and evaluation. It is not a clinically validated diagnostic system.</p></section>
      <section className="lp2-questions lp2-wrap" aria-labelledby="questions-title"><div><p className="lp2-label">Good to know</p><h2 id="questions-title">A few answers.</h2><p>What’s available, what you need,<br />and where to begin.</p></div><Accordion.Root className="lp-questions" type="single" collapsible>{questions.map(([question, answer], index) => <Accordion.Item className="lp-question" value={String(index)} key={question}><Accordion.Header><Accordion.Trigger>{question}<Plus size={20} aria-hidden="true" /></Accordion.Trigger></Accordion.Header><Accordion.Content className="lp-answer"><p>{answer}</p></Accordion.Content></Accordion.Item>)}</Accordion.Root></section>
      <section className="lp2-close lp2-wrap"><div><img src="/skanda-mark.png" alt="" /><h2>Make room<br />for a closer look.</h2><p>Open the workspace. Give the image your full attention.</p></div><a className="lp2-primary" href="/workspace">Open VoxelRad AI <ArrowRight size={18} /></a></section>
    </main><footer className="lp2-footer lp2-wrap"><a className="lp2-brand" href="/" aria-label="VoxelRad AI home"><img src="/skanda-mark.png" alt="" /><span>voxelrad<span>AI</span></span></a><p>A clearer space for imaging.</p><a href="/workspace">Sign in <ArrowUpRight size={15} /></a><small>voxelradai.com · Public teaching imagery: Slicer CTBrain and MRHead. No patient data is used in this demo.</small></footer>
  </div>
}
