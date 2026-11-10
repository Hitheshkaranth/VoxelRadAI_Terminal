import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Accordion, Tabs } from 'radix-ui'
import { ArrowRight, ArrowUpRight, Pause, Play, Plus, Minus } from 'lucide-react'
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

export function LandingPage() {
  useEffect(() => {
    document.title = 'VoxelRad AI — A clearer view of every study'
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add('lp-in-view'); observer.unobserve(entry.target) } }), { threshold: .12 })
    document.querySelectorAll('.lp-reveal').forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [])
  return <div className="landing-page">
    <a className="lp-skip" href="#main">Skip to content</a>
    <header className="lp-header lp-wrap"><a className="lp-brand" href="/" aria-label="VoxelRad AI home"><img src="/skanda-mark.png" alt="" /><span>voxelrad<span className="lp-ai">AI</span></span></a><nav aria-label="Main navigation"><a href="#workspace">Workspace</a><a href="#workflow">How it works</a><a href="#questions">Questions</a></nav><a className="lp-login" href="/workspace">Sign in <ArrowUpRight size={16} /></a></header>
    <main id="main">
      <section className="lp-hero lp-wrap" aria-labelledby="lp-title">
        <div className="lp-hero-copy"><h1 id="lp-title">Every study.<br /><span>A clearer view.</span></h1><p className="lp-lead">A focused workspace for X-ray, CT and MRI. Explore the image, review the findings, and bring your report together.</p><a className="lp-button" href="/workspace">Open workspace <ArrowRight size={19} /></a><p className="lp-access-note">For research and clinician-led evaluation.</p><div className="lp-hero-foot"><span>X-ray</span><span>CT</span><span>MRI</span><span>One workspace</span></div></div>
        <ScanPreview />
      </section>
      <section className="lp-workspace lp-wrap" id="workspace" aria-labelledby="workspace-title">
        <div className="lp-section-head lp-reveal"><h2 id="workspace-title">More image.<br />Less in the way.</h2><p>The scan takes the space it deserves. Viewing controls stay close, and study context stays within reach.</p></div>
        <div className="lp-planes">
          {views.slice(1).map((view) => <figure className="lp-plane lp-reveal" key={view.image}><div><img src={view.image} alt={`Public MRI brain sample in the ${view.label.split(' · ')[1].toLowerCase()} plane`} loading="lazy" /></div><figcaption><span>{view.label.split(' · ')[1]}</span></figcaption></figure>)}
        </div>
        <div className="lp-plane-caption lp-reveal"><strong>One volume. Three perspectives.</strong><p>Move between axial, coronal and sagittal views. Adjust the window, zoom into detail, or step through slices at your own pace.</p></div>
      </section>
      <section className="lp-workflow" id="workflow" aria-labelledby="workflow-title"><div className="lp-wrap lp-workflow-grid"><div className="lp-workflow-intro lp-reveal"><h2 id="workflow-title">Stay with<br />the study.</h2><p>Your images, findings and report belong in the same conversation.</p><a className="lp-text-link" href="/workspace">Explore your workspace <ArrowUpRight size={18} /></a></div><div className="lp-steps">
        <article className="lp-step lp-reveal"><div><h3>Bring the image into focus.</h3><p>Open a study or start with a teaching sample. Set your view, adjust contrast, and move through the anatomy.</p><div className="lp-mini-controls" data-ui><span>Window / level</span><span>Zoom & pan</span><span>Slice navigation</span></div></div></article>
        <article className="lp-step lp-reveal"><div><h3>Keep evidence in context.</h3><p>Review findings alongside the source image. With a model connected, inspect suggested regions and revise draft findings before they enter your report.</p><p className="lp-feature-note">AI analysis requires a configured model server.</p></div></article>
        <article className="lp-step lp-reveal"><div><h3>Make the report yours.</h3><p>Write and refine the impression, review the study, and export a report. The clinician stays responsible for the final interpretation.</p><div className="lp-report-fragment" data-ui><span>Report workspace</span><strong>Findings → Impression → Review</strong></div></div></article>
      </div></div></section>
      <section className="lp-faq lp-wrap" id="questions" aria-labelledby="questions-title"><div className="lp-reveal"><h2 id="questions-title">Before you<br />begin.</h2></div><Accordion.Root className="lp-questions" type="single" collapsible>{questions.map(([question, answer], index) => <Accordion.Item className="lp-question lp-reveal" value={String(index)} key={question}><Accordion.Header><Accordion.Trigger>{question}<Plus size={20} aria-hidden="true" /></Accordion.Trigger></Accordion.Header><Accordion.Content className="lp-answer"><p>{answer}</p></Accordion.Content></Accordion.Item>)}</Accordion.Root></section>
      <section className="lp-close lp-wrap lp-reveal" aria-labelledby="close-title"><div><h2 id="close-title">Your next study<br />starts here.</h2></div><div><a className="lp-button" href="/workspace">Open workspace <ArrowRight size={19} /></a><p>Already have an account? You’re ready.</p></div></section>
    </main>
    <footer className="lp-footer lp-wrap"><a className="lp-brand" href="/" aria-label="VoxelRad AI home"><img src="/skanda-mark.png" alt="" /><span>voxelrad<span className="lp-ai">AI</span></span></a><p>Look closer. Keep context.</p><a href="/workspace">voxelradai.com <ArrowUpRight size={15} /></a><small>Teaching imagery: public Slicer CTBrain and MRHead samples. Research and evaluation use.</small></footer>
  </div>
}
