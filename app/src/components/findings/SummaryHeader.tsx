// OWNER: Agent 3 (Findings Inspector). Summary header card for a completed analysis.
import type { AnalysisResult } from '../../types'
import { SEVERITY_ORDER, SEVERITY_LABEL } from '../../types'
import type { Severity } from '../../types'
import { Activity } from 'lucide-react'
import './findings.css'

const URGENCY_LABEL: Record<AnalysisResult['urgency'], string> = {
  urgent: 'Urgent',
  priority: 'Priority',
  routine: 'Routine',
}

export function SummaryHeader({ analysis }: { analysis: AnalysisResult }) {
  const counts: Record<Severity, number> = { critical: 0, significant: 0, moderate: 0, minor: 0, normal: 0 }
  for (const f of analysis.findings) counts[f.severity] += 1
  const total = analysis.findings.length

  const metaPairs: { label: string; value: string }[] = [
    { label: 'Modality', value: analysis.modality },
    { label: 'Part', value: analysis.bodyPart },
    { label: 'View', value: analysis.view },
    { label: 'Quality', value: analysis.imageQuality },
  ]
  const seconds = Math.max(0, Math.round(analysis.durationMs / 1000))

  return (
    <section className="fd-summary">
      <div className="fd-summary-top">
        <span className="fd-urgency" data-urgency={analysis.urgency}>
          <Activity />
          {URGENCY_LABEL[analysis.urgency]}
        </span>
        <span className="fd-urgency-count">{total} finding{total === 1 ? '' : 's'}</span>
      </div>

      <div className="fd-sevbar">
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