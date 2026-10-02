// OWNER: Agent 5. Inspector — Findings | Report segmented control + scrollable panel body.
import { useApp, useActiveStudy } from '../../store'
import { FindingsPanel } from '../findings/FindingsPanel'
import { ReportPanel } from '../report/ReportPanel'
import type { Study } from '../../types'
import { findingCounts } from '../../lib/classifier'
import { countLabel } from './shellState'
import './shell.css'

export function Inspector() {
  const activeStudy = useActiveStudy()
  const tab = useApp((s) => s.inspectorTab)
  const setTab = useApp((s) => s.setInspectorTab)

  if (!activeStudy) return null
  const counts = countFindings(activeStudy)

  return (
    <aside className="sh-inspector">
      <div className="sh-inspector-head">
        <div className="segmented" role="tablist" aria-label="Inspector panels">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'findings'}
            aria-controls="findings-panel"
            onClick={() => setTab('findings')}
          >
            Findings
            {counts.active + counts.flagged > 0 && (
              <span
                className="sh-count-badge"
                title={countLabel(counts.active, counts.flagged)}
                aria-label={countLabel(counts.active, counts.flagged)}
              >
                {counts.active}
                {counts.flagged > 0 && <span className="sh-count-flag"> +{counts.flagged}?</span>}
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'report'}
            aria-controls="report-panel"
            onClick={() => setTab('report')}
          >
            Report
          </button>
        </div>
      </div>

      <div className="sh-inspector-body">
        {tab === 'findings' ? <FindingsPanel /> : <ReportPanel />}
      </div>
    </aside>
  )
}

/** Active and flagged findings across the study (normal-structure entries are not findings). */
function countFindings(study: Study): { active: number; flagged: number } {
  let active = 0
  let flagged = 0
  for (const img of study.images) {
    const c = findingCounts(img.analysis)
    active += c.active
    flagged += c.flagged
  }
  return { active, flagged }
}