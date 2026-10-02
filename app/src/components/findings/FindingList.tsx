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

function buildGroups(analysis: AnalysisResult): Group[] {
  const groups: Group[] = []
  for (const severity of SEVERITY_ORDER) {
    const items: { number: number; finding: Finding }[] = []
    analysis.findings.forEach((finding, index) => {
      if (finding.severity === severity) items.push({ number: index + 1, finding })
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
  const groups = useMemo(() => buildGroups(analysis), [analysis])

  // Flat display order (grouped by severity, preserving original index within each group).
  const flatIds = useMemo(() => groups.flatMap((g) => g.items.map((it) => it.finding.id)), [groups])
  const tabStopId = selectedFindingId && flatIds.includes(selectedFindingId) ? selectedFindingId : flatIds[0]

  const [focusedId, setFocusedId] = useState<string | null>(null)
  const cardEls = useRef<Record<string, HTMLButtonElement>>({})

  // Scroll the selected card into view when selection changes (incl. from the viewer).
  useEffect(() => {
    if (!selectedFindingId) return
    cardEls.current[selectedFindingId]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
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
        onSelect(id)
        return
      }
      if (!next) return
      e.preventDefault()
      onSelect(next)
      cardEls.current[next]?.focus()
    },
    [flatIds, onSelect],
  )

  if (groups.length === 0) {
    return (
      <section className="fd-findings">
        <div className="fd-findings-empty">The model reported no focal findings on this image.</div>
      </section>
    )
  }

  return (
    <section className="fd-findings" aria-label="Detected findings">
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
                onReview={onReview}
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
