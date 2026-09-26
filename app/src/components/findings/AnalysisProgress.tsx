// OWNER: Agent 3 (Findings Inspector). Animated progress view while an image is being analyzed.
import './findings.css'

export function AnalysisProgress({ stage, elapsed, onCancel }: { stage: string; elapsed: number; onCancel: () => void }) {
  const mm = Math.floor(elapsed / 60)
  const ss = String(elapsed % 60).padStart(2, '0')
  return (
    <div className="fd-stage">
      <div className="fd-progress">
        <div className="fd-progress-head">
          <span className="spinner" aria-hidden="true" />
          <span className="fd-progress-stage">{stage || 'Analyzing…'}</span>
          <span className="fd-progress-timer">{mm}:{ss}</span>
        </div>
        <p className="fd-progress-sub">MedGemma 27B running locally — no data leaves this Mac.</p>
        <div className="fd-bar" role="progressbar" aria-valuenow={0} aria-valuemin={0} aria-valuemax={100} />
        <button type="button" className="btn btn-plain fd-progress-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>

      <div className="fd-skeletons">
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