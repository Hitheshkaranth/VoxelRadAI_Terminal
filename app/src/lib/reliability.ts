import type { Finding } from '../types'
import { RELIABILITY } from './reliability.generated.ts'

/**
 * How often each type of finding the model reported was supported by the ground-truth labels in the local
 * benchmark (see benchmark/README.md). The model's self-reported confidence is not calibrated (false findings
 * are typically stated at 0.9+), so this is the better signal to show a reader.
 *
 * The numbers live in reliability.generated.ts, written by `benchmark/score.py --emit-ts`; never edit them by
 * hand. Runtime imports keep an explicit .ts extension so node tests can load this module directly.
 */
export const BENCHMARK: {
  label: string
  split: 'in-sample' | 'test'
  nImages: number
  normalsClear: readonly [number, number]
  abnormalFlagged: readonly [number, number]
  promptHash?: string
} = {
  label: RELIABILITY.label,
  split: RELIABILITY.split,
  nImages: RELIABILITY.nImages,
  normalsClear: RELIABILITY.normalsClear,
  abnormalFlagged: RELIABILITY.abnormalFlagged,
  promptHash: (RELIABILITY as { promptHash?: string }).promptHash,
}

/** Wilson 95% interval for k of n (same formula as benchmark/score.py). */
export function wilson(k: number, n: number): { lower: number; upper: number } {
  if (!n) return { lower: 0, upper: 1 }
  const z = 1.96
  const p = k / n
  const d = 1 + (z * z) / n
  const c = (p + (z * z) / (2 * n)) / d
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return { lower: Math.max(0, c - h), upper: Math.min(1, c + h) }
}

// Scorer order matters: first match wins, on the title first and then title + description (score.py ftype).
const ROWS = RELIABILITY.types.map((t) => ({ ...t, match: new RegExp(t.pattern, 'i') }))

export interface Reliability {
  kind: string
  correct: number
  total: number
  /** the Wilson lower bound of the confirmation rate is below 50% */
  weak: boolean
  /** fewer than 5 calls of this kind in the benchmark: the rate is anecdotal */
  lowN: boolean
  /** Wilson 95% lower bound of correct / total */
  lower: number
}

export const hasReliabilityForModel = (model: string) => model === 'medgemma-27b-it'

export function reliabilityFor(f: Finding, model?: string): Reliability | null {
  if (model !== undefined && !hasReliabilityForModel(model)) return null
  if (f.severity === 'normal') return null
  const title = f.title.toLowerCase()
  const text = `${title} ${(f.description ?? '').toLowerCase()}`
  const row = ROWS.find((r) => r.match.test(title)) ?? ROWS.find((r) => r.match.test(text))
  if (!row || !row.total) return null
  const { lower } = wilson(row.correct, row.total)
  return { kind: row.kind, correct: row.correct, total: row.total, weak: lower < 0.5, lowN: row.total < 5, lower }
}

/** Label classes the model rarely detects in the benchmark: the reader should look for these unaided. */
export const BLIND_SPOTS: { kind: string; detected: number; total: number }[] = RELIABILITY.sensitivity
  .filter((s) => wilson(s.detected, s.total).upper < 0.6 || (s.total >= 5 && s.detected / s.total < 0.5))
  .map((s) => ({ kind: s.kind, detected: s.detected, total: s.total }))
