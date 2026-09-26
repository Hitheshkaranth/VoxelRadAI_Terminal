// OWNER: Agent 3 (Findings Inspector). Grouped, keyboard-navigable findings list.
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import type { AnalysisResult, Finding, Severity } from '../../types'
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
}: {
  analysis: AnalysisResult
  selectedFindingId: string | null
  hoveredFindingId: string | null
  /** Toggle (mouse click on a card). */
  onToggle: (id: string) => void
  /** Force-select (keyboard: Enter / ↑ / ↓). */
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
}) {
  const groups = useMemo(() => buildGroups(analysis), [analysis])

  // Flat display order (grouped by severity, preserving original index within each group).
  const flatIds: string[] = []
  const flatIndexById: Record<string, number> = {}
  groups.forEach((g) => g.items.forEach((it) => { flatIndexById[it.finding.id] = flatIds.length; flatIds.push(it.finding.id) }))

  const cardEls = useRef<Record<string, HTMLButtonElement>>({})
  const focusId = useCallback((id: string) => { cardEls.current[id]?.focus() }, [])

  // Scroll the selected card into view when selection changes (incl. from the viewer).
  useEffect(() => {
    if (!selectedFindingId) return
    cardEls.current[selectedFindingId]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedFindingId])

  const onCardKeyDown = useCallback(
    (index: number, total: number, id: string, e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(id)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = flatIds[Math.min(index + 1, total - 1)]
        onSelect(next)
        focusId(next)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const prev = flatIds[Math.max(index - 1, 0)]
        onSelect(prev)
        focusId(prev)
      }
    },
    [flatIds, onSelect, focusId],
  )

  if (groups.length === 0) {
    return (
      <section className="fd-findings">
        <div className="fd-findings-empty">The model reported no focal findings on this image.</div>
      </section>
    )
  }

  return (
    <section className="fd-findings" role="list" aria-label="Detected findings">
      {groups.map((g) => (
        <div key={g.severity} className="fd-sev-group">
          <div className="fd-sev-group-title">
            <span className="fd-sev-dot" style={{ background: `var(--sev-${g.severity})` }} />
            {SEVERITY_LABEL[g.severity]}
            <span className="fd-sev-group-count">{g.items.length}</span>
          </div>
          {g.items.map((it) => (
            <FindingCard
              key={it.finding.id}
              finding={it.finding}
              number={it.number}
              flatIndex={flatIndexById[it.finding.id]}
              flatTotal={flatIds.length}
              isExpanded={selectedFindingId === it.finding.id}
              isHovered={hoveredFindingId === it.finding.id}
              isSelected={selectedFindingId === it.finding.id}
              onHover={onHover}
              onToggle={onToggle}
              onKeyDown={(e) => onCardKeyDown(flatIndexById[it.finding.id], flatIds.length, it.finding.id, e)}
              buttonRef={(el) => {
                if (el) cardEls.current[it.finding.id] = el
                else delete cardEls.current[it.finding.id]
              }}
            />
          ))}
        </div>
      ))}
    </section>
  )
}