import type { Finding } from '../types.ts'
import { SEVERITY_ORDER } from '../types.ts'

/** Abnormal finding ids in the order the Findings panel lists them: by severity, then model order. */
export function reviewOrder(findings: readonly Finding[]): string[] {
  return SEVERITY_ORDER.filter((s) => s !== 'normal').flatMap((severity) => findings.filter((f) => f.severity === severity).map((f) => f.id))
}

/**
 * The next (direction 1) or previous (-1) finding still awaiting a decision, wrapping around the list.
 * With no current finding, starts from the top (or bottom). Returns null when nothing is pending.
 */
export function nextPendingFinding(findings: readonly Finding[], currentId: string | null, direction: 1 | -1 = 1): string | null {
  const order = reviewOrder(findings)
  const pending = new Set(findings.filter((f) => f.severity !== 'normal' && !f.review).map((f) => f.id))
  if (!pending.size) return null
  const n = order.length
  const at = currentId ? order.indexOf(currentId) : -1
  const start = at === -1 ? (direction === 1 ? -1 : n) : at
  for (let step = 1; step <= n; step++) {
    const id = order[(((start + direction * step) % n) + n) % n]
    if (pending.has(id) && id !== currentId) return id
  }
  // Only the current finding is pending.
  return currentId && pending.has(currentId) ? currentId : null
}

/** Pending abnormal findings left to decide. */
export const pendingCount = (findings: readonly Finding[]) => findings.filter((f) => f.severity !== 'normal' && !f.review).length

/** Shortcuts for the 2D image viewer, shown by "?". Keep in step with ImageViewer's key handler. */
export const IMAGE_SHORTCUTS: readonly (readonly [string, string])[] = [
  ['J / K', 'Next / previous finding to review'], ['A', 'Accept selected finding'], ['D', 'Dismiss selected finding'],
  ['U', 'Clear decision on selected finding'], ['Esc', 'Deselect / close tool'], ['← / →', 'Previous / next image'], ['Home / End', 'First / last image'],
  ['N / Shift+N', 'Next / previous study'], ['+ / −', 'Zoom in / out'], ['0', 'Fit to view'], ['R', 'Reset view'],
  ['I', 'Invert'], ['O', 'Findings overlay'], ['H', 'Heatmap'], ['M', 'Overlay style'], ['C', 'Before / after divider'],
  ['L / G', 'Length / angle measure'], ['?', 'Show or hide shortcuts'],
]
