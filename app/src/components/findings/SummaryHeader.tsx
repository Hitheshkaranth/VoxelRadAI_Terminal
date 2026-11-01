// OWNER: Agent 3 (Findings Inspector). Summary header card for a completed analysis.
// Counts and urgency come from the shared classifier helpers so every surface (filmstrip, sidebar, inspector
// badge, viewer badge) agrees: findings the classifier rejected or the reviewer dismissed are "flagged", not counted.
import type { AnalysisResult } from '../../types'
import { AlertTriangle, EyeOff } from 'lucide-react'
import { activeFindings, deriveUrgencyFromActive, findingCounts } from '../../lib/classifier'
import { BLIND_SPOTS, hasReliabilityForModel } from '../../lib/reliability'
import { countLabel } from '../shell/shellState'
import './findings.css'

const URGENCY_LABEL: Record<AnalysisResult['urgency'], string> = {
  urgent: 'Urgent',
  priority: 'Priority',
  routine: 'Routine',
}

export function SummaryHeader({ analysis }: { analysis: AnalysisResult }) {
  const { active, flagged } = findingCounts(analysis)
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
          {URGENCY_LABEL[urgency]}
        </span>
        <span className="fd-urgency-count">{countLabel(active, flagged)}</span>
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
export function BlindSpotNote({ model }: { model: string }) {
  if (!BLIND_SPOTS.length || !hasReliabilityForModel(model)) return null
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
