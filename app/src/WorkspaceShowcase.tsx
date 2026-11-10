import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUpRight, Pause, Play } from 'lucide-react'
import './workspace-showcase.css'

const previews = [
  { image: '/login/ct-poster.webp', title: 'Explore the scan', detail: 'CT / Source imaging', chapter: 0, modality: 'CT' as const },
  { image: '/login/mr-axial.webp', title: 'See another perspective', detail: 'MRI / Source imaging', chapter: 0, modality: 'MRI' as const },
  { image: '/login/ct-poster.webp', title: 'Find a place to look closer', detail: 'AI attention / Illustrative overlay', chapter: 1, modality: 'CT' as const },
  { image: '/login/mr-coronal.webp', title: 'Make the final call', detail: 'MRI / Radiologist review', chapter: 2, modality: 'MRI' as const },
  { image: '/showcase/report-draft.jpg', title: 'Carry the evidence forward', detail: 'Reporting / Demonstration draft', chapter: 3, modality: 'CT' as const },
]

export function WorkspaceShowcase({ onExplore }: { onExplore: (chapter: number, modality: 'CT' | 'MRI') => void }) {
  const section = useRef<HTMLElement>(null)
  const [paused, setPaused] = useState(false)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const element = section.current
    if (!element) return
    let intersecting = false
    const update = () => setVisible(intersecting && !document.hidden)
    const observer = new IntersectionObserver(entries => { intersecting = entries[0].isIntersecting; update() })
    observer.observe(element)
    document.addEventListener('visibilitychange', update)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update) }
  }, [])
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
      const radius = Math.min(350, element.clientWidth * .25)
      const pitch = Math.min(150, innerHeight * .16)
      element.querySelectorAll<HTMLElement>('.vr-showcase-shot').forEach((shot, index) => {
        const angle = index * 1.26 + progress * Math.PI * 1.5 - .7
        shot.style.setProperty('--helix-x', `${Math.sin(angle) * radius}px`)
        shot.style.setProperty('--helix-z', `${Math.cos(angle) * radius}px`)
        shot.style.setProperty('--helix-y', `${(index - 2) * pitch - (progress - .5) * 140}px`)
        shot.style.setProperty('--helix-yaw', `${Math.sin(angle) * -42}deg`)
        shot.style.setProperty('--helix-brightness', `${.72 + (Math.cos(angle) + 1) * .14}`)
      })
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(render) }
    render()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    media.addEventListener('change', schedule)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); media.removeEventListener('change', schedule) }
  }, [])
  return <section ref={section} className="vr-workspace-showcase" id="workspace-showcase" aria-labelledby="workspace-showcase-title" data-background-running={visible && !paused}>
    <div className="vr-showcase-sticky">
      <div className="vr-showcase-light" aria-hidden="true" />
      <div className="vr-showcase-heading"><p>Inside VoxelRad AI</p><h2 id="workspace-showcase-title">Your <em>workspace.</em></h2><span>From the first slice to the final review.</span></div>
      <div className="vr-showcase-space"><div className="vr-showcase-orbit">{previews.map((preview, index) => <a className={`vr-showcase-shot vr-showcase-shot-${index}`} key={preview.title} href="#reading-room" onClick={() => onExplore(preview.chapter, preview.modality)} aria-label={`Explore ${preview.title.toLowerCase()} in the interactive demo`}>
        <figure className={index === 4 ? 'vr-showcase-media vr-showcase-report' : 'vr-showcase-media'}><img src={preview.image} alt="" loading="lazy" />{index < 4 && <span className="vr-showcase-orientation" aria-hidden="true">{index === 3 ? 'S' : 'A'}</span>}{index === 2 && <span className="vr-showcase-attention" aria-hidden="true" />}</figure>
        <div><span><small>{preview.detail}</small><strong>{preview.title}</strong></span><ArrowUpRight size={19} /></div>
      </a>)}</div></div>
      <button className="vr-background-toggle" onClick={() => setPaused(value => !value)} aria-label={paused ? 'Play background motion' : 'Pause background motion'} aria-pressed={paused}>{paused ? <Play size={14} /> : <Pause size={14} />}<span>{paused ? 'Play motion' : 'Pause motion'}</span></button>
      <div className="vr-showcase-caption"><span><ArrowDown size={15} /> Scroll to explore · Select a preview to try it</span><small>Public teaching scans. AI overlays and reports are illustrative.</small></div>
    </div>
  </section>
}
