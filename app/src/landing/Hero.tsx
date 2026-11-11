import { useEffect, useRef, useState } from 'react'
import { AlignCenterHorizontal, AlignEndHorizontal, AlignStartHorizontal, AlignStartVertical, AlignCenterVertical, AlignEndVertical, ChevronDown, ChevronRight, Contrast, Eye, EyeOff, Hand, Layers, Menu, MousePointer2, ScanLine, Search, Sparkles, X, ArrowUpRight } from 'lucide-react'
import { studies, img, type Modality } from './data'
import { Pill, Roll } from './ui'

const links = [['Home', '#top'], ['Model', '#model'], ['Reads', '#reads'], ['Capabilities', '#capabilities'], ['Benchmarks', '#benchmarks'], ['FAQs', '#faqs']] as const

export function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const on = () => setScrolled(scrollY > 40)
    on()
    addEventListener('scroll', on, { passive: true })
    return () => removeEventListener('scroll', on)
  }, [])
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close() }, [open])
  return <header className="sk-nav" data-scrolled={scrolled}>
    <div className="sk-nav-inner">
      <a className="sk-brand" href="#top" aria-label="VoxelRad AI home"><img src="/skanda-mark.png" alt="" /><span>VoxelRad</span></a>
      <nav aria-label="Main">{links.map(([label, href], i) => <a key={href} href={href} aria-current={i === 0 ? 'page' : undefined}><Roll>{label}</Roll></a>)}</nav>
      <div className="sk-nav-end">
        <span className="sk-serving" title="Base model"><i aria-hidden="true" />Skanda V1</span>
        <a className="sk-pill sk-pill-light sk-pill-sm" href="/workspace"><Roll>Open workspace</Roll></a>
        <button className="sk-menu" aria-label="Open menu" onClick={() => setOpen(true)}><Menu size={20} /></button>
      </div>
    </div>
    <dialog ref={dialog} className="sk-sheet" onClose={() => setOpen(false)} aria-label="Menu">
      <div className="sk-sheet-top"><a className="sk-brand" href="#top" onClick={() => setOpen(false)}><img src="/skanda-mark.png" alt="" /><span>VoxelRad</span></a><button aria-label="Close menu" onClick={() => setOpen(false)}><X size={22} /></button></div>
      <ol>{links.map(([label, href], i) => <li key={href}><a href={href} onClick={() => setOpen(false)}><span>{String(i + 1).padStart(2, '0')}</span>{label}<ArrowUpRight size={18} /></a></li>)}</ol>
      <Pill href="/workspace">Open workspace</Pill>
    </dialog>
  </header>
}

const modalities: Modality[] = ['X-ray', 'CT', 'MRI']

