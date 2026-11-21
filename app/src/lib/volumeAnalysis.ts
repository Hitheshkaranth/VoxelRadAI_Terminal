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
  retries?: number
  retryDelayMs?: number
  onRetry?: (index: number, attempt: number) => void
}): Promise<void> {
  const complete = new Set((opts.previous ?? []).filter((r) => r.analysis && !r.analysis.truncated).map((r) => r.index))
  for (let index = 0; index < opts.count; index++) {
    if (opts.signal.aborted) return
    if (complete.has(index)) continue
    opts.onStart?.(index)
    let read: SliceRead
    try {
      let attempt = 0
      while (true) {
        try { read = {index, analysis: await opts.read(index)}; break }
        catch (error) {
          if (opts.signal.aborted || attempt >= (opts.retries ?? 0) || !isTransientReadError(error)) throw error
          attempt++; opts.onRetry?.(index, attempt)
          await retryDelay((opts.retryDelayMs ?? 1000) * attempt, opts.signal)
        }
      }
    }
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

export function isTransientReadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /network|failed to fetch|not reachable|connection|stopped responding|timed? out|\b(?:429|502|503|504)\b/i.test(message)
}
function retryDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new Error('Cancelled'));return}
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new Error('Cancelled'))}
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},ms)
    signal.addEventListener('abort',abort,{once:true})
  })
}

/** Skanda-V2 whole-series CT read -> one SliceRead per axial slice, so per-slice review, outlines (drawn on the finding's
 *  own slice) and the volume draft work unchanged. Each finding goes to its sliceIndex (0-based, as the server counts);
 *  a finding without a usable sliceIndex, and the read's impression / stated negatives, go to `keyIndex` (the slice the
 *  request was made from). Every other slice gets an empty read marked as covered by the series read. */
export function splitSeriesAnalysis(analysis: AnalysisResult, count: number, keyIndex: number): SliceRead[] {
  const key = Math.max(0, Math.min(count - 1, Math.round(keyIndex)))
  const groups = new Map<number, AnalysisResult['findings']>()
  for (const f of analysis.findings) {
    const i = typeof f.sliceIndex === 'number' && f.sliceIndex >= 0 && f.sliceIndex < count ? f.sliceIndex : key
    groups.set(i, [...(groups.get(i) ?? []), f])
  }
  const reads: SliceRead[] = []
  for (let i = 0; i < count; i++) {
    const findings = groups.get(i) ?? []
    reads.push({ index: i, analysis: {
      ...analysis, findings,
      pertinentNegatives: i === key ? analysis.pertinentNegatives : [],
      impression: i === key ? analysis.impression : findings.length ? findings.map((f) => f.title).join('; ') + '.' : 'Read as part of the whole series; no finding on this slice.',
    } })
  }
  return reads
}
