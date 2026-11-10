import { useEffect, useRef } from 'react'
import { ArrowDown, ArrowUpRight } from 'lucide-react'
import './workspace-showcase.css'

const previews = [
  { image: 'ct-review', title: 'Explore the scan', detail: 'CT / Source imaging', chapter: 0, modality: 'CT' as const },
  { image: 'mri-review', title: 'See another perspective', detail: 'MRI / Source imaging', chapter: 0, modality: 'MRI' as const },
  { image: 'ai-attention', title: 'Find a place to look closer', detail: 'AI attention / Illustrative overlay', chapter: 1, modality: 'CT' as const },
  { image: 'clinician-review', title: 'Make the final call', detail: 'Radiologist / Explicit approval', chapter: 2, modality: 'CT' as const },
  { image: 'report-draft', title: 'Carry the evidence forward', detail: 'Reporting / Demonstration draft', chapter: 3, modality: 'CT' as const },
]

export function WorkspaceShowcase({ onExplore }: { onExplore: (chapter: number, modality: 'CT' | 'MRI') => void }) {
  const section = useRef<HTMLElement>(null)
  useEffect(() => {
    const element = section.current
    if (!element) return
    const media = matchMedia('(prefers-reduced-motion: reduce), (max-width: 760px)')
    let frame = 0
    const render = () => {
      frame = 0
      if (media.matches) { element.style.removeProperty('--travel'); element.style.removeProperty('--orbit'); return }
      const rect = element.getBoundingClientRect()
      if (rect.bottom < 0 || rect.top > innerHeight) return
      const progress = Math.max(0, Math.min(1, -rect.top / Math.max(1, rect.height - innerHeight)))
      element.style.setProperty('--travel', `${(progress - .5) * 150}px`)
      element.style.setProperty('--orbit', `${(progress - .5) * 20}deg`)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(render) }
    render()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    media.addEventListener('change', schedule)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); media.removeEventListener('change', schedule) }
  }, [])
  return <section ref={section} className="vr-workspace-showcase" id="workspace-showcase" aria-labelledby="workspace-showcase-title">
    <div className="vr-showcase-sticky">
      <div className="vr-showcase-light" aria-hidden="true" />
      <div className="vr-showcase-heading"><p>Inside VoxelRad AI</p><h2 id="workspace-showcase-title">Your <em>workspace.</em></h2><span>From the first slice to the final review.</span></div>
      <div className="vr-showcase-space">{previews.map((preview, index) => <a className={`vr-showcase-shot vr-showcase-shot-${index}`} key={preview.image} href="#reading-room" onClick={() => onExplore(preview.chapter, preview.modality)} aria-label={`Explore ${preview.title.toLowerCase()} in the interactive demo`}>
        <img src={`/showcase/${preview.image}.jpg`} alt="" loading="lazy" width="1364" height="600" />
        <div><span><small>{preview.detail}</small><strong>{preview.title}</strong></span><ArrowUpRight size={19} /></div>
      </a>)}</div>
      <div className="vr-showcase-caption"><span><ArrowDown size={15} /> Scroll to explore · Select a preview to try it</span><small>Public teaching scans. AI overlays and reports are illustrative.</small></div>
    </div>
  </section>
}
