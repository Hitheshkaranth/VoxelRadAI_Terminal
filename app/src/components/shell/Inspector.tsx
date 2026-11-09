import { ShellButton } from './ShellButton'
import { Tabs } from 'radix-ui'
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
    <Tabs.Root asChild value={tab} onValueChange={(value) => setTab(value as 'findings' | 'report')}>
    <aside className="sh-inspector" aria-label="Findings and report">
      <div className="sh-inspector-head">
        <Tabs.List className="segmented" aria-label="Inspector panels">
          <Tabs.Trigger asChild value="findings">
          <ShellButton
            type="button"
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
          </ShellButton>
          </Tabs.Trigger>
          <Tabs.Trigger asChild value="report">
          <ShellButton
            type="button"
          >
            Report
          </ShellButton>
          </Tabs.Trigger>
        </Tabs.List>
      </div>

      <div className="sh-inspector-body">
        <Tabs.Content value="findings"><FindingsPanel /></Tabs.Content>
        <Tabs.Content value="report"><ReportPanel /></Tabs.Content>
      </div>
    </aside>
    </Tabs.Root>
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
