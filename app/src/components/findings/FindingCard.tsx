// OWNER: Agent 3 (Findings Inspector). Finding card rendered in the done list.
// Evidence comes first (classifier cross-check, then benchmark track record); the model's own confidence is
// shown last as plain text because it is not calibrated. Excluded findings stay visible with an explicit label.
import { useEffect, useRef } from 'react'
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react'
import type { AnalysisResult, Finding, FindingReview } from '../../types'
import { SEVERITY_LABEL } from '../../types'
import { AlertTriangle, BarChart3, Check, CheckCircle2, Cloud, Crop, Eye, HelpCircle, Users, X } from 'lucide-react'
import { BENCHMARK, reliabilityFor } from '../../lib/reliability'
import { isExcluded, isUnconfirmed, isUnsupported } from '../../lib/classifier'
import { useActiveImage } from '../../store'
import { useShell } from '../shell/shellState'
import './findings.css'

interface Props {
  finding: Finding
  /** 1-based index in findings order — must match the viewer's burned-in numbers. */
  number: number
  classifierStatus: AnalysisResult['classifierStatus']
  isExpanded: boolean
  isHovered: boolean
  isSelected: boolean
  /** Roving tab stop: exactly one card in the list is tabbable. */
  isTabStop: boolean
  /** Keyboard focus is inside this card — only then is the key hint shown. */
  isFocused: boolean
  flatIndex: number
  flatTotal: number
  onHover: (id: string | null) => void
  onToggle: (id: string) => void
  onReview: (id: string, review: FindingReview | undefined) => void
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void
  onFocusChange: (id: string | null) => void
  buttonRef: (el: HTMLButtonElement | null) => void
}

const pct = (p: number) => `${Math.round(p * 100)}%`

/** One line saying what independent evidence exists for this finding. */
function evidenceLine(f: Finding, status: AnalysisResult['classifierStatus']): { text: string; tone: 'ok' | 'warn' | 'muted' } | null {
  if (f.severity === 'normal') return null
  const c = f.classifier
  if (c) {
    if (c.supported === null || c.prob === null) return { text: 'Classifier cannot assess this type', tone: 'muted' }
    const thr = c.thr != null ? ` (threshold ${pct(c.thr)}, ${c.thrSource ?? 'default'})` : ''
    const cal = c.calibrated != null ? ` · est. ~${pct(c.calibrated)} from ChestX-Det dev` : ''
    return {
      text: `Classifier ${c.supported ? 'supports' : 'does not support'} · ${c.kind} ${pct(c.prob)}${thr}${cal}`,
      tone: c.supported ? 'ok' : 'warn',
    }
  }
  if (status === 'unavailable') return { text: 'Classifier not running — not cross-checked', tone: 'warn' }
  if (status === 'error') return { text: 'Classifier failed — not cross-checked', tone: 'warn' }
  if (status === 'ok') return { text: 'Classifier cannot assess this type', tone: 'muted' }
  return null // analyses from before the classifier status was recorded
}

/** Why the finding is or is not in the draft report, when that differs from the default. */
function draftNote(f: Finding): string | null {
  if (f.severity === 'normal') return null
  if (f.review === 'dismissed') return 'Dismissed by reviewer · Not in draft report'
  if (isUnconfirmed(f)) return 'In draft as unconfirmed · classifier did not support it — verify, then Accept or Dismiss'
  if (f.review === 'accepted') return isUnsupported(f) ? 'Accepted by reviewer · included despite classifier' : 'Accepted by reviewer · included in draft report'
  return null
}

