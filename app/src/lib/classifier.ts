// Optional second opinion from the local TorchXRayVision service (app/server/txrv_server.py, proxied at /txrv).
// If the service is not running the analysis is returned unchanged, so the app works without it.
import type { AnalysisResult, ClassifierCheck, StudyImage } from '../types'

export const isUnsupported = (f: { classifier?: ClassifierCheck }) => f.classifier?.supported === false

export async function crossCheck(image: StudyImage, analysis: AnalysisResult, signal?: AbortSignal): Promise<AnalysisResult> {
  try {
    const r = await fetch('/txrv/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: image.dataUrl,
        findings: analysis.findings.map(({ id, title, description, severity }) => ({ id, title, description, severity })),
      }),
      signal,
    })
    if (!r.ok) return analysis
    const { checks } = (await r.json()) as { checks: Record<string, ClassifierCheck> }
    return { ...analysis, findings: analysis.findings.map((f) => (checks[f.id] ? { ...f, classifier: checks[f.id] } : f)) }
  } catch (err) {
    if (signal?.aborted) throw err
    return analysis
  }
}
