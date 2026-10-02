// OWNER: Agent 3 (Findings Inspector). Summary header card for a completed analysis.
// Counts and urgency come from the shared classifier helpers so every surface (filmstrip, sidebar, inspector
// badge, viewer badge) agrees: findings the classifier rejected or the reviewer dismissed are "flagged", not counted.
import type { AnalysisResult, Severity } from '../../types'
import { SEVERITY_ORDER, SEVERITY_LABEL } from '../../types'
import { Activity, AlertTriangle, EyeOff } from 'lucide-react'
import { activeFindings, deriveUrgencyFromActive, findingCounts } from '../../lib/classifier'
import { BLIND_SPOTS } from '../../lib/reliability'
import { countLabel } from '../shell/shellState'
import './findings.css'

const URGENCY_LABEL: Record<AnalysisResult['urgency'], string> = {
  urgent: 'Urgent',
  priority: 'Priority',
  routine: 'Routine',
}

export function SummaryHeader({ analysis }: { analysis: AnalysisResult }) {
  const { active, flagged } = findingCounts(analysis)
  const shown = [...activeFindings(analysis.findings), ...analysis.findings.filter((f) => f.severity === 'normal')]
  const counts: Record<Severity, number> = { critical: 0, significant: 0, moderate: 0, minor: 0, normal: 0 }
  for (const f of shown) counts[f.severity] += 1
  const urgency = deriveUrgencyFromActive(activeFindings(analysis.findings))

  const metaPairs: { label: string; value: string }[] = [
    { label: 'Modality', value: analysis.modality },
    { label: 'Part', value: analysis.bodyPart },
    { label: 'View', value: analysis.view },
    { label: 'Quality', value: analysis.imageQuality },
  ]
  const seconds = Math.max(0, Math.round(analysis.durationMs / 1000))
  const classifierDown = analysis.classifierStatus === 'unavailable' || analysis.classifierStatus === 'error'

  return (
    <section className="fd-summary">
      <div className="fd-summary-top">
        <span className="fd-urgency" data-urgency={urgency}>
          <Activity aria-hidden="true" />
          {URGENCY_LABEL[urgency]}
        </span>
        <span className="fd-urgency-count">{countLabel(active, flagged)}</span>
      </div>

      <div className="fd-sevbar" aria-hidden="true">
        <div className="fd-sevbar-track">
          {SEVERITY_ORDER.map((sev) =>
            counts[sev] > 0 ? <span key={sev} className="fd-sevbar-seg" data-sev={sev} style={{ flex: counts[sev] }} /> : null,
          )}
        </div>
      </div>
      <div className="fd-legend">
        {SEVERITY_ORDER.map((sev) =>
          counts[sev] > 0 ? (
            <span key={sev} className="fd-legend-item">
              <span className="fd-legend-dot" data-sev={sev} />
              {SEVERITY_LABEL[sev]}
              <b>{counts[sev]}</b>
            </span>
          ) : null,
        )}
      </div>

      {classifierDown && (
        <div className="fd-summary-note">
          <AlertTriangle aria-hidden="true" />
          <span>
            Classifier {analysis.classifierStatus === 'error' ? 'failed' : 'not running'} — findings were not cross-checked.
            {analysis.classifierMessage ? ` ${analysis.classifierMessage}` : ''}
          </span>
        </div>
      )}

      <div className="fd-meta">
        {metaPairs.map((m, i) => (
          <span key={m.label} className="fd-meta-item">
            {i > 0 && <span className="fd-meta-sep">·</span>}
            <span className="fd-meta-label">{m.label}: </span>
            <b>{m.value}</b>
          </span>
        ))}
        <span className="fd-meta-model">
          {analysis.model} · {seconds} s
        </span>
      </div>
    </section>
  )
}

/**
 * Fixed reminder of the classes the model misses most in the local benchmark. Shown on every completed read,
 * including normal-looking ones, because a clean read is exactly when a missed effusion or nodule goes unnoticed.
 */
export function BlindSpotNote() {
  if (!BLIND_SPOTS.length) return null
  return (
    <div className="fd-blind">
      <EyeOff aria-hidden="true" />
      <span>
        <b>Known blind spots — review specifically: </b>
        {BLIND_SPOTS.map((b) => `${b.kind} (detected ${b.detected} of ${b.total})`).join(', ')}.
        <span className="fd-blind-src"> Local benchmark; the model rarely reports these.</span>
      </span>
    </div>
  )
}
