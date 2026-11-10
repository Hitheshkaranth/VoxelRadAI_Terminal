import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ArrowUpRight, Check, Pause, Play, RotateCcw } from 'lucide-react'
import './cinematic-hero.css'

const chapters = [
  { name: 'The scan', title: 'Start with the source.', text: 'Bring CT, MRI or X-ray into one reading workspace. Explore the anatomy before reviewing any suggestion.', action: 'Show the AI first pass' },
  { name: 'AI attention', title: 'A place to look closer.', text: 'Heatmaps and candidate boxes bring areas of interest into focus. These overlays illustrate the workflow.', action: 'Review the suggestion' },
  { name: 'Your decision', title: 'The final call is yours.', text: 'Compare the suggestion with the source image. In the workspace, approve, edit or reject each finding.', action: 'Approve example finding' },
  { name: 'The report', title: 'From evidence to words.', text: 'Reviewed findings feed the report draft. The radiologist completes the impression and verifies the final report.', action: 'Replay the story' },
]

export function CinematicHero() {
  const [chapter, setChapter] = useState(0)
  const [approved, setApproved] = useState(false)
  const [overlay, setOverlay] = useState(true)
  const [playing, setPlaying] = useState(false)
  const scene = useRef<HTMLDivElement>(null)
  const cine = useRef<HTMLVideoElement>(null)
  const current = chapters[chapter]
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    const pause = () => cine.current?.pause()
    if (!preference.matches) {
      void cine.current?.play().catch(() => {})
      const timer = window.setTimeout(pause, 4500)
      const observer = new IntersectionObserver(entries => { if (entries.some(entry => !entry.isIntersecting)) pause() })
      if (scene.current) observer.observe(scene.current)
      const onVisibility = () => { if (document.hidden) pause() }
      preference.addEventListener('change', pause)
      document.addEventListener('visibilitychange', onVisibility)
      return () => { window.clearTimeout(timer); observer.disconnect(); preference.removeEventListener('change', pause); document.removeEventListener('visibilitychange', onVisibility) }
    }
  }, [])
  const select = (index: number) => { cine.current?.pause(); setChapter(index); setOverlay(true) }
  const advance = () => {
    if (chapter === 2) setApproved(true)
    if (chapter === 3) { setApproved(false); select(0) } else select(chapter + 1)
  }
  return <section className="vr-cinema" data-chapter={chapter} aria-labelledby="hero-title">
    <div className="vr-cinema-heading">
      <h1 id="hero-title">Every scan.<br /><span>A closer read.</span></h1>
      <div className="vr-cinema-intro"><p>AI finds areas of interest. <br />Radiologists make the call.</p><a href="/workspace">Enter the workspace <ArrowUpRight size={18} /></a></div>
    </div>
    <div className="vr-cinema-scene" ref={scene}>
      <div className="vr-film-label"><span>VOXELRAD / IMAGING INTELLIGENCE</span><span>CT + MRI + X-RAY</span></div>
      <div className="vr-scan-assembly" aria-label="CT teaching scan with MRI anatomy in the background">
        <div className="vr-film vr-film-coronal"><img src="/login/mr-coronal.webp" alt="Coronal MRI teaching view" /><span>MRI / CORONAL</span></div>
        <div className="vr-film vr-film-sagittal"><img src="/login/mr-sagittal.webp" alt="Sagittal MRI teaching view" /><span>MRI / SAGITTAL</span></div>
        <div className="vr-film vr-film-axial"><div className="vr-crosshair vr-crosshair-a" /><div className="vr-crosshair vr-crosshair-b" />
          {chapter === 0 ? <video ref={cine} muted playsInline preload="metadata" poster="/login/ct-poster.webp" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} aria-label="CT brain teaching cine"><source src="/login/ct-cine.mp4" type="video/mp4" /></video> : <img src="/login/ct-poster.webp" alt="Axial CT teaching scan" />}
          {chapter > 0 && overlay && <div className="vr-cinema-overlay" aria-label="Illustrative attention map and candidate box"><i /><span><b>Region for review</b></span></div>}
          <span>CT / AXIAL <em>{chapter === 0 || !overlay ? 'SOURCE IMAGE' : 'ILLUSTRATIVE OVERLAY'}</em></span>
        </div>
      </div>
      {chapter === 3 && <div className="vr-cinema-report"><span>VOXELRAD / REPORT DRAFT</span><h3>Evidence,<br />carried forward.</h3><p className="vr-report-reviewed">{approved ? <Check size={17} /> : null}{approved ? 'Example finding approved' : 'No finding approved'}</p><h4>Findings</h4><p>{approved ? 'The reviewed example is included in this demonstration draft.' : 'Return to Your decision to review the example.'}</p><h4>Impression</h4><p>To be completed by the radiologist.</p><footer>Draft only. Final clinical review required.</footer></div>}
      <div className="vr-cinema-caption" aria-live="polite"><p>{String(chapter + 1).padStart(2,'0')} / THE READING JOURNEY</p><h2>{current.title}</h2><p>{current.text}</p><button onClick={advance}>{chapter === 2 ? <Check size={16} /> : chapter === 3 ? <RotateCcw size={16} /> : null}{current.action}<ArrowRight size={16} /></button></div>
      {chapter === 0 && <button className="vr-cine-control" onClick={() => { if (playing) cine.current?.pause(); else void cine.current?.play().catch(() => {}) }} aria-label={playing ? 'Pause scan motion' : 'Play scan motion'}>{playing ? <Pause size={15} /> : <Play size={15} />}{playing ? 'Pause scan' : 'Play scan'}</button>}
      {(chapter === 1 || chapter === 2) && <button className="vr-cine-control vr-compare-control" aria-pressed={!overlay} onClick={() => setOverlay(!overlay)}>{overlay ? 'Compare with original' : 'Restore AI overlay'} <ArrowRight size={15} /></button>}
    </div>
    <div className="vr-cinema-bottom"><nav aria-label="Imaging story chapters">{chapters.map((item,index) => <button key={item.name} aria-current={chapter === index ? 'step' : undefined} onClick={() => select(index)}><span>{String(index+1).padStart(2,'0')}</span>{item.name}<i /></button>)}</nav><p>Public teaching scans. Illustrative AI, not live inference.</p></div>
  </section>
}
