import { ShellButton } from './ShellButton'
// OWNER: Agent 5. Renders active toasts as a small macOS-style pill stack.
import { useEffect, useState } from 'react'
import { CheckCircle2, Info, X } from 'lucide-react'
import { dismissToast, snapshot, subscribeToasts, type Toast } from './toastStore'

export function Toasts() {
  const [items, setItems] = useState<Toast[]>([])

  useEffect(() => subscribeToasts(() => setItems(snapshot())), [])

  if (!items.length) return null

  return (
    <div className="sh-toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`sh-toast sh-toast--${t.kind}`}>
          <Mark kind={t.kind} />
          {t.text}
          {t.action && (
            <ShellButton
              type="button"
              className="sh-toast-action"
              onClick={() => {
                t.action!.run()
                dismissToast(t.id)
              }}
            >
              {t.action.label}
            </ShellButton>
          )}
        </div>
      ))}
    </div>
  )
}

function Mark({ kind }: { kind: 'info' | 'success' | 'error' }) {
  const common: React.SVGProps<SVGSVGElement> = { width: 16, height: 16, 'aria-hidden': true }
  if (kind === 'success') return <CheckCircle2 {...common} />
  if (kind === 'error') return <X {...common} />
  return <Info {...common} />
}
