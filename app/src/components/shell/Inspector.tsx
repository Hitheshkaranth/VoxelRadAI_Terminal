// OWNER: Agent 5. Inspector — Findings | Report segmented control + scrollable panel body.
import { useApp, useActiveStudy } from '../../store'
import { FindingsPanel } from '../findings/FindingsPanel'
import { ReportPanel } from '../report/ReportPanel'
import type { Study } from '../../types'
import './shell.css'

export function Inspector() {
  const activeStudy = useActiveStudy()
  const tab = useApp((s) => s.inspectorTab)
  const setTab = useApp((s) => s.setInspectorTab)

  if (!activeStudy) return null

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
            {countFindings(activeStudy) > 0 && <span className="sh-count-badge">{countFindings(activeStudy)}</span>}
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

function countFindings(study: Study): number {
  return study.images.reduce((n, img) => n + (img.analysis?.findings.length ?? 0), 0)
}