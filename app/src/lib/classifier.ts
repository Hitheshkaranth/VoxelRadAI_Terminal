// Optional second opinion from the local TorchXRayVision service (app/server/txrv_server.py, proxied at /txrv),
// plus the shared rules for which findings count. If the service is not running the analysis comes back with
// classifierStatus 'unavailable' and the findings unchanged, so the app works without it.
// Type-only imports: node tests import this file directly.
import type { AnalysisResult, ClassifierCheck, Finding, Severity, Study, StudyImage } from '../types'

const CHECK_TIMEOUT_MS = 30000

// ---- Review-aware helpers --------------------------------------------------

/** The classifier ran on this finding type and did not support it. */
export const isUnsupported = (f: { classifier?: ClassifierCheck }) => f.classifier?.supported === false

/**
 * Left out of counts, urgency and the draft report: only findings the reviewer dismissed. Unsupported findings stay in:
 * on the held-out ChestX-Det test split, dropping them cut abnormal films flagged from 74/82 to 57/82 for 3 more
 * normals called normal (benchmark/README.md), so the classifier marks a finding unconfirmed instead of removing it.
 */
export const isExcluded = (f: Pick<Finding, 'review'>): boolean => f.review === 'dismissed'

/** Unsupported by the classifier and not yet accepted or dismissed: in the draft, but marked for verification. */
export const isUnconfirmed = (f: Pick<Finding, 'classifier' | 'review'>): boolean => isUnsupported(f) && f.review === undefined

/** Abnormal findings that count. */
export const activeFindings = (fs: Finding[]): Finding[] => fs.filter((f) => f.severity !== 'normal' && !isExcluded(f))

/** Abnormal findings that are excluded but must stay visible. */
export const flaggedFindings = (fs: Finding[]): Finding[] => fs.filter((f) => f.severity !== 'normal' && isExcluded(f))

const RANK: Record<Severity, number> = { critical: 0, significant: 1, moderate: 2, minor: 3, normal: 4 }

export function worstSeverity(fs: Finding[]): Severity | null {
  let worst: Severity | null = null
  for (const f of activeFindings(fs)) if (worst === null || RANK[f.severity] < RANK[worst]) worst = f.severity
  return worst
}

export function findingCounts(a?: AnalysisResult): { active: number; flagged: number; normal: number; unlocalized: number[] } {
  const fs = a?.findings ?? []
  const active = activeFindings(fs)
  return {
    active: active.length,
    flagged: flaggedFindings(fs).length,
    normal: fs.filter((f) => f.severity === 'normal').length,
    // 1-based positions in the full findings list, as numbered on the boxes and cards.
    unlocalized: fs.flatMap((f, i) => (active.includes(f) && !(f.bbox && f.bbox.w > 0) ? [i + 1] : [])),
  }
}

/** Every excluded abnormal finding in the study, for the report's "not included" line and banners. */
export function excludedFindings(study: Study): { imageId: string; imageName: string; finding: Finding }[] {
  return study.images.flatMap((im) =>
    flaggedFindings(im.analysis?.findings ?? []).map((finding) => ({ imageId: im.id, imageName: im.name, finding })),
  )
}

/** Same rule as the model's urgency, but over findings that still count. */
export function deriveUrgencyFromActive(fs: Finding[]): 'routine' | 'priority' | 'urgent' {
  const w = worstSeverity(fs)
  return w === 'critical' ? 'urgent' : w === 'significant' ? 'priority' : 'routine'
}

// ---- Report inputs -------------------------------------------------------

/**
 * Everything the draft report depends on. A draft whose sourceKey differs from the study's current key is stale.
 */
export function reportSourceKey(study: Study): string {
  return JSON.stringify([
    study.images.map((im) => [
      im.id,
      im.analysis?.createdAt ?? null,
      (im.analysis?.findings ?? []).map((f) => `${f.id}:${f.review ?? ''}:${f.classifier?.supported ?? ''}`),
    ]),
    study.patient.indication,
    study.patient.age,
    study.patient.sex,
  ])
}

/** Deterministic lines appended to the draft so nothing the AI saw is dropped without a trace. */
export function reportTraceLines(study: Study): string[] {
  const lines: string[] = []
  const dismissed = excludedFindings(study)
  if (dismissed.length) {
    lines.push(`AI findings dismissed by the reviewer and not included above: ${dismissed.map(({ finding: f }) => f.title).join(', ')}.`)
  }
  const unconfirmed = study.images.flatMap((im) => (im.analysis?.findings ?? []).filter((f) => f.severity !== 'normal' && isUnconfirmed(f)))
  if (unconfirmed.length) {
    const items = unconfirmed.map((f) => {
      const c = f.classifier
      return c && c.prob !== null ? `${f.title} (${c.kind} ${Math.round(c.prob * 100)}%)` : f.title
    })
    lines.push(
      `AI findings not supported by the classifier cross-check, reported above as possible: ${items.join(', ')} — radiologist to confirm or dismiss.`,
    )
  }
  if (study.images.some((im) => im.analysis?.findings.some((f) => f.source === 'maira2'))) {
    lines.push('Includes second-reader (MAIRA-2) findings.')
  }
  return lines
}

// ---- Cross-check -----------------------------------------------------------

/**
 * Attach classifier checks to `analysis.findings`. `dataUrl` lets the caller send a smaller re-encoded JPEG.
 * Only a user abort throws; every service failure is recorded in classifierStatus.
 */
export async function crossCheck(
  image: StudyImage,
  analysis: AnalysisResult,
  signal?: AbortSignal,
  dataUrl?: string,
): Promise<AnalysisResult> {
  const timeout = AbortSignal.timeout(CHECK_TIMEOUT_MS)
  try {
    const r = await fetch('/txrv/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: dataUrl ?? image.dataUrl,
        findings: analysis.findings.map(({ id, title, description, severity }) => ({ id, title, description, severity })),
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (!r.ok) {
      // Vite answers 502/504 when the service is not running; 500 is the service reporting its own error.
      if (r.status === 500) {
        const body = (await r.json().catch(() => ({}))) as { error?: string }
        return { ...analysis, classifierStatus: 'error', classifierMessage: body.error ?? 'Classifier error.' }
      }
      return { ...analysis, classifierStatus: 'unavailable', classifierMessage: `HTTP ${r.status}` }
    }
    const { checks, probs } = (await r.json()) as { checks: Record<string, ClassifierCheck>; probs?: Record<string, number> }
    return {
      ...analysis,
      classifierStatus: 'ok',
      classifierMessage: undefined,
      classifierProbs: probs,
      findings: analysis.findings.map((f) => (checks[f.id] ? { ...f, classifier: checks[f.id] } : f)),
    }
  } catch (err) {
    if (signal?.aborted) throw err
    const message = timeout.aborted ? 'Classifier timed out.' : 'Classifier service not reachable.'
    return { ...analysis, classifierStatus: 'unavailable', classifierMessage: message }
  }
}
