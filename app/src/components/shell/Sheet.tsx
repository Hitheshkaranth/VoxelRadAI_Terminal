import { useRef, useId, type ReactNode } from 'react'
import { Dialog } from 'radix-ui'
import { X } from 'lucide-react'
import { ShellButton } from './ShellButton'
import './shell.css'
import './shellAccessibility.css'

interface SheetProps {
  wide?: boolean
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}

/** Radix supplies modal isolation, stacked-dialog Escape handling and focus trapping. */
export function Sheet({ open, onClose, title, subtitle, children, footer, wide }: SheetProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const descriptionId = useId()
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="sh-sheet-backdrop">
        <Dialog.Content ref={cardRef} className={`sh-sheet${wide ? ' sh-sheet--wide' : ''}`}
          aria-describedby={subtitle ? descriptionId : undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            if (!returnFocus.current?.isConnected) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
            cardRef.current?.focus({ preventScroll: true })
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true })
          }}>
          <header className="sh-sheet-head">
            <div>
              <Dialog.Title asChild><h2 className="sh-sheet-title">{title}</h2></Dialog.Title>
              {subtitle && <Dialog.Description asChild><p id={descriptionId} className="sh-sheet-subtitle">{subtitle}</p></Dialog.Description>}
            </div>
            <Dialog.Close asChild><ShellButton className="icon-btn" aria-label={`Close ${title}`}><X aria-hidden="true" /></ShellButton></Dialog.Close>
          </header>
          <div className="sh-sheet-body">{children}</div>
          {footer && <footer className="sh-sheet-foot">{footer}</footer>}
        </Dialog.Content>
      </Dialog.Overlay>
    </Dialog.Portal>
  </Dialog.Root>
}
