import { ArrowUpRight, ScanLine, Layers3, Play, ZoomIn, Move, Pencil, FileText, Check, Download, Brain } from 'lucide-react'
import { RollLabel } from './LandingChrome'

const scans = [
  { image: 'mr-coronal.webp', name: 'MRI / Coronal' },
  { image: 'ct-poster.webp', name: 'CT / Axial' },
  { image: 'mr-sagittal.webp', name: 'MRI / Sagittal' },
  { image: 'mr-axial.webp', name: 'MRI / Axial' },
]

export function ScanCollection() {
  return <section className="vr-collection" aria-labelledby="collection-title">
    <div className="vr-collection-copy"><h2 id="collection-title">See the detail.<br />Keep the context.</h2><p>Different planes. One connected study. Explore real teaching scans, keep the source close, and follow each observation through to your report.</p><a className="lp2-primary" href="#demo"><RollLabel>Explore the viewer</RollLabel><ArrowUpRight size={15} /></a></div>
    <div className="vr-scan-gallery">{[...scans, ...scans].map((scan, index) => <figure key={index} aria-hidden={index > 3 ? true : undefined}><figcaption><span>{scan.name}</span><span>Teaching study</span></figcaption><img src={`/login/${scan.image}`} alt={index < 4 ? `${scan.name} public teaching scan` : ''} loading="lazy" /><span className="vr-gallery-cross" aria-hidden="true">+</span></figure>)}</div>
  </section>
}

const tools = [
  { icon: ScanLine, name: 'CT & MRI', detail: 'Volume review' },
  { icon: Layers3, name: 'Multiplanar', detail: 'Image navigation' },
  { icon: Play, name: 'Cine playback', detail: 'Explore each slice' },
  { icon: ZoomIn, name: 'Zoom & inspect', detail: 'Closer examination' },
  { icon: Move, name: 'On-image controls', detail: 'Stay with the scan' },
  { icon: Pencil, name: 'Annotations', detail: 'Record observations' },
  { icon: Brain, name: 'Model connection', detail: 'Requires setup' },
  { icon: Check, name: 'Clinician review', detail: 'Your decision' },
  { icon: FileText, name: 'Report drafts', detail: 'Bring findings together' },
  { icon: Download, name: 'Export', detail: 'After your review' },
]

export function ImagingTools() {
  return <section className="vr-tools lp2-wrap" aria-labelledby="tools-title"><div className="vr-tools-heading"><h2 id="tools-title">A clearer space.<br />For every read.</h2><div><a className="lp2-primary" href="#demo"><RollLabel>Explore the tools</RollLabel></a><a className="vr-quiet-action" href="/workspace"><RollLabel>Open workspace</RollLabel></a></div></div><div className="vr-tool-grid">{tools.map(({ icon: Icon, name, detail }) => <div key={name}><Icon size={30} strokeWidth={1.6} /><p>{name}<br /><span>{detail}</span></p></div>)}</div></section>
}