export function FindingCard({
  finding,
  number,
  classifierStatus,
  isExpanded,
  isHovered,
  isSelected,
  isTabStop,
  isFocused,
  flatIndex,
  flatTotal,
  onHover,
  onToggle,
  onReview,
  onKeyDown,
  onFocusChange,
  buttonRef,
}: Props) {
  const localized = finding.bbox != null && (finding.bbox.w ?? 0) > 0
  const activeImage = useActiveImage()
  const rel = reliabilityFor(finding, activeImage?.analysis?.model ?? '')
  const evidence = evidenceLine(finding, classifierStatus)
  const excluded = finding.severity !== 'normal' && isExcluded(finding)
  const unconfirmed = finding.severity !== 'normal' && isUnconfirmed(finding)
  const note = draftNote(finding)
  const review = finding.review
  const confText = `Model-stated ${pct(finding.confidence)} (uncalibrated)`

  // Clicks on the card body select it too; its own buttons handle themselves.
  const onCardClick = (e: MouseEvent<HTMLLIElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    onToggle(finding.id)
  }
  const onBlur = (e: FocusEvent<HTMLLIElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onFocusChange(null)
  }

  return (
    <li
      data-severity={finding.severity}
      data-excluded={excluded || undefined}
      data-unconfirmed={unconfirmed || undefined}
      className={`fd-finding${isSelected ? ' fd-finding--sel' : ''}${isHovered ? ' fd-finding--hv' : ''}`}
      onMouseEnter={() => onHover(finding.id)}
      onMouseLeave={() => onHover(null)}
      onClick={onCardClick}
      onFocus={() => onFocusChange(finding.id)}
      onBlur={onBlur}
    >
      <button
        type="button"
        ref={buttonRef}
        className="fd-finding-main"
        aria-expanded={isExpanded}
        aria-label={`Finding ${number}: ${finding.title}, ${SEVERITY_LABEL[finding.severity]}${excluded ? ', not in draft report' : unconfirmed ? ', unconfirmed by classifier' : ''}`}
        tabIndex={isTabStop ? 0 : -1}
        onKeyDown={onKeyDown}
        onClick={() => onToggle(finding.id)}
      >
        <span className="fd-finding-head">
          <span className="fd-num" aria-hidden="true">
            {number}
          </span>
          <span className="fd-badge">{SEVERITY_LABEL[finding.severity]}</span>
          {finding.source === 'maira2' && (
            <span className="fd-icon-tag" title="Added by the optional MAIRA-2 second reader">
              <Users aria-hidden="true" /> Second reader (MAIRA-2)
            </span>
          )}
          <span className="fd-local" title={localized ? 'Localized on image' : 'Not localized on image'}>
            {localized ? <Crop aria-hidden="true" /> : <Cloud aria-hidden="true" />}
          </span>
        </span>
        <span className="fd-finding-title">{finding.title}</span>
        <span className="fd-location">{[finding.location, finding.category].filter(Boolean).join(' · ') || '—'}</span>
      </button>

      {note && (
        <div className="fd-draft-note" data-tone={excluded || unconfirmed ? 'out' : 'in'}>
          {excluded ? <X aria-hidden="true" /> : unconfirmed ? <AlertTriangle aria-hidden="true" /> : <Check aria-hidden="true" />}
          <span>{note}</span>
        </div>
      )}

      {evidence && (
        <div
          className={`fd-rel${evidence.tone === 'warn' ? ' fd-rel--weak' : ''}`}
          title="TorchXRayVision chest X-ray classifier, run locally as an independent cross-check"
        >
          {evidence.tone === 'ok' ? <Check aria-hidden="true" /> : evidence.tone === 'warn' ? <AlertTriangle aria-hidden="true" /> : <HelpCircle aria-hidden="true" />}
          <span>{evidence.text}</span>
        </div>
      )}

      {rel && (
        <div className={`fd-rel${rel.weak ? ' fd-rel--weak' : ''}`} title={BENCHMARK.label}>
          {rel.weak ? <AlertTriangle aria-hidden="true" /> : <BarChart3 aria-hidden="true" />}
          <span>
            Benchmark · {rel.kind}: {rel.correct} of {rel.total} confirmed
            {rel.lowN ? ' · n small' : ''}
            {rel.weak ? ' — verify carefully' : ''}
          </span>
        </div>
      )}

      <div className="fd-conf" title="Self-reported by the model; false findings are often stated at 90%+">
        {confText}
      </div>

      {isExpanded && localized && <>
        <FindingCrop finding={finding} dashed={unconfirmed} />
        <button className="fd-view-image" type="button" onClick={() => useShell.getState().setMobileView('viewer')}><Eye size={15} /> View location on image</button>
      </>}

      <p className={`fd-desc ${isExpanded ? 'fd-desc--open' : ''}`}>{finding.description}</p>

      {finding.recommendation && (
        <div className="fd-rec">
          <CheckCircle2 aria-hidden="true" />
          <span>{finding.recommendation}</span>
        </div>
      )}

      {finding.severity !== 'normal' && (
        <div className="fd-review" role="group" aria-label={`Review finding ${number}`}>
          <button
            type="button"
            className="fd-review-btn"
            data-on={review === 'accepted' || undefined}
            aria-pressed={review === 'accepted'}
            tabIndex={isTabStop ? 0 : -1}
            onClick={() => onReview(finding.id, review === 'accepted' ? undefined : 'accepted')}
          >
            <Check aria-hidden="true" /> {review === 'accepted' ? 'Accepted' : 'Accept'}
          </button>
          <button
            type="button"
            className="fd-review-btn"
            data-kind="dismiss"
            data-on={review === 'dismissed' || undefined}
            aria-pressed={review === 'dismissed'}
            tabIndex={isTabStop ? 0 : -1}
            onClick={() => onReview(finding.id, review === 'dismissed' ? undefined : 'dismissed')}
          >
            <X aria-hidden="true" /> {review === 'dismissed' ? 'Dismissed' : 'Dismiss'}
          </button>
        </div>
      )}

      {isFocused && (
        <div className="fd-keys" aria-hidden="true">
          <span>
            {flatIndex + 1} / {flatTotal} · Enter to expand · ↑ ↓ to move
          </span>
        </div>
      )}
    </li>
  )
}

