// OWNER: Agent 3 (Findings Inspector). Finding card rendered in the done list.
import { useCallback } from 'react'
import type { KeyboardEvent } from 'react'
import type { Finding } from '../../types'
import { SEVERITY_LABEL } from '../../types'
import { Check, CheckCircle2, Cloud, Crop } from 'lucide-react'
import './findings.css'

interface Props {
  finding: Finding
  /** 1-based index in findings order — must match the viewer's burned-in numbers. */
  number: number
  isExpanded: boolean
  isHovered: boolean
  isSelected: boolean
  onHover: (id: string | null) => void
  onToggle: (id: string) => void
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>, index: number, total: number) => void
  flatIndex: number
  flatTotal: number
  buttonRef: (el: HTMLButtonElement | null) => void
}

export function FindingCard({
  finding,
  number,
  isExpanded,
  isHovered,
  isSelected,
  onHover,
  onToggle,
  onKeyDown,
  flatIndex,
  flatTotal,
  buttonRef,
}: Props) {
  const localized = finding.bbox != null && (finding.bbox.w ?? 0) > 0

  const onPointerEnter = useCallback(() => onHover(finding.id), [onHover, finding.id])
  const onPointerLeave = useCallback(() => onHover(null), [onHover])

  return (
    <button
      type="button"
      ref={buttonRef}
      role="listitem"
      aria-pressed={isSelected}
      data-severity={finding.severity}
      className={`fd-finding ${isSelected ? 'fd-finding--sel' : ''} ${isHovered ? 'fd-finding--hv' : ''}`}
      tabIndex={flatIndex === 0 ? 0 : -1}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      onKeyDown={(e) => onKeyDown(e, flatIndex, flatTotal)}
      onClick={() => onToggle(finding.id)}
    >
      <div className="fd-finding-head">
        <span className="fd-num" aria-label={`Finding ${number}`}>
          {number}
        </span>
        <span className="fd-badge" data-severity={finding.severity}>
          {SEVERITY_LABEL[finding.severity]}
        </span>
        <span className="fd-local" title={localized ? 'Localized on image' : 'Diffuse — no focal region'}>
          {localized ? <Crop /> : <Cloud />}
        </span>
      </div>

      <div className="fd-finding-title">{finding.title}</div>

      <div className="fd-location">
        {[finding.location, finding.category].filter(Boolean).join(' · ') || '—'}
      </div>

      <div className="fd-conf" aria-label={`Confidence ${Math.round(finding.confidence * 100)}%`}>
        <span className="fd-conf-label">Confidence</span>
        <span className="fd-conf-track">
          <span className="fd-conf-fill" style={{ width: `${Math.min(finding.confidence * 100, 100)}%` }} />
        </span>
        <span className="fd-conf-pct">{Math.round(finding.confidence * 100)}%</span>
      </div>

      <p className={`fd-desc ${isExpanded ? 'fd-desc--open' : ''}`}>{finding.description}</p>

      {finding.recommendation && (
        <div className="fd-rec">
          <CheckCircle2 />
          <span>{finding.recommendation}</span>
        </div>
      )}

      {isExpanded && (
        <div className="fd-keys">
          <Check strokeWidth={2.5} />
          <span>
            {flatIndex + 1} / {flatTotal} finding · press Enter to toggle · ↑ ↓ to move
          </span>
        </div>
      )}

      <div className="fd-finding-foot">
        <span className="fd-press-hint">Select</span>
        <span className="fd-kbd">Enter</span>
      </div>
    </button>
  )
}