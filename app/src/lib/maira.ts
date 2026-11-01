// Optional MAIRA-2 second reader (app/server/maira_server.py, proxied at /maira). Off by default.
// On the held-out ChestX-Det test split adding it took MedGemma from 90/220 to 103/220 right finding types (effusion
// 13/43 → 23/43) with no change in normals. Only those classes are taken from it, only where MedGemma has no finding
// of that type, and an added finding is kept only if the TorchXRayVision cross-check supports it (analysis.ts). If the service is not running or the
// model is not loaded the analysis comes back unchanged with secondReader.status saying why.
// Type-only imports: node tests import this file directly.
import type { AnalysisResult, BBox, Finding, Settings, Severity, StudyImage } from '../types'

const REPORT_TIMEOUT_MS = 180000

/** Same finding-type table as txrv_server.SUPPORT (title first, then title + description). */
const KINDS: readonly (readonly [string, RegExp])[] = [
  ['pneumothorax', /pneumothorax/],
  ['effusion', /effusion|blunt/],
  ['cardiomegaly', /cardiomegaly|enlarged (heart|cardiac)|cardiac enlargement|heart size.*enlarg|cardiothoracic/],
  ['edema', /o?edema|congestion|kerley/],
  ['nodule / mass', /nodul|\bmass\b(?! effect)|lesion/],
  ['atelectasis', /atelecta|collapse|volume loss/],
  ['opacity', /consolidat|opacit|airspace|pneumonia|infiltrat|interstitial|markings/],
]

/** txrv finding type for a finding, or null when none matches. */
export function findingKind(f: { title: string; description?: string }): string | null {
  const title = f.title.toLowerCase()
  const text = `${title} ${(f.description ?? '').toLowerCase()}`
  for (const hay of [title, text]) for (const [kind, rx] of KINDS) if (rx.test(hay)) return kind
  return null
}

/** A finding as maira_server returns it. */
export interface MairaFinding {
  title: string
  description: string
  severity: Severity
  bbox?: BBox
}

const RANK: Record<Severity, number> = { critical: 0, significant: 1, moderate: 2, minor: 3, normal: 4 }

/**
 * Pure merge: drop earlier second-reader findings, then add MAIRA-2's abnormal findings whose type is in `kinds`
 * and not already reported by MedGemma (one per type).
 */
export function mergeSecondReader(analysis: AnalysisResult, mairaFindings: MairaFinding[], kinds: string[]): AnalysisResult {
  const own = analysis.findings.filter((f) => f.source !== 'maira2')
  const seen = new Set(own.filter((f) => f.severity !== 'normal').map(findingKind))
  const added: Finding[] = []
  for (const m of mairaFindings) {
    if (m.severity === 'normal') continue
    const kind = findingKind(m)
    if (!kind || !kinds.includes(kind) || seen.has(kind)) continue
    seen.add(kind)
    added.push({
      id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `m${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: m.title,
      description: m.description,
      // MAIRA-2 gives no grading; never let it raise urgency on its own.
      severity: RANK[m.severity] < RANK.moderate ? 'moderate' : m.severity,
      confidence: 0,
      location: '',
      bbox: m.bbox,
      category: 'Second reader',
      source: 'maira2',
    })
  }
  return {
    ...analysis,
    findings: [...own, ...added],
    secondReader: { status: 'ok', added: added.length, ranAt: Date.now() },
  }
}

// ---- Service calls ---------------------------------------------------------

export async function mairaHealth(): Promise<{ running: boolean; loaded: boolean; device?: string; memGB?: number }> {
  try {
    const r = await fetch('/maira/health', { signal: AbortSignal.timeout(3000) })
    if (!r.ok) return { running: false, loaded: false }
    const h = (await r.json()) as { loaded?: boolean; device?: string | null; memGB?: number | null }
    return { running: true, loaded: !!h.loaded, device: h.device ?? undefined, memGB: h.memGB ?? undefined }
  } catch {
    return { running: false, loaded: false }
  }
}

async function post(path: '/load' | '/unload'): Promise<{ ok: boolean; message?: string }> {
  try {
    // Loading reads ~14 GB of weights; allow a few minutes.
    const r = await fetch(`/maira${path}`, { method: 'POST', signal: AbortSignal.timeout(300000) })
    const body = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string }
    if (r.ok) return { ok: true, message: body.message }
    if (r.status === 502 || r.status === 504) return { ok: false, message: 'MAIRA-2 service is not running.' }
    return { ok: false, message: body.message ?? body.error ?? `HTTP ${r.status}` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'MAIRA-2 service not reachable.' }
  }
}

export const mairaLoad = () => post('/load')
export const mairaUnload = () => post('/unload')

/** Run the second reader on one image. Only a user abort throws. */
export async function augment(
  image: StudyImage,
  analysis: AnalysisResult,
  settings: Settings,
  signal?: AbortSignal,
  dataUrl?: string,
): Promise<AnalysisResult> {
  if (!settings.maira.enabled) return analysis
  const fail = (status: 'unavailable' | 'not-loaded' | 'error', message?: string): AnalysisResult => ({
    ...analysis,
    secondReader: { status, added: 0, ranAt: Date.now(), message },
  })
  const timeout = AbortSignal.timeout(REPORT_TIMEOUT_MS)
  try {
    const r = await fetch('/maira/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl ?? image.dataUrl }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (r.status === 409) return fail('not-loaded', 'MAIRA-2 is not loaded.')
    if (r.status === 500) {
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      return fail('error', body.error ?? 'Second reader error.')
    }
    if (!r.ok) return fail('unavailable', `HTTP ${r.status}`)
    const { findings } = (await r.json()) as { findings: MairaFinding[] }
    return mergeSecondReader(analysis, findings ?? [], settings.maira.kinds)
  } catch (err) {
    if (signal?.aborted) throw err
    return fail('unavailable', timeout.aborted ? 'Second reader timed out.' : 'MAIRA-2 service not reachable.')
  }
}