/** Close-up of the finding's box with some context around it, for the expanded card. */
function FindingCrop({ finding, dashed }: { finding: Finding; dashed: boolean }) {
  const image = useActiveImage()
  const ref = useRef<HTMLCanvasElement>(null)
  const src = image?.dataUrl
  const b = finding.bbox
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !src || !b) return
    const img = new Image()
    img.onload = () => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const W = canvas.width
      const H = canvas.height
      // Box plus 35% margin, widened to the canvas aspect, clamped to the image.
      let w = b.w * img.width * 1.7
      let h = b.h * img.height * 1.7
      if (w / h > W / H) h = (w * H) / W
      else w = (h * W) / H
      w = Math.min(w, img.width)
      h = Math.min(h, img.height)
      const cx = (b.x + b.w / 2) * img.width
      const cy = (b.y + b.h / 2) * img.height
      const sx = Math.min(Math.max(0, cx - w / 2), img.width - w)
      const sy = Math.min(Math.max(0, cy - h / 2), img.height - h)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, W, H)
      const k = Math.min(W / w, H / h)
      const ox = (W - w * k) / 2
      const oy = (H - h * k) / 2
      ctx.drawImage(img, sx, sy, w, h, ox, oy, w * k, h * k)
      const color = getComputedStyle(canvas).getPropertyValue(`--sev-${finding.severity}`).trim() || '#ff9f0a'
      ctx.strokeStyle = color
      ctx.lineWidth = 3
      ctx.setLineDash(dashed ? [10, 6] : [])
      ctx.strokeRect(ox + (b.x * img.width - sx) * k, oy + (b.y * img.height - sy) * k, b.w * img.width * k, b.h * img.height * k)
    }
    img.src = src
  }, [src, b, finding.severity, dashed])
  if (!src || !b) return null
  return (
    <figure className="fd-crop">
      <canvas ref={ref} width={640} height={400} role="img" aria-label={`Close-up of ${finding.title}`} />
      <figcaption>Close-up · box drawn by the model, approximate</figcaption>
    </figure>
  )
}
