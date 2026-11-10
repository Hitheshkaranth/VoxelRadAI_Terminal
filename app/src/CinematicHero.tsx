import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ArrowUpRight, Check, Pause, Play, RotateCcw, Layers3, FileText, ScanLine, Maximize2, Minimize2 } from 'lucide-react'
import './cinematic-hero.css'
import { RollLabel } from './LandingChrome'

const chapters = [
  { name: 'The scan', title: 'Start with the source.', text: 'Explore the anatomy before reviewing any suggestion. The original scan stays beside the finding.', action: 'Show the AI first pass' },
  { name: 'AI attention', title: 'A place to look closer.', text: 'Heatmaps and candidate boxes bring areas of interest into focus. This example illustrates the workflow.', action: 'Review the suggestion' },
  { name: 'Your decision', title: 'The final call is yours.', text: 'Compare the suggestion with the source. Approve this example to carry it into the demonstration report.', action: 'Approve example finding' },
  { name: 'The report', title: 'From evidence to words.', text: 'Reviewed findings feed the draft. The radiologist writes the impression and verifies the final report.', action: 'Replay the story' },
]

export function CinematicHero() {
  const [chapter, setChapter] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [approved, setApproved] = useState(false)
  const [overlay, setOverlay] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [modality, setModality] = useState<'CT' | 'MRI'>('CT')
  const scene = useRef<HTMLDivElement>(null)
  const cine = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const sync = () => setExpanded(document.fullscreenElement === scene.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  const expand = async () => {
    try { if (document.fullscreenElement === scene.current) await document.exitFullscreen(); else await scene.current?.requestFullscreen() } catch { /* Keep the reading room usable if fullscreen is unavailable. */ }
  }
  const current = chapters[chapter]
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    const pause = () => cine.current?.pause()
    if (!preference.matches) void cine.current?.play().catch(() => {})
    const timer = window.setTimeout(pause, 4500)
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => !entry.isIntersecting)) pause() })
    if (scene.current) observer.observe(scene.current)
    const onVisibility = () => { if (document.hidden) pause() }
    preference.addEventListener('change', pause)
    document.addEventListener('visibilitychange', onVisibility)
    return () => { window.clearTimeout(timer); observer.disconnect(); preference.removeEventListener('change', pause); document.removeEventListener('visibilitychange', onVisibility) }
  }, [])
  const select = (index: number) => { cine.current?.pause(); setPlaying(false); setChapter(index); setOverlay(true) }
  const changeStudy = (value: 'CT' | 'MRI') => { select(0); setApproved(false); setModality(value) }
  const advance = () => {
    if (chapter === 2) setApproved(true)
    if (chapter === 3) { setApproved(false); select(0) } else select(chapter + 1)
  }
  return <section className="vr-cinema" data-chapter={chapter} aria-labelledby="hero-title">
    <div className="vr-cinema-heading"><p className="vr-hero-eyebrow"><ScanLine size={14} /> Designed around the read</p>
      <h1 id="hero-title">Intelligent <em>imaging.</em><br /><em>Human</em> judgment.</h1>
      <div className="vr-cinema-intro"><p>From scan to insight. From your review to a report.</p><div className="vr-hero-actions"><a href="/workspace"><RollLabel>Open workspace</RollLabel> <ArrowUpRight size={17} /></a><a className="vr-secondary-action" href="#reading-room"><RollLabel>See how it works</RollLabel> <ArrowRight size={17} /></a></div></div>
    </div>
    <div className="vr-reading-room" id="reading-room" ref={scene}>
      <div className="vr-room-toolbar"><span><img src="/skanda-mark.png" alt="" />VoxelRad AI <b>/ Reading room</b></span><span><ScanLine size={14} /> Public teaching study</span><div className="vr-room-actions"><span className="vr-demo-status">Interactive demo</span><button className="vr-expand-room" disabled={!document.fullscreenEnabled} onClick={() => void expand()} aria-label={expanded ? 'Exit focus view' : 'Expand reading room'} title={expanded ? 'Exit focus view' : 'Expand reading room'}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button></div></div>
      <div className="vr-cinema-scene">
        <aside className="vr-study-rail" aria-label="Choose a teaching study"><p>Studies <span>2</span></p>{(['CT','MRI'] as const).map(value => <button key={value} aria-pressed={modality === value} onClick={() => changeStudy(value)}><img src={value === 'CT' ? '/login/ct-poster.webp' : '/login/mr-axial.webp'} alt="" /><span><strong>{value === 'CT' ? 'CT Brain' : 'MR Head'}</strong><small>{value === 'CT' ? 'Axial cine' : 'Axial view'}</small></span></button>)}<div className="vr-study-info"><Layers3 size={17} /><span>Original imaging<br />Always available</span></div><small>Public teaching samples.<br />No patient data.</small></aside>
        <div className="vr-scan-workspace"><div className="vr-scan-title"><span>{modality === 'CT' ? 'CT Brain' : 'MR Head'} <b>/ Axial</b></span><span>{chapter > 0 && overlay ? 'Illustrative overlay' : 'Source image'}</span></div><div className="vr-scan-assembly"><span className="vr-orientation-top">A</span><span className="vr-orientation-left">R</span><div className="vr-film vr-film-axial">
          {chapter === 0 && modality === 'CT' ? <video ref={cine} muted playsInline preload="metadata" poster="/login/ct-poster.webp" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} aria-label="CT brain teaching cine"><source src="/login/ct-cine.mp4" type="video/mp4" /></video> : <img src={modality === 'CT' ? '/login/ct-poster.webp' : '/login/mr-axial.webp'} alt={`${modality} axial teaching scan`} />}
          {chapter > 0 && overlay && <div className="vr-cinema-overlay" aria-label="Illustrative attention map and candidate box"><i /><span><b>Region for review</b></span></div>}
        </div>
        {chapter === 3 && <div className="vr-cinema-report"><span><FileText size={15} /> REPORT DRAFT</span><h3>Evidence,<br /><em>carried forward.</em></h3><p className="vr-report-reviewed">{approved ? <Check size={16} /> : null}{approved ? 'Example finding approved' : 'No finding approved'}</p><h4>Findings</h4><p>{approved ? 'The reviewed example is included in this demonstration draft.' : 'Return to Your decision to review the example.'}</p><h4>Impression</h4><p>To be completed by the radiologist.</p><footer>Draft only. Final review required.</footer></div>}
        </div><div className="vr-scan-bottom">{chapter === 0 && modality === 'CT' && <button className="vr-cine-control" onClick={() => { if (playing) cine.current?.pause(); else void cine.current?.play().catch(() => {}) }} aria-label={playing ? 'Pause scan motion' : 'Play scan motion'}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? 'Pause scan' : 'Play scan'}</button>}{(chapter === 1 || chapter === 2) && <button className="vr-cine-control vr-compare-control" aria-pressed={!overlay} onClick={() => setOverlay(!overlay)}><Layers3 size={14} />{overlay ? 'Compare with original' : 'Restore AI overlay'}</button>}<span>Teaching image / Not a diagnosis</span></div></div>
        <div className="vr-cinema-caption" aria-live="polite"><div className="vr-review-label"><span>{chapter === 3 ? 'Report' : 'Review assistant'}</span><span>{chapter + 1} / 4</span></div><div className="vr-caption-body"><span className="vr-chapter-symbol">{chapter === 3 ? <FileText size={24} /> : chapter === 2 ? <Check size={24} /> : <ScanLine size={24} />}</span><h2>{current.title}</h2><p>{current.text}</p><button onClick={advance}>{chapter === 2 ? <Check size={16} /> : chapter === 3 ? <RotateCcw size={16} /> : null}<RollLabel>{current.action}</RollLabel>{chapter < 2 && <ArrowRight size={16} />}</button><small>{chapter === 2 ? 'Your approval is required. Nothing is accepted automatically.' : 'Illustrative workflow. Live AI requires a configured model server.'}</small></div></div>
      </div>
      <div className="vr-cinema-bottom"><nav aria-label="Imaging story chapters">{chapters.map((item,index) => <button key={item.name} aria-current={chapter === index ? 'step' : undefined} onClick={() => select(index)}><span>{String(index+1).padStart(2,'0')}</span>{item.name}<i /></button>)}</nav></div>
    </div>
    <p className="vr-hero-disclosure">Explore the workflow with public teaching scans. AI overlays are illustrative.</p>
  </section>
}