function ReadingRoom() {
  const [modality, setModality] = useState<Modality>('X-ray')
  const visible = studies.filter((s) => s.modality === modality)
  const [studyId, setStudyId] = useState(studies[0].id)
  const study = studies.find((s) => s.id === studyId) ?? visible[0]
  const [overlay, setOverlay] = useState(true)
  const [holding, setHolding] = useState(false)
  const [tab, setTab] = useState<'Studies' | 'Layers' | 'Findings'>('Layers')
  const [zoom, setZoom] = useState(1)
  const showOverlay = (overlay && !holding) || !study.source
  const pickModality = (m: Modality) => { setModality(m); setStudyId(studies.find((s) => s.modality === m)!.id); setOverlay(true); setZoom(1) }
  return <div className="sk-room" aria-label="Interactive reading room">
    <div className="sk-room-bar">
      <span className="sk-room-logo"><img src="/skanda-mark.png" alt="" /><ChevronRight size={14} /></span>
      <div className="sk-room-center">
        <div className="sk-seg" role="tablist" aria-label="Modality">{modalities.map((m) => <button key={m} role="tab" aria-selected={m === modality} onClick={() => pickModality(m)}>{m}</button>)}</div>
        <span className="sk-readout"><b>{study.window}</b><i /> {Math.round(zoom * 100)}%</span>
      </div>
      <span className="sk-room-people" aria-label="Skanda V1 serving, clinician reviewing"><span className="sk-av sk-av-model">S1</span><span className="sk-av sk-av-dr">Dr</span></span>
    </div>
    <div className="sk-room-body">
      <aside className="sk-room-left">
        <div className="sk-tabs">{(['Studies', 'Layers', 'Findings'] as const).map((t) => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}</div>
        <label className="sk-select"><ScanLine size={14} /><select value={study.id} onChange={(e) => setStudyId(e.target.value)} aria-label="Study">{visible.map((s) => <option key={s.id} value={s.id}>{s.title} · {s.id}</option>)}</select><ChevronDown size={14} /></label>
        {tab === 'Studies' && <ul className="sk-tree">{studies.map((s) => <li key={s.id}><button aria-current={s.id === study.id} onClick={() => { setModality(s.modality); setStudyId(s.id) }}><img src={img(s.source ?? s.overlay)} alt="" /><span>{s.title}<small>{s.modality} · {s.id}</small></span></button></li>)}</ul>}
        {tab === 'Layers' && <ul className="sk-tree">{study.layers.map((layer, i) => <li key={layer}><button aria-current={i === 0 ? !showOverlay : showOverlay && i === 1} onClick={() => setOverlay(i !== 0)} disabled={!study.source && i === 0}><ChevronRight size={12} /><Layers size={13} /><span>{layer}</span>{i > 0 && (showOverlay ? <Eye size={13} /> : <EyeOff size={13} />)}</button></li>)}</ul>}
        {tab === 'Findings' && <ul className="sk-tree"><li><button aria-current><Sparkles size={13} /><span>{study.finding}<small>{study.region}</small></span></button></li><li className="sk-tree-note">Draft · needs clinician review</li></ul>}
      </aside>
      <div className="sk-canvas" onPointerDown={() => setHolding(true)} onPointerUp={() => setHolding(false)} onPointerLeave={() => setHolding(false)}>
        <div className="sk-canvas-frame" style={{ transform: `scale(${zoom})` }}>
          {study.source && <img src={img(study.source)} alt={`${study.title}, ${study.series}, source image`} draggable={false} />}
          <img className="sk-canvas-overlay" data-on={showOverlay} src={img(study.overlay)} alt={`${study.title} with ${study.evidence.toLowerCase()}`} draggable={false} />
          <span className="sk-canvas-tag" data-kind={study.overlayKind}>{showOverlay ? (study.overlayKind === 'recorded' ? 'Recorded model output' : 'Illustrative overlay') : 'Source image'}</span>
        </div>
        <span className="sk-canvas-hint">{study.source ? 'Press & hold to see the source' : 'Recorded output only'}</span>
        <div className="sk-toolbar" onPointerDown={(e) => e.stopPropagation()}>
          <button aria-label="Select" aria-pressed="true"><MousePointer2 size={15} /></button>
          <button aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.6, z + 0.2))}><Search size={15} /></button>
          <button aria-label="Reset zoom" onClick={() => setZoom(1)}><Hand size={15} /></button>
          <button className="sk-toolbar-text" onClick={() => setZoom(1)}>{zoom === 1 ? '1×' : `${zoom.toFixed(1)}×`}</button>
          <button aria-label="Toggle overlay" aria-pressed={showOverlay} onClick={() => setOverlay((v) => !v)} disabled={!study.source}><Contrast size={15} /></button>
          <button aria-label="Layers" onClick={() => setTab('Layers')}><Layers size={15} /></button>
        </div>
      </div>
      <aside className="sk-room-right">
        <div className="sk-align" aria-hidden="true">{[AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal].map((Icon, i) => <Icon key={i} size={14} />)}</div>
        <h4>Finding</h4>
        <dl><dt>Type</dt><dd><span className="sk-field">{study.finding}</span></dd></dl>
        <h4>Region <span>+</span></h4>
        <dl><dt>Zone</dt><dd><span className="sk-field">{study.region}</span></dd><dt>Series</dt><dd><span className="sk-field sk-field-wide">{study.series}</span></dd></dl>
        <h4>Evidence</h4>
        <dl><dt>Source</dt><dd><span className="sk-field sk-field-wide">{study.evidence}</span></dd><dt>Model</dt><dd><span className="sk-field">{study.model}</span><span className="sk-field sk-field-sm">{study.modality}</span></dd></dl>
        <h4>Review</h4>
        <dl><dt>Status</dt><dd><span className="sk-field sk-field-wide">Draft · clinician decides</span></dd></dl>
      </aside>
    </div>
  </div>
}

export function Hero() {
  return <section className="sk-hero" id="top" aria-labelledby="hero-title">
    <div className="sk-hero-glow" aria-hidden="true" />
    <div className="sk-hero-copy">
      <p className="sk-eyebrow">Skanda V1 · Base model</p>
      <h1 id="hero-title"><span>Grounded <em>Radiology</em></span><span><i>Visible</i> Evidence</span></h1>
      <p className="sk-lead">X-ray, CT and MRI reads that point to the pixels behind every finding.</p>
      <div className="sk-actions"><Pill href="/workspace">Open workspace</Pill><Pill href="#benchmarks" tone="ghost">See benchmarks</Pill></div>
    </div>
    <ReadingRoom />
  </section>
}
