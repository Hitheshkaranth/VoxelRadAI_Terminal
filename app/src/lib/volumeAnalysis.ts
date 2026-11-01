import type { AnalysisResult } from '../types.ts'

export interface SliceRead { index: number; analysis?: AnalysisResult; error?: string }
/** Review every index, serially. Failed or truncated reads remain eligible for resume. */
export async function reviewAllSlices(opts: {
  count: number
  previous?: SliceRead[]
  signal: AbortSignal
  read: (index: number) => Promise<AnalysisResult>
  onSlice: (read: SliceRead) => void | Promise<void>
  onStart?: (index: number) => void
}): Promise<void> {
  const complete = new Set((opts.previous ?? []).filter((r) => r.analysis && !r.analysis.truncated).map((r) => r.index))
  for (let index = 0; index < opts.count; index++) {
    if (opts.signal.aborted) return
    if (complete.has(index)) continue
    opts.onStart?.(index)
    let read: SliceRead
    try { read = { index, analysis: await opts.read(index) } }
    catch (error) {
      if (opts.signal.aborted) return
      read = { index, error: error instanceof Error ? error.message : 'Slice analysis failed' }
    }
    if (opts.signal.aborted) return
    await opts.onSlice(read)
    // Stop on a failed request instead of repeatedly hitting an unavailable model.
    if (read.error) return
  }
}

export function volumeCoverage(reads: SliceRead[], count: number) {
  const unique = new Map(reads.map((read) => [read.index, read]))
  const completed = [...unique.values()].filter((r) => r.index >= 0 && r.index < count && r.analysis && !r.analysis.truncated).length
  return { completed, total: count, complete: count > 0 && completed === count }
}
