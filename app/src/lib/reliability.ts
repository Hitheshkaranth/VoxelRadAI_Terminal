import type { Finding } from '../types'

/**
 * How often each type of finding MedGemma 27B reported was supported by the ground-truth labels in the
 * local benchmark (56 chest radiographs: 44 NIH ChestX-ray14 + 12 Kermany pediatric; see benchmark/).
 * The model's self-reported confidence is not calibrated (false findings are typically stated at 0.9+),
 * so this is the better signal to show a reader. Re-run the benchmark and update this table when the
 * model or prompts change.
 */
export const BENCHMARK = {
  label: 'Local benchmark · 56 chest X-rays · Sep 2026',
  normalsClear: [14, 18] as const,
  abnormalFlagged: [28, 38] as const,
}

interface Row {
  kind: string
  match: RegExp
  correct: number
  total: number
}

// Order matters: first match wins (mirrors benchmark/score scoring order).
const ROWS: Row[] = [
  { kind: 'pneumothorax', match: /pneumothorax/i, correct: 3, total: 7 },
  { kind: 'effusion', match: /effusion/i, correct: 1, total: 9 },
  { kind: 'cardiomegaly', match: /cardiomegaly|cardiac enlargement|enlarged (heart|cardiac)/i, correct: 1, total: 7 },
  { kind: 'edema', match: /o?edema|congestion|kerley/i, correct: 1, total: 3 },
  { kind: 'consolidation / opacity', match: /consolidat|opacit|infiltrat|airspace|pneumonia/i, correct: 24, total: 31 },
  { kind: 'interstitial markings', match: /interstitial|markings|reticul/i, correct: 4, total: 4 },
]

export interface Reliability {
  kind: string
  correct: number
  total: number
  /** true when fewer than ~60% of this kind of call were confirmed */
  weak: boolean
}

export function reliabilityFor(f: Finding): Reliability | null {
  if (f.severity === 'normal') return null
  const row = ROWS.find((r) => r.match.test(f.title))
  if (!row) return null
  return { kind: row.kind, correct: row.correct, total: row.total, weak: row.correct / row.total < 0.6 }
}
