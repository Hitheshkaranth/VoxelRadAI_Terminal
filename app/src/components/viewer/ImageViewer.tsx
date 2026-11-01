// Diagnostic image viewer: fit/zoom/pan, window-level, invert, finding overlays locked to the image.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { Columns2, Contrast, Eye, EyeOff, Flame, Layers, Maximize, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import type { Finding, Heatmap, OverlayStyle, ViewerState } from '../../types'
import { useActiveImage, useActiveStudy, useApp } from '../../store'
import { findingCounts, isExcluded, isUnconfirmed, worstSeverity } from '../../lib/classifier'
import { HEAT_ACCURACY, findingHeat, heatOverlayUrl } from '../../lib/heatmap'
import { pinchTransform, touchGeometry, type PinchAnchor, type TouchPoint } from './gestures'
import { maskAlphaUrl } from '../../lib/maskOverlay'
import { countLabel } from '../shell/shellState'
import { Dropzone } from './Dropzone'
import './viewer.css'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 8
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const area = (f: Finding) => (f.bbox ? f.bbox.w * f.bbox.h : 0)
/** Share of the stage a focused finding's box fills, and the most a focus may zoom. */
const FOCUS_FILL = 0.6
const FOCUS_MAX_ZOOM = 4
const FOCUS_ANIM_MS = 260

const PRESETS: { id: string; label: string; brightness: number; contrast: number }[] = [
  { id: 'default', label: 'Default', brightness: 100, contrast: 100 },
  { id: 'lung', label: 'Lung', brightness: 92, contrast: 145 },
  { id: 'bone', label: 'Bone', brightness: 108, contrast: 170 },
  { id: 'soft', label: 'Soft tissue', brightness: 112, contrast: 80 },
]

const STYLES: { id: OverlayStyle; label: string; hint: string }[] = [
  { id: 'box', label: 'Box', hint: 'Boxes only' },
  { id: 'outline', label: 'Outline', hint: 'Outline of each segmented finding' },
  { id: 'fill', label: 'Fill', hint: 'Filled outline (opacity below)' },
]
/** Clicks on these never start a pan or window-level drag. */
const UI = '.vw-toolbox, .vw-finding, .vw-compare, .vw-layers-panel'

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

