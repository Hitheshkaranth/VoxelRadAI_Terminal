// OWNER: Agent 3 (Findings Inspector). Grouped, keyboard-navigable findings list.
// Semantics: <ul>/<li> groups; each card's selectable header is a real <button> (inline content only) and the
// Accept/Dismiss controls sit beside it, never inside it. One roving tab stop follows the selected finding.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { AnalysisResult, Finding, FindingReview, Severity } from '../../types'
import { SEVERITY_ORDER, SEVERITY_LABEL } from '../../types'
import './findings.css'
import { FindingCard } from './FindingCard'

interface Group { severity: Severity; items: { number: number; finding: Finding }[] }

type ReviewFilter = 'all' | 'pending' | 'reviewed'

function buildGroups(analysis: AnalysisResult, filter: ReviewFilter): Group[] {
  const groups: Group[] = []
  for (const severity of SEVERITY_ORDER) {
    const items: { number: number; finding: Finding }[] = []
    analysis.findings.forEach((finding, index) => {
      const matches = filter === 'all' || (finding.severity !== 'normal' && (filter === 'pending' ? !finding.review : !!finding.review))
      if (finding.severity === severity && matches) items.push({ number: index + 1, finding })
    })
    if (items.length) groups.push({ severity, items })
  }
  return groups
}

export function FindingList({
  analysis,
  selectedFindingId,
  hoveredFindingId,
  onSelect,
  onToggle,
  onHover,
  onReview,
}: {
  analysis: AnalysisResult
  selectedFindingId: string | null
  hoveredFindingId: string | null
  /** Toggle (mouse click on a card). */
  onToggle: (id: string) => void
  /** Force-select (keyboard: Enter / ↑ / ↓). */
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  /** Reviewer accept / dismiss; undefined clears the decision. */
  onReview: (id: string, review: FindingReview | undefined) => void
}) {
  const [filter, setFilter] = useState<ReviewFilter>('all')
  const groups = useMemo(() => buildGroups(analysis, filter), [analysis, filter])
  const abnormal = analysis.findings.filter((f) => f.severity !== 'normal')
  const pending = abnormal.filter((f) => !f.review).length
  const reviewed = abnormal.length - pending

  // Flat display order (grouped by severity, preserving original index within each group).
  const flatIds = useMemo(() => groups.flatMap((g) => g.items.map((it) => it.finding.id)), [groups])
  const tabStopId = selectedFindingId && flatIds.includes(selectedFindingId) ? selectedFindingId : flatIds[0]

  const [focusedId, setFocusedId] = useState<string | null>(null)
  const cardEls = useRef<Record<string, HTMLButtonElement>>({})
  const filterButtons = useRef<Record<string, HTMLButtonElement>>({})

  const reviewFinding = (id: string, review: FindingReview | undefined) => {
    const focusedInside = cardEls.current[id]?.closest('li')?.contains(document.activeElement)
    const leavesFilter = (filter === 'pending' && !!review) || (filter === 'reviewed' && !review)
    const remaining = flatIds.filter((other) => other !== id)
    const next = remaining[Math.min(flatIds.indexOf(id), remaining.length - 1)]
    onReview(id, review)
    // A decision can remove the focused card from this queue. Keep keyboard focus in the workflow.
    if (leavesFilter && focusedInside) requestAnimationFrame(() => {
      if (next) { onSelect(next); cardEls.current[next]?.focus() }
      else filterButtons.current[filter]?.focus()
    })
  }

  // Scroll the selected card into view when selection changes (incl. from the viewer).
  useEffect(() => {
    if (!selectedFindingId) return
    cardEls.current[selectedFindingId]?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }, [selectedFindingId])

  const onCardKeyDown = useCallback(
    (id: string, e: KeyboardEvent<HTMLButtonElement>) => {
      const index = flatIds.indexOf(id)
      let next: string | undefined
      if (e.key === 'ArrowDown') next = flatIds[Math.min(index + 1, flatIds.length - 1)]
      else if (e.key === 'ArrowUp') next = flatIds[Math.max(index - 1, 0)]
      else if (e.key === 'Home') next = flatIds[0]
      else if (e.key === 'End') next = flatIds[flatIds.length - 1]
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onToggle(id)
        return
      }
      if (!next) return
      e.preventDefault()
      onSelect(next)
      cardEls.current[next]?.focus()
    },
    [flatIds, onSelect, onToggle],
  )

  if (analysis.findings.length === 0) {
    return (
      <section className="fd-findings">
        <div className="fd-findings-empty">The model reported no focal findings on this image.</div>
      </section>
    )
  }

  return (
    <section className="fd-findings" aria-label="Detected findings">
      <div className="fd-review-heading">
        <div><h2>Review findings</h2><span aria-live="polite">{reviewed} of {abnormal.length} abnormal findings reviewed</span></div>
        <span className="fd-review-total">{analysis.findings.length}</span>
      </div>
      <div className="fd-review-filters" role="group" aria-label="Filter findings by review status">
        {([['all', 'All', analysis.findings.length], ['pending', 'To review', pending], ['reviewed', 'Reviewed', reviewed]] as const).map(([value, label, count]) => (
          <button key={value} ref={(el) => { if (el) filterButtons.current[value] = el; else delete filterButtons.current[value] }} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label} <span>{count}</span></button>
        ))}
      </div>
      {groups.length === 0 && <div className="fd-filter-empty" role="status">{filter === 'pending' ? 'All abnormal findings have a review decision.' : 'No findings reviewed yet. Accept or dismiss a finding to record your decision.'}</div>}
      {groups.map((g) => (
        <div key={g.severity} className="fd-sev-group">
          <div className="fd-sev-group-title" id={`fd-group-${g.severity}`}>
            <span className="fd-sev-dot" style={{ background: `var(--sev-${g.severity})` }} />
            {SEVERITY_LABEL[g.severity]}
            <span className="fd-sev-group-count">{g.items.length}</span>
          </div>
          <ul className="fd-finding-ul" aria-labelledby={`fd-group-${g.severity}`}>
            {g.items.map((it) => (
              <FindingCard
                key={it.finding.id}
                finding={it.finding}
                number={it.number}
                classifierStatus={analysis.classifierStatus}
                flatIndex={flatIds.indexOf(it.finding.id)}
                flatTotal={flatIds.length}
                isExpanded={selectedFindingId === it.finding.id}
                isHovered={hoveredFindingId === it.finding.id}
                isSelected={selectedFindingId === it.finding.id}
                isTabStop={tabStopId === it.finding.id}
                isFocused={focusedId === it.finding.id}
                onHover={onHover}
                onToggle={onToggle}
                onReview={reviewFinding}
                onFocusChange={setFocusedId}
                onKeyDown={(e) => onCardKeyDown(it.finding.id, e)}
                buttonRef={(el) => {
                  if (el) cardEls.current[it.finding.id] = el
                  else delete cardEls.current[it.finding.id]
                }}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
