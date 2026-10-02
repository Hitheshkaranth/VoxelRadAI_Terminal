// OWNER: Agent 5. Minimal module-level toast bus (no JSX here so the file is .ts).

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastAction {
  label: string
  run: () => void
}

export interface Toast {
  id: number
  text: string
  kind: ToastKind
  /** Optional inline action (e.g. Undo). Action toasts stay up longer so there is time to use them. */
  action?: ToastAction
}

let toasts: Toast[] = []
const listeners = new Set<() => void>()
let seq = 1

const emit = () => listeners.forEach((l) => l())

export function toast(text: string, kind: ToastKind = 'info', action?: ToastAction): void {
  const id = seq++
  toasts = [...toasts, { id, text, kind, action }]
  emit()
  setTimeout(() => dismissToast(id), action ? 8000 : 3600)
}

export function dismissToast(id: number): void {
  if (!toasts.some((t) => t.id === id)) return
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export function subscribeToasts(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function snapshot(): Toast[] {
  return toasts.slice()
}
