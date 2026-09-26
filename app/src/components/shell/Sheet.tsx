// OWNER: Agent 5. Shared macOS-style sheet: spring pop, dim backdrop, Esc/backdrop close, focus trap.
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import './shell.css'

interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

export function Sheet({ open, onClose, title, subtitle, children, footer }: SheetProps) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const lastFocused = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    lastFocused.current = document.activeElement as HTMLElement | null
    cardRef.current?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (!open) return
    const node = backdropRef.current

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const dialog = backdropRef.current?.querySelector<HTMLElement>('.sh-sheet')
      if (!dialog) return
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (focusables.length === 0) {
        e.preventDefault()
        cardRef.current?.focus()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (e.shiftKey) {
        if (active === first || active === dialog || active?.contains(dialog)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || active === backdropRef.current) {
        e.preventDefault()
        first.focus()
      }
    }

    node?.addEventListener('keydown', onKey)
    return () => {
      node?.removeEventListener('keydown', onKey)
      lastFocused.current?.focus?.()
      lastFocused.current = null
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={backdropRef}
      className="sh-sheet-backdrop"
      onMouseDown={(e) => {
        if (e.target === backdropRef.current) onClose()
      }}
    >
      <div
        ref={cardRef}
        className="sh-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="sh-sheet-head">
          <div>
            <h2 className="sh-sheet-title">{title}</h2>
            {subtitle && <p className="sh-sheet-subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </header>

        <div className="sh-sheet-body">{children}</div>

        {footer && <footer className="sh-sheet-foot">{footer}</footer>}
      </div>
    </div>
  )
}