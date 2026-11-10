import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Menu, X } from 'lucide-react'

export function RollLabel({ children }: { children: string }) {
  const letters = [...children].map((letter, index) => <span className="vr-roll-letter" key={index} style={{ transitionDelay: `${index * 12}ms` }}>{letter === ' ' ? '\u00a0' : letter}</span>)
  return <span className="vr-roll"><span>{letters}</span><span aria-hidden="true">{letters}</span></span>
}

const links = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#demo', label: 'Try the demo' },
  { href: '#for-you', label: 'Who it is for' },
  { href: '#questions', label: 'Questions' },
]

export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false)
  const [active, setActive] = useState('')
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 90)
    update()
    window.addEventListener('scroll', update, { passive: true })
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting)
      if (visible.length) setActive(`#${visible[0].target.id}`)
    }, { rootMargin: '-100px 0px -60% 0px', threshold: 0 })
    links.forEach(link => { const target = document.querySelector(link.href); if (target) observer.observe(target) })
    return () => { window.removeEventListener('scroll', update); observer.disconnect() }
  }, [])
  useEffect(() => {
    if (!open) return
    const el = dialog.current
    const button = trigger.current
    const previous = document.documentElement.style.overflow
    el?.showModal()
    document.documentElement.style.overflow = 'hidden'
    return () => { document.documentElement.style.overflow = previous; el?.close(); button?.focus({ preventScroll: true }) }
  }, [open])
  return <div className="vr-nav-shell" data-scrolled={scrolled}><header className="lp2-header lp2-wrap">
    <a className="lp2-brand" href="/" aria-label="VoxelRad AI home"><img src="/skanda-mark.png" alt="" /><span>voxelrad<span>AI</span></span></a>
    <nav aria-label="Main navigation">{links.map(link => <a key={link.href} href={link.href} aria-current={active === link.href && scrolled ? 'location' : undefined}><RollLabel>{link.label}</RollLabel></a>)}</nav>
    <a className="lp2-nav-login" href="/workspace"><RollLabel>Sign in</RollLabel><ArrowUpRight size={15} /></a>
    <button ref={trigger} className="vr-menu-trigger" aria-label="Open navigation" aria-expanded={open} aria-controls="landing-menu" onClick={() => setOpen(true)}><Menu size={19} /></button>
    <dialog ref={dialog} className="vr-menu-dialog" id="landing-menu" onClose={() => setOpen(false)} onCancel={() => setOpen(false)} aria-label="Navigation">
      <div className="vr-menu-top"><a className="lp2-brand" href="/" aria-label="VoxelRad AI home"><img src="/skanda-mark.png" alt="" /><span>voxelrad<span>AI</span></span></a><button aria-label="Close navigation" onClick={() => setOpen(false)}><X size={21} /></button></div>
      <nav aria-label="Mobile navigation">{links.map((link,index) => <a key={link.href} href={link.href} onClick={() => setOpen(false)}><span>{String(index + 1).padStart(2,'0')}</span>{link.label}<ArrowUpRight size={18} /></a>)}</nav>
      <div className="vr-menu-bottom"><p>A connected reading room.<br />A decision that stays yours.</p><a className="lp2-primary" href="/workspace">Open workspace <ArrowUpRight size={16} /></a><small>voxelradai.com</small></div>
    </dialog>
  </header></div>
}