export function ImageViewer() {
  const study = useActiveStudy()
  const image = useActiveImage()
  const viewer = useApp((s) => s.viewer)
  const selectedId = useApp((s) => s.selectedFindingId)
  const hoveredId = useApp((s) => s.hoveredFindingId)
  const { setViewer, resetViewer, selectFinding, hoverFinding, setInspectorTab, selectImage } = useApp.getState()

  const touches = useRef(new Map<number, TouchPoint>())
  const pinch = useRef<PinchAnchor | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [layersOpen, setLayersOpen] = useState(false)
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const [animating, setAnimating] = useState(false)
  const focused = useRef(false)
  const drag = useRef<null | { pointerId: number; mode: 'pan' | 'wl'; x: number; y: number; v: ViewerState }>(null)

  const cancelGesture = useCallback(() => {
    const ids = [...touches.current.keys()]
    if (drag.current) ids.push(drag.current.pointerId)
    touches.current.clear()
    pinch.current = null
    drag.current = null
    // Clear state before release: lostpointercapture can be delivered synchronously.
    for (const id of ids) {
      const el = stageRef.current
      if (el?.hasPointerCapture(id)) el.releasePointerCapture(id)
    }
  }, [])

  useLayoutEffect(() => {
    cancelGesture()
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      // Rotation, panel resize and display:none change the coordinate origin/fit.
      // End the gesture rather than applying its old anchor to the new viewport.
      cancelGesture()
      setStage({ w: e.contentRect.width, h: e.contentRect.height })
    })
    ro.observe(el)
    return () => { ro.disconnect(); cancelGesture() }
  }, [image?.id, cancelGesture])

  useEffect(() => {
    const onVisibility = () => { if (document.hidden) cancelGesture() }
    window.addEventListener('blur', cancelGesture)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', cancelGesture)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [cancelGesture])

  const fit = image && stage.w ? Math.min(stage.w / image.width, stage.h / image.height) * 0.98 : 1
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

  const localPoint = (e: ReactPointerEvent): TouchPoint => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 }
  }
  const onPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest(UI)) return
    const wl = e.button === 2 || e.altKey
    if (e.button !== 0 && !wl) return
    // Use exactly two contacts; extra fingers cannot replace the active pair.
    if (e.pointerType === 'touch' && touches.current.size >= 2) return
    e.currentTarget.setPointerCapture(e.pointerId)
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, localPoint(e))
      if (touches.current.size >= 2) {
        const [a, b] = [...touches.current.values()]
        pinch.current = { ...touchGeometry(a, b), view: useApp.getState().viewer }
        drag.current = null
        return
      }
    }
    drag.current = { pointerId: e.pointerId, mode: wl ? 'wl' : 'pan', x: e.clientX, y: e.clientY, v: useApp.getState().viewer }
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    if (touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, localPoint(e))
      if (touches.current.size >= 2 && pinch.current) {
        const [a, b] = [...touches.current.values()]
        setViewer(pinchTransform(pinch.current, a, b))
        return
      }
    }
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (d.mode === 'pan') setViewer({ panX: d.v.panX + dx, panY: d.v.panY + dy })
    else
      setViewer({
        contrast: clamp(Math.round(d.v.contrast + dx * 0.5), 20, 400),
        brightness: clamp(Math.round(d.v.brightness - dy * 0.4), 20, 300),
      })
  }
  const onPointerUp = (e: ReactPointerEvent) => {
    if (!touches.current.has(e.pointerId) && drag.current?.pointerId !== e.pointerId) return
    touches.current.delete(e.pointerId)
    pinch.current = null
    drag.current = null
    if (touches.current.size >= 2) {
      const [a, b] = [...touches.current.values()]
      pinch.current = { ...touchGeometry(a, b), view: useApp.getState().viewer }
    } else if (touches.current.size === 1) {
      // Rebase the remaining finger after a pinch so the next pan cannot jump.
      const [pointerId, point] = [...touches.current.entries()][0]
      const rect = e.currentTarget.getBoundingClientRect()
      drag.current = { pointerId, mode: 'pan', x: point.x + rect.left + rect.width / 2, y: point.y + rect.top + rect.height / 2, v: useApp.getState().viewer }
    }
  }

  // Keyboard shortcuts.
  useEffect(() => {
    if (!image) return
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || !stageRef.current?.getClientRects().length) return
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
        case 'h':
          setViewer({ showHeatmap: !v.showHeatmap })
          break
        case 'm': {
          const k = STYLES.findIndex((x) => x.id === v.overlayStyle)
          setViewer({ overlayStyle: STYLES[(k + 1) % STYLES.length].id })
          break
        }
        case 'c':
          setViewer({ compare: !v.compare })
          break
        case 'r':
          resetViewer()
          break
        case 'Escape':
          if (layersOpen) setLayersOpen(false)
          else selectFinding(null)
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
  }, [image, study, zoomAt, setViewer, resetViewer, selectFinding, selectImage, layersOpen])

  // Selecting a finding zooms onto its box; clearing the selection (Esc, click again) returns to the whole film.
  useEffect(() => {
    if (!image || !stage.w) return
    const f = image.analysis?.findings.find((x) => x.id === selectedId)
    const animate = () => {
      setAnimating(true)
      window.setTimeout(() => setAnimating(false), FOCUS_ANIM_MS)
    }
    if (!f) {
      if (focused.current) {
        focused.current = false
        animate()
        setViewer({ zoom: 1, panX: 0, panY: 0 })
      }
      return
    }
    if (!f.bbox || !(f.bbox.w > 0) || !(f.bbox.h > 0)) return
    const z = clamp(
      Math.min((stage.w * FOCUS_FILL) / (f.bbox.w * image.width * fit), (stage.h * FOCUS_FILL) / (f.bbox.h * image.height * fit)),
      1,
      FOCUS_MAX_ZOOM,
    )
    focused.current = true
    animate()
    setViewer({
      zoom: z,
      panX: -(f.bbox.x + f.bbox.w / 2 - 0.5) * image.width * fit * z,
      panY: -(f.bbox.y + f.bbox.h / 2 - 0.5) * image.height * fit * z,
    })
    // Only a change of selection should move the view, not every resize or analysis update.
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
  const focusFinding = findings.find((f) => f.id === focusId)
  const hasHeatmaps = !!analysis?.heatmaps && Object.keys(analysis.heatmaps).length > 0
  // The selected (or hovered) finding's region, or every abnormal finding's region when nothing is selected.
  const heatSources = viewer.showHeatmap && hasHeatmaps ? heatmapSources(findings, focusFinding, analysis?.heatmaps ?? {}) : []
  const heatKinds = [...new Set(heatSources.map((h) => h.kind))]
  const view = image.analysis?.view ?? ''
  const showLat = /\b(PA|AP|posteroanterior|anteroposterior)\b/i.test(view)
  const presetId =
    PRESETS.find((p) => p.brightness === viewer.brightness && p.contrast === viewer.contrast)?.id ?? 'custom'
  const p = study.patient
  const hidden = new Set(viewer.hiddenFindings)
  const shown = findings.map((f, i) => ({ f, i })).filter(({ f }) => !hidden.has(f.id))
  const hasMasks = findings.some((f) => f.mask)
  const maskMode = viewer.overlayStyle === 'box' ? null : viewer.overlayStyle
  const toggleHidden = (id: string) =>
    setViewer({ hiddenFindings: hidden.has(id) ? viewer.hiddenFindings.filter((x) => x !== id) : [...viewer.hiddenFindings, id] })
  const dragCompare = (e: ReactPointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (rect && rect.width) setViewer({ comparePos: clamp((e.clientX - rect.left) / rect.width, 0, 1) })
  }

  return (
    <div className="vw-workspace">
    <div
      ref={stageRef}
      className={`vw-stage${focusId && viewer.showOverlay ? ' vw-hl' : ''}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancelGesture}
      onLostPointerCapture={(e) => {
        // Normal pointerup already removes the pointer. An unexpected capture
        // loss ends the entire gesture, including any remaining touch contact.
        if (touches.current.has(e.pointerId) || drag.current?.pointerId === e.pointerId) cancelGesture()
      }}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest(UI)) return
        if (viewer.zoom > 1.01) setViewer({ zoom: 1, panX: 0, panY: 0 })
        else {
          const rect = stageRef.current!.getBoundingClientRect()
          zoomAt(2, e.clientX - rect.left - rect.width / 2, e.clientY - rect.top - rect.height / 2)
        }
      }}
      style={{ cursor: drag.current ? 'grabbing' : 'grab' }}
      aria-label={`Image viewer: ${image.name}`}
    >
      <div
        ref={canvasRef}
        className={`vw-canvas${animating ? ' vw-anim' : ''}`}
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
        {/* Everything drawn over the film; with the divider on, only to its right (the left shows the plain film). */}
        <div
          className="vw-layers"
          style={viewer.compare ? { clipPath: `inset(0 0 0 ${viewer.comparePos * 100}%)` } : undefined}
        >
        {heatSources.length > 0 && <HeatmapLayer sources={heatSources} />}
        {viewer.showOverlay && maskMode && (
          <div className="vw-masks" aria-hidden="true">
            {shown
              .filter(({ f }) => f.mask)
              .map(({ f }) => (
                <MaskLayer
                  key={f.id}
                  f={f}
                  fill={maskMode === 'fill'}
                  opacity={viewer.overlayOpacity}
                  on={f.id === focusId}
                />
              ))}
          </div>
        )}
        {viewer.showOverlay && (
          <div className="vw-overlays">
            {/* Larger boxes first so smaller (nested) boxes stay on top and clickable. */}
            {shown
              .sort((a, b) => area(b.f) - area(a.f))
              .map(({ f, i }) => (
              <FindingBox
                key={f.id}
                f={f}
                n={i + 1}
                masked={!!maskMode && !!f.mask}
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
        </div>
        {viewer.compare && (
          <div
            className="vw-compare"
            style={{ left: `${viewer.comparePos * 100}%` }}
            role="slider"
            aria-label="Before / after divider (C)"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(viewer.comparePos * 100)}
            tabIndex={0}
            onPointerDown={(e) => {
              e.stopPropagation()
              e.currentTarget.setPointerCapture(e.pointerId)
              dragCompare(e)
            }}
            onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && dragCompare(e)}
            onKeyDown={(e) => {
              const step = e.key === 'ArrowLeft' ? -0.05 : e.key === 'ArrowRight' ? 0.05 : 0
              if (step) {
                e.preventDefault()
                e.stopPropagation()
                setViewer({ comparePos: clamp(viewer.comparePos + step, 0, 1) })
              }
            }}
          >
            <span className="vw-compare-grip" />
            <span className="vw-compare-tag vw-compare-l">Film</span>
            <span className="vw-compare-tag vw-compare-r">Overlay</span>
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
          <span><span className="vw-k">Contrast </span><span className="vw-val">{viewer.contrast}</span></span>
          <span><span className="vw-k">Brightness </span><span className="vw-val">{viewer.brightness}</span></span>
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

    </div>
      {image.analysis && (
        <div className="vw-evidence" aria-label="Image analysis context">
          <div className="vw-badge-rt">
            <span className="vw-sev" style={{ background: `var(--sev-${worst ?? 'normal'})` }} />
            {counts.active || counts.flagged ? countLabel(counts.active, counts.flagged) : 'No acute findings'}
          </div>
          {viewer.showOverlay && unlocalized.length > 0 && (
            <div className="vw-legend">Not localized: {unlocalized.map((n) => `#${n}`).join(', ')}</div>
          )}
          {viewer.showHeatmap && hasHeatmaps && (
            <details className="vw-evidence-details">
              <summary><span className="vw-heat-ramp" aria-hidden="true" />Classifier heatmap · coarse evidence <span className="vw-evidence-more">Details</span></summary>
              <div className="vw-evidence-description">
                {heatKinds.length
                  ? `Classifier evidence for ${heatKinds.join(', ')} within each finding's region (#n: strength vs the film's peak)${focusFinding ? '' : ', all findings'}. `
                  : 'No classifier region for this finding type. '}
                On held-out films the peak hit the lesion {HEAT_ACCURACY} of the time. This is classifier evidence, not a segmentation mask.
              </div>
            </details>
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
        <button
          className="vw-tool"
          aria-label="Toggle classifier heatmap (H)"
          title={hasHeatmaps ? 'Classifier heatmap for the selected finding (H)' : 'No classifier heatmap for this image — re-analyze with the classifier running'}
          aria-pressed={viewer.showHeatmap}
          disabled={!hasHeatmaps}
          onClick={() => setViewer({ showHeatmap: !viewer.showHeatmap })}
        >
          <Flame strokeWidth={1.75} />
        </button>
        <button
          className="vw-tool"
          aria-label="Before / after divider (C)"
          title="Before / after divider (C): plain film on the left, overlays on the right"
          aria-pressed={viewer.compare}
          disabled={!findings.length && !hasHeatmaps}
          onClick={() => setViewer({ compare: !viewer.compare })}
        >
          <Columns2 strokeWidth={1.75} />
        </button>
        <button
          className="vw-tool"
          aria-label="Overlay display"
          title="Overlay display: outline / fill (M), opacity, which findings to show"
          aria-pressed={layersOpen}
          aria-expanded={layersOpen}
          disabled={!findings.length}
          onClick={() => setLayersOpen(!layersOpen)}
        >
          <Layers strokeWidth={1.75} />
        </button>
        <span className="vw-sep" />
        <button className="vw-tool" aria-label="Reset view (R)" title="Reset view (R)" onClick={resetViewer}>
          <RotateCcw strokeWidth={1.75} />
        </button>
      </div>

      {layersOpen && findings.length > 0 && (
        <div className="vw-layers-panel" role="dialog" aria-label="Overlay display" onPointerDown={(e) => e.stopPropagation()}>
          <div className="vw-lp-row">
            <span className="vw-lp-k">Style</span>
            <div className="vw-seg" role="radiogroup" aria-label="Overlay style">
              {STYLES.map((st) => (
                <button
                  key={st.id}
                  role="radio"
                  aria-checked={viewer.overlayStyle === st.id}
                  title={st.hint + (st.id !== 'box' && !hasMasks ? ' (this reader gave boxes only)' : '')}
                  onClick={() => setViewer({ overlayStyle: st.id })}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>
          <label className="vw-lp-row">
            <span className="vw-lp-k">Fill</span>
            <input
              type="range"
              min={10}
              max={90}
              step={5}
              value={Math.round(viewer.overlayOpacity * 100)}
              disabled={viewer.overlayStyle !== 'fill'}
              onChange={(e) => setViewer({ overlayOpacity: Number(e.target.value) / 100 })}
              aria-label="Fill opacity"
            />
            <span className="vw-lp-v">{Math.round(viewer.overlayOpacity * 100)}%</span>
          </label>
          {!hasMasks && <p className="vw-lp-note">This reader gave boxes, not outlines; outline and fill apply to Skanda reads.</p>}
          <div className="vw-lp-list" role="group" aria-label="Findings shown on the image">
            {findings.map((f, i) => (
              <label key={f.id} className="vw-lp-item" data-severity={f.severity}>
                <input type="checkbox" checked={!hidden.has(f.id)} onChange={() => toggleHidden(f.id)} />
                <span className="vw-sev" style={{ background: 'var(--c)' }} />
                <span className="vw-lp-n">{i + 1}</span>
                <span className="vw-lp-t">{f.title}</span>
                {f.mask && <span className="vw-lp-tag">outline</span>}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** One finding's segmentation, tinted with its severity colour; the outline is always drawn, the fill only in Fill. */
function MaskLayer({ f, fill, opacity, on }: { f: Finding; fill: boolean; opacity: number; on: boolean }) {
  const [edge, setEdge] = useState<string | null>(null)
  const [area_, setArea] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    if (f.mask) {
      maskAlphaUrl(f.mask, 'outline').then((u) => live && setEdge(u)).catch(() => {})
      if (fill) maskAlphaUrl(f.mask, 'fill').then((u) => live && setArea(u)).catch(() => {})
    }
    return () => {
      live = false
    }
  }, [f.mask, fill])
  const excluded = f.severity !== 'normal' && isExcluded(f)
  const layer = (url: string, o: number, cls: string) => (
    <div
      className={`vw-mask ${cls}`}
      data-severity={f.severity}
      style={{ maskImage: `url(${url})`, WebkitMaskImage: `url(${url})`, opacity: o }}
    />
  )
  return (
    <div className={`vw-mask-group${on ? ' vw-mask-on' : ''}`} data-excluded={excluded || undefined}>
      {fill && area_ && layer(area_, opacity, 'vw-mask-fill')}
      {edge && layer(edge, excluded ? 0.6 : 0.95, 'vw-mask-edge')}
    </div>
  )
}

function FindingBox({
  f,
  n,
  masked,
  on,
  selected,
  onHover,
  onSelect,
}: {
  f: Finding
  n: number
  masked: boolean
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
      data-masked={masked || undefined}
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

interface HeatSource {
  finding: Finding
  /** Number as drawn on the box. */
  number: number
  kind: string
  heat: Heatmap
}

/** One heatmap per finding: the focused one, or every abnormal, non-dismissed finding the classifier covers. */
function heatmapSources(findings: Finding[], focus: Finding | undefined, maps: Record<string, Heatmap>): HeatSource[] {
  const pool = focus ? [focus] : findings.filter((f) => f.severity !== 'normal' && !isExcluded(f))
  return pool.flatMap((f) => {
    const kind = f.classifier?.prob != null ? f.classifier.kind : null
    const heat = kind ? maps[kind] : undefined
    return kind && heat ? [{ finding: f, number: findings.indexOf(f) + 1, kind, heat }] : []
  })
}

/**
 * Classifier heatmap painted over the X-ray in a jet colour map (cold = clear), hot regions outlined: one map per
 * finding (its type's map within its own region), each finding's number and regional strength at its own peak.
 */
function HeatmapLayer({ sources }: { sources: HeatSource[] }) {
  const { x, y, w, h } = sources[0].heat.extent
  const fh = sources.map((s) => findingHeat(s.heat, s.finding))
  const key = sources.map((s) => `${s.finding.id}:${s.heat.data.slice(0, 24)}:${s.finding.bbox?.x ?? ''}`).join('|')
  return (
    <div className="vw-heat" style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }} aria-hidden="true">
      <img src={heatOverlayUrl(key, fh.map((f) => f.v))} alt="" draggable={false} />
      {sources.map((s, i) => (
        <span key={s.finding.id} className="vw-heat-peak" style={{ left: `${fh[i].peak.x * 100}%`, top: `${fh[i].peak.y * 100}%` }}>
          #{s.number} {Math.round(fh[i].strength * 100)}%
        </span>
      ))}
    </div>
  )
}
