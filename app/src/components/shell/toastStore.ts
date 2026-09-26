// OWNER: Agent 5. Minimal module-level toast bus (no JSX here so the file is .ts).

export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  text: string
  kind: ToastKind
}

let toasts: Toast[] = []
const listeners = new Set<() => void>()
let seq = 1

export function toast(text: string, kind: ToastKind = 'info'): void {
  const id = seq++
  toasts = [...toasts, { id, text, kind }]
  listeners.forEach((l) => l())
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id)
    listeners.forEach((l) => l())
  }, 3600)
}

export function subscribeToasts(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function snapshot(): Toast[] {
  return toasts.slice()
}