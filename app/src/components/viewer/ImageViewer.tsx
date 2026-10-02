// Diagnostic image viewer: fit/zoom/pan, window-level, invert, finding overlays locked to the image.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { Contrast, Eye, EyeOff, Maximize, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import type { Finding, ViewerState } from '../../types'
import { useActiveImage, useActiveStudy, useApp } from '../../store'
import { findingCounts, isExcluded, isUnconfirmed, worstSeverity } from '../../lib/classifier'
import { countLabel } from '../shell/shellState'
import { Dropzone } from './Dropzone'
import './viewer.css'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 8
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const area = (f: Finding) => (f.bbox ? f.bbox.w * f.bbox.h : 0)

const PRESETS: { id: string; label: string; brightness: number; contrast: number }[] = [
  { id: 'default', label: 'Default', brightness: 100, contrast: 100 },
  { id: 'lung', label: 'Lung', brightness: 92, contrast: 145 },
  { id: 'bone', label: 'Bone', brightness: 108, contrast: 170 },
  { id: 'soft', label: 'Soft tissue', brightness: 112, contrast: 80 },
]

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

export function ImageViewer() {
  const study = useActiveStudy()
  const image = useActiveImage()
  const viewer = useApp((s) => s.viewer)
  const selectedId = useApp((s) => s.selectedFindingId)
  const hoveredId = useApp((s) => s.hoveredFindingId)
  const { setViewer, resetViewer, selectFinding, hoverFinding, setInspectorTab, selectImage } = useApp.getState()

  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const drag = useRef<null | { mode: 'pan' | 'wl'; x: number; y: number; v: ViewerState }>(null)

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [image?.id])

  const fit = image && stage.w ? Math.min(stage.w / image.width, stage.h / image.height) * 0.94 : 1
  const scale = fit * viewer.zoom
  const dispW = image ? image.width * scale : 0
  const dispH = image ? image.height * scale : 0

  const zoomAt = useCallback(
    (next: number, px = 0, py = 0) => {
      const v = useApp.getState().viewer
      const z = clamp(next, MIN_ZOOM, MAX_ZOOM)
      const k = z / v.zoom
      // Keep the image point under (px,py) — relative to stage center — fixed.
      setViewer({ zoom: z, panX: px - (px - v.panX) * k, panY: py - (py - v.panY) * k })
    },
    [setViewer],
  )

  const onWheel = (e: ReactWheelEvent) => {
    const rect = stageRef.current!.getBoundingClientRect()
    const px = e.clientX - rect.left - rect.width / 2
    const py = e.clientY - rect.top - rect.height / 2
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025))
    zoomAt(viewer.zoom * factor, px, py)
  }

  // Wheel must be non-passive to stop the page from scrolling/zooming.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const stop = (e: WheelEvent) => e.preventDefault()
    el.addEventListener('wheel', stop, { passive: false })
    return () => el.removeEventListener('wheel', stop)
  }, [image?.id])

  const onPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('.vw-toolbox, .vw-finding')) return
    const wl = e.button === 2 || e.altKey
    if (e.button !== 0 && !wl) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { mode: wl ? 'wl' : 'pan', x: e.clientX, y: e.clientY, v: useApp.getState().viewer }
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (d.mode === 'pan') setViewer({ panX: d.v.panX + dx, panY: d.v.panY + dy })
    else
      setViewer({
        contrast: clamp(Math.round(d.v.contrast + dx * 0.5), 20, 400),
        brightness: clamp(Math.round(d.v.brightness - dy * 0.4), 20, 300),
      })
  }
  const onPointerUp = () => (drag.current = null)

  // Keyboard shortcuts.
  useEffect(() => {
    if (!image) return
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey) return
      const v = useApp.getState().viewer
      const imgs = study?.images ?? []
      const idx = imgs.findIndex((i) => i.id === image.id)
      switch (e.key) {
        case '+':
        case '=':
          zoomAt(v.zoom * 1.25)
          break
        case '-':
          zoomAt(v.zoom / 1.25)
          break
        case '0':
          setViewer({ zoom: 1, panX: 0, panY: 0 })
          break
        case 'i':
          setViewer({ invert: !v.invert })
          break
        case 'o':
          setViewer({ showOverlay: !v.showOverlay })
          break
        case 'r':
          resetViewer()
          break
        case 'Escape':
          selectFinding(null)
          break
        case 'ArrowRight':
        case 'ArrowLeft': {
          const next = imgs[idx + (e.key === 'ArrowRight' ? 1 : -1)]
          if (next) selectImage(next.id)
          break
        }
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [image, study, zoomAt, setViewer, resetViewer, selectFinding, selectImage])

  // Bring a finding selected from the inspector into view when zoomed in.
  useEffect(() => {
    const f = image?.analysis?.findings.find((x) => x.id === selectedId)
    const v = useApp.getState().viewer
    if (!f?.bbox || v.zoom <= 1) return
    const cx = (f.bbox.x + f.bbox.w / 2 - 0.5) * dispW
    const cy = (f.bbox.y + f.bbox.h / 2 - 0.5) * dispH
    setViewer({ panX: -cx, panY: -cy })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const analysis = image?.analysis
  const findings = useMemo(() => analysis?.findings ?? [], [analysis])
  // Same helpers as the filmstrip, sidebar and inspector so every count agrees.
  const worst = useMemo(() => worstSeverity(findings), [findings])
  const counts = useMemo(() => findingCounts(analysis), [analysis])
  // Numbers as drawn on the boxes and cards (1-based position in the full findings list).
  const unlocalized = useMemo(
    () => findings.flatMap((f, i) => (f.severity !== 'normal' && !isExcluded(f) && !(f.bbox && f.bbox.w > 0) ? [i + 1] : [])),
    [findings],
  )

  if (!study) return <div className="vw-stage" />
  if (!study.images.length) return <Dropzone studyId={study.id} />
  if (!image) return <div className="vw-stage" />

  const focusId = selectedId ?? hoveredId
  const view = image.analysis?.view ?? ''
  const showLat = /\b(PA|AP|posteroanterior|anteroposterior)\b/i.test(view)
  const presetId =
    PRESETS.find((p) => p.brightness === viewer.brightness && p.contrast === viewer.contrast)?.id ?? 'custom'
  const p = study.patient

  return (
    <div
      ref={stageRef}
      className={`vw-stage${focusId && viewer.showOverlay ? ' vw-hl' : ''}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('.vw-toolbox, .vw-finding')) return
        if (viewer.zoom > 1.01) setViewer({ zoom: 1, panX: 0, panY: 0 })
        else {
          const rect = stageRef.current!.getBoundingClientRect()
          zoomAt(2, e.clientX - rect.left - rect.width / 2, e.clientY - rect.top - rect.height / 2)
        }
      }}
      style={{ cursor: drag.current ? 'grabbing' : 'grab' }}
      aria-label={`X-ray viewer: ${image.name}`}
    >
      <div
        className="vw-canvas"
        style={{
          width: dispW,
          height: dispH,
          transform: `translate(calc(-50% + ${viewer.panX}px), calc(-50% + ${viewer.panY}px))`,
        }}
      >
        <img
          className="vw-src"
          src={image.dataUrl}
          alt={image.name}
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            filter: `brightness(${viewer.brightness}%) contrast(${viewer.contrast}%)${viewer.invert ? ' invert(1)' : ''}`,
          }}
        />
        {showLat && <div className="vw-lat">R</div>}
        {viewer.showOverlay && (
          <div className="vw-overlays">
            {/* Larger boxes first so smaller (nested) boxes stay on top and clickable. */}
            {findings
              .map((f, i) => ({ f, i }))
              .sort((a, b) => area(b.f) - area(a.f))
              .map(({ f, i }) => (
              <FindingBox
                key={f.id}
                f={f}
                n={i + 1}
                on={f.id === focusId}
                selected={f.id === selectedId}
                onHover={(on) => hoverFinding(on ? f.id : null)}
                onSelect={() => {
                  selectFinding(f.id === selectedId ? null : f.id)
                  setInspectorTab('findings')
                }}
              />
            ))}
          </div>
        )}
        {image.status === 'analyzing' && <div className="vw-scan" />}
      </div>

      <div className="vw-info" style={{ top: 'var(--sp-3)', left: 'var(--sp-3)' }}>
        <span className="vw-name">{p.name || 'Unnamed patient'}</span>
        <span className="vw-row">
          {p.patientId && <span><span className="vw-k">ID </span><span className="vw-val">{p.patientId}</span></span>}
          {p.studyDate && <span><span className="vw-k">Date </span><span className="vw-val">{p.studyDate}</span></span>}
        </span>
        <span className="vw-row"><span className="vw-val">{image.name}</span></span>
        <span className="vw-row">
          <span><span className="vw-k">W </span><span className="vw-val">{viewer.contrast}</span></span>
          <span><span className="vw-k">L </span><span className="vw-val">{viewer.brightness}</span></span>
          <span><span className="vw-k">Zoom </span><span className="vw-val">{Math.round(scale * 100)}%</span></span>
          {viewer.invert && <span className="vw-val">INV</span>}
        </span>
      </div>

      {image.status === 'analyzing' && (
        <div className="vw-capsule" role="status">
          <span className="vw-spin" />
          {image.progressText || 'Analyzing…'}
        </div>
      )}

      {image.analysis && (
        <div className="vw-hud-rt">
          <div className="vw-badge-rt">
            <span className="vw-sev" style={{ background: `var(--sev-${worst ?? 'normal'})` }} />
            {counts.active || counts.flagged ? countLabel(counts.active, counts.flagged) : 'No acute findings'}
          </div>
          {viewer.showOverlay && unlocalized.length > 0 && (
            <div className="vw-legend">Not localized: {unlocalized.map((n) => `#${n}`).join(', ')}</div>
          )}
          {viewer.showOverlay && counts.flagged > 0 && (
            <div className="vw-legend">
              <span className="vw-legend-swatch" aria-hidden="true" /> dotted = not in draft report
            </div>
          )}
        </div>
      )}

      <div className="vw-toolbox" role="toolbar" aria-label="Viewer tools" onPointerDown={(e) => e.stopPropagation()}>
        <button className="vw-tool" aria-label="Zoom out (−)" title="Zoom out (−)" onClick={() => zoomAt(viewer.zoom / 1.25)}>
          <ZoomOut strokeWidth={1.75} />
        </button>
        <span className="vw-zoom">{Math.round(scale * 100)}%</span>
        <button className="vw-tool" aria-label="Zoom in (+)" title="Zoom in (+)" onClick={() => zoomAt(viewer.zoom * 1.25)}>
          <ZoomIn strokeWidth={1.75} />
        </button>
        <button className="vw-tool" aria-label="Fit to view (0)" title="Fit to view (0)" onClick={() => setViewer({ zoom: 1, panX: 0, panY: 0 })}>
          <Maximize strokeWidth={1.75} />
        </button>
        <span className="vw-sep" />
        <select
          className="vw-sel"
          aria-label="Window preset"
          title="Window preset — or right-drag / ⌥-drag on the image"
          value={presetId}
          onChange={(e) => {
            const pr = PRESETS.find((x) => x.id === e.target.value)
            if (pr) setViewer({ brightness: pr.brightness, contrast: pr.contrast })
          }}
        >
          {PRESETS.map((pr) => (
            <option key={pr.id} value={pr.id}>{pr.label}</option>
          ))}
          {presetId === 'custom' && <option value="custom">Custom</option>}
        </select>
        <button
          className="vw-tool"
          aria-label="Invert (I)"
          title="Invert (I)"
          aria-pressed={viewer.invert}
          onClick={() => setViewer({ invert: !viewer.invert })}
        >
          <Contrast strokeWidth={1.75} />
        </button>
        <button
          className="vw-tool"
          aria-label="Toggle findings overlay (O)"
          title="Findings overlay (O)"
          aria-pressed={viewer.showOverlay}
          disabled={!findings.length}
          onClick={() => setViewer({ showOverlay: !viewer.showOverlay })}
        >
          {viewer.showOverlay ? <Eye strokeWidth={1.75} /> : <EyeOff strokeWidth={1.75} />}
        </button>
        <span className="vw-sep" />
        <button className="vw-tool" aria-label="Reset view (R)" title="Reset view (R)" onClick={resetViewer}>
          <RotateCcw strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}

function FindingBox({
  f,
  n,
  on,
  selected,
  onHover,
  onSelect,
}: {
  f: Finding
  n: number
  on: boolean
  selected: boolean
  onHover: (on: boolean) => void
  onSelect: () => void
}) {
  if (!f.bbox) return null
  const { x, y, w, h } = f.bbox
  const excluded = f.severity !== 'normal' && isExcluded(f)
  return (
    <div
      className={`vw-finding${on ? ' vw-hl-on' : ''}${selected ? ' vw-found' : ''}`}
      data-severity={f.severity}
      data-excluded={excluded || undefined}
      data-unconfirmed={(f.severity !== 'normal' && isUnconfirmed(f)) || undefined}
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      role="button"
      tabIndex={0}
      aria-label={`Finding ${n}: ${f.title}${excluded ? ' (not in draft report)' : ''}`}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <span className="vw-chip">{excluded ? `${n}?` : n}</span>
      <span className="vw-label">{f.title}</span>
    </div>
  )
}
