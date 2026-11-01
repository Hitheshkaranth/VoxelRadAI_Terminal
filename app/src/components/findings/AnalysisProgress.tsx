// OWNER: Agent 3 (Findings Inspector). Animated progress view while an image is being analyzed.
// Elapsed time is derived from the image's own start time, so switching images and back does not reset it.
import { useEffect, useState } from 'react'
import type { AnalysisStage } from '../../types'
import { useApp } from '../../store'
import './findings.css'

const STAGE_LABEL: Record<AnalysisStage, string> = {
  queued: 'Queued',
  reading: 'Step 1/3 Reading image · typically 60–90 s',
  retry: 'Retrying JSON format',
  'lung-pattern': 'Step 2/3 Lung markings',
  'cross-check': 'Step 3/3 Classifier cross-check',
  'second-reader': 'Second reader',
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export function AnalysisProgress({
  stage,
  detail,
  startedAt,
  etaMs,
  onCancel,
}: {
  stage?: AnalysisStage
  /** Live text from the pipeline (e.g. streamed token count). */
  detail?: string
  /** image.analysisStartedAt; falls back to when this view mounted. */
  startedAt?: number
  /** Typical end-to-end duration (median of finished analyses). */
  etaMs: number
  onCancel: () => void
}) {
  const model = useApp((s) => s.settings.model)
  const [mountedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const elapsed = Math.max(0, Math.floor((now - (startedAt ?? mountedAt)) / 1000))
  const eta = Math.round(etaMs / 1000)
  const left = eta - elapsed
  const label = stage ? STAGE_LABEL[stage] : detail || 'Analyzing…'
  const timing =
    stage === 'queued'
      ? 'Waiting for the model — one image runs at a time'
      : left > 0
        ? `About ${left} s left (typical ${eta} s)`
        : 'Taking longer than usual'

  return (
    <div className="fd-stage">
      <div className="fd-progress">
        <div className="fd-progress-head">
          <span className="spinner" aria-hidden="true" />
          <span className="fd-progress-stage" role="status">{label}</span>
          <span className="fd-progress-timer" aria-label={`Elapsed ${clock(elapsed)}`}>{clock(elapsed)}</span>
        </div>
        <p className="fd-progress-sub">
          {timing}
          {stage && detail && detail !== 'Queued' ? ` · ${detail}` : ''}
        </p>
        <p className="fd-progress-sub">Reading with {model}.</p>
        <div className="fd-bar" role="progressbar" aria-label="Analysis in progress" />
        <button type="button" className="btn btn-plain fd-progress-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>

      <div className="fd-skeletons" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="fd-skeleton">
            <div className="fd-skeleton-row">
              <span className="fd-skeleton-pill" />
              <span className="fd-skeleton-rect" />
            </div>
            <span className="fd-skeleton-line" />
            <span className="fd-skeleton-line w90" />
            <span className="fd-skeleton-line w60" />
          </div>
        ))}
      </div>
    </div>
  )
}
