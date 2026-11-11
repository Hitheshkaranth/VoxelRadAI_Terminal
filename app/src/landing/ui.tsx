import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Letter-by-letter roll on hover, as on the reference's buttons. The second copy is hidden from assistive tech. */
export function Roll({ children }: { children: string }) {
  const letters = [...children].map((c, i) => <span key={i} style={{ transitionDelay: `${i * 14}ms` }}>{c === ' ' ? ' ' : c}</span>)
  return <span className="sk-roll"><span>{letters}</span><span aria-hidden="true">{letters}</span></span>
}

export function Pill({ href, children, tone = 'light', icon, onClick }: { href?: string; children: string; tone?: 'light' | 'ghost' | 'grey'; icon?: ReactNode; onClick?: () => void }) {
  const body = <><Roll>{children}</Roll>{icon}</>
  return href ? <a className={`sk-pill sk-pill-${tone}`} href={href} onClick={onClick}>{body}</a> : <button type="button" className={`sk-pill sk-pill-${tone}`} onClick={onClick}>{body}</button>
}

/** Adds data-in once the element scrolls into view; CSS drives the reveal. */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { el.dataset.in = 'true'; io.disconnect() } }, { rootMargin: '0px 0px -12% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return ref
}

export function Reveal({ as: Tag = 'div', className, children, ...rest }: { as?: 'div' | 'section' | 'article' | 'header'; className?: string; children: ReactNode; id?: string; 'aria-labelledby'?: string }) {
  const ref = useReveal<HTMLDivElement>()
  return <Tag ref={ref} className={`sk-reveal ${className ?? ''}`} {...rest}>{children}</Tag>
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

export const pct = (v: number, digits = 0) => `${v.toFixed(digits)}%`
export const frac = (k: number, n: number) => `${Number.isInteger(k) ? k : k.toFixed(1)} / ${Number.isInteger(n) ? n : n.toFixed(1)}`
