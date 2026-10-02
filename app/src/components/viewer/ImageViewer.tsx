// Diagnostic image viewer: fit/zoom/pan, window-level, invert, finding overlays locked to the image.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { Contrast, Eye, EyeOff, Flame, Maximize, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import type { Finding, Heatmap, ViewerState } from '../../types'
import { useActiveImage, useActiveStudy, useApp } from '../../store'
import { findingCounts, isExcluded, isUnconfirmed, worstSeverity } from '../../lib/classifier'
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
  const [animating, setAnimating] = useState(false)
  const focused = useRef(false)
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
        case 'h':
          setViewer({ showHeatmap: !v.showHeatmap })
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
        {heatSources.length > 0 && <HeatmapLayer sources={heatSources} />}
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
          {viewer.showHeatmap && hasHeatmaps && (
            <div className="vw-legend vw-legend-heat">
              <span className="vw-heat-scale" aria-hidden="true">
                <span className="vw-heat-ramp" />
                <span className="vw-heat-ends"><span>low</span><span>high</span></span>
              </span>
              <span>
                {heatKinds.length
                  ? `Regions the classifier weighted for ${heatKinds.join(', ')}${focusFinding ? '' : ' (all findings)'}. `
                  : 'No classifier region for this finding type. '}
                Coarse: on held-out films the peak hit the lesion 17% of the time.
              </span>
            </div>
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

interface HeatSource {
  kind: string
  heat: Heatmap
  /** Finding numbers (as drawn on the boxes) of this type, for the peak marker. */
  numbers: number[]
}

/** Heatmaps to draw: the focused finding's type, or every abnormal, non-dismissed finding's type. */
function heatmapSources(findings: Finding[], focus: Finding | undefined, maps: Record<string, Heatmap>): HeatSource[] {
  const pool = focus ? [focus] : findings.filter((f) => f.severity !== 'normal' && !isExcluded(f))
  const byKind = new Map<string, HeatSource>()
  for (const f of pool) {
    const kind = f.classifier?.prob != null ? f.classifier.kind : null
    const heat = kind ? maps[kind] : undefined
    if (!kind || !heat) continue
    const n = findings.indexOf(f) + 1
    const cur = byKind.get(kind)
    if (cur) cur.numbers.push(n)
    else byKind.set(kind, { kind, heat, numbers: [n] })
  }
  return [...byKind.values()]
}

const HEAT_RES = 256 // smoothed canvas resolution; the maps themselves are coarse (7×7 → 32×32)
const HEAT_FLOOR = 0.2 // below this the film stays clear
const HEAT_CONTOUR = 0.6 // outline of the hot region

/** Jet colour map, t in 0..1 → [r, g, b]. */
function jet(t: number): [number, number, number] {
  const c = (x: number) => Math.round(255 * Math.min(1, Math.max(0, x)))
  return [c(1.5 - Math.abs(4 * t - 3)), c(1.5 - Math.abs(4 * t - 2)), c(1.5 - Math.abs(4 * t - 1))]
}

/** Bilinear upsample of one map to HEAT_RES², normalised to its own peak. Cached per map (maps live in the store). */
const upsampled = new WeakMap<Heatmap, Float32Array>()
function upsample(heat: Heatmap): Float32Array {
  const hit = upsampled.get(heat)
  if (hit) return hit
  const src = Uint8Array.from(atob(heat.data), (ch) => ch.charCodeAt(0))
  const out = new Float32Array(HEAT_RES * HEAT_RES)
  for (let y = 0; y < HEAT_RES; y++) {
    const fy = Math.min(heat.h - 1, Math.max(0, ((y + 0.5) / HEAT_RES) * heat.h - 0.5))
    const y0 = Math.floor(fy), y1 = Math.min(heat.h - 1, y0 + 1), wy = fy - y0
    for (let x = 0; x < HEAT_RES; x++) {
      const fx = Math.min(heat.w - 1, Math.max(0, ((x + 0.5) / HEAT_RES) * heat.w - 0.5))
      const x0 = Math.floor(fx), x1 = Math.min(heat.w - 1, x0 + 1), wx = fx - x0
      const v =
        (src[y0 * heat.w + x0] * (1 - wx) + src[y0 * heat.w + x1] * wx) * (1 - wy) +
        (src[y1 * heat.w + x0] * (1 - wx) + src[y1 * heat.w + x1] * wx) * wy
      out[y * HEAT_RES + x] = v / 255
    }
  }
  upsampled.set(heat, out)
  return out
}

/** Peak of one map, in the map's 0–1 coordinates. Cached per map. */
const peaks = new WeakMap<Heatmap, { x: number; y: number }>()
function peakOf(heat: Heatmap): { x: number; y: number } {
  const hit = peaks.get(heat)
  if (hit) return hit
  const v = upsample(heat)
  let best = 0
  for (let i = 1; i < v.length; i++) if (v[i] > v[best]) best = i
  const p = { x: ((best % HEAT_RES) + 0.5) / HEAT_RES, y: (Math.floor(best / HEAT_RES) + 0.5) / HEAT_RES }
  peaks.set(heat, p)
  return p
}

/** The combined overlay as a PNG data URL, cached by the maps it combines (hover and pan re-render the viewer). */
const overlays = new Map<string, string>()
function overlayUrl(sources: HeatSource[]): string {
  const key = sources.map((s) => `${s.kind}:${s.heat.data}`).join('|')
  const hit = overlays.get(key)
  if (hit) return hit
  const v = new Float32Array(HEAT_RES * HEAT_RES)
  for (const s of sources) {
    const m = upsample(s.heat)
    for (let i = 0; i < v.length; i++) v[i] = Math.max(v[i], m[i])
  }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = HEAT_RES
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(HEAT_RES, HEAT_RES)
  for (let i = 0; i < v.length; i++) {
    const t = v[i]
    const x = i % HEAT_RES
    const y = Math.floor(i / HEAT_RES)
    // Contour: a hot pixel next to a cooler one.
    const edge =
      t >= HEAT_CONTOUR &&
      ((x > 0 && v[i - 1] < HEAT_CONTOUR) || (x < HEAT_RES - 1 && v[i + 1] < HEAT_CONTOUR) ||
        (y > 0 && v[i - HEAT_RES] < HEAT_CONTOUR) || (y < HEAT_RES - 1 && v[i + HEAT_RES] < HEAT_CONTOUR))
    const [r, g, b] = edge ? [255, 255, 255] : jet(t)
    img.data[i * 4] = r
    img.data[i * 4 + 1] = g
    img.data[i * 4 + 2] = b
    img.data[i * 4 + 3] = edge ? 230 : t < HEAT_FLOOR ? 0 : Math.round(60 + 130 * ((t - HEAT_FLOOR) / (1 - HEAT_FLOOR)))
  }
  ctx.putImageData(img, 0, 0)
  const url = canvas.toDataURL()
  if (overlays.size > 40) overlays.delete(overlays.keys().next().value!)
  overlays.set(key, url)
  return url
}

/**
 * Classifier heatmap painted over the X-ray in a jet colour map (cold = clear), hot regions outlined, and the
 * finding numbers at each type's peak. All maps cover the classifier's centre crop (same extent for one image).
 */
function HeatmapLayer({ sources }: { sources: HeatSource[] }) {
  const { x, y, w, h } = sources[0].heat.extent
  return (
    <div className="vw-heat" style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }} aria-hidden="true">
      <img src={overlayUrl(sources)} alt="" draggable={false} />
      {sources.map((s) => {
        const p = peakOf(s.heat)
        return (
          <span key={s.kind} className="vw-heat-peak" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}>
            {s.numbers.map((n) => `#${n}`).join(' ')}
          </span>
        )
      })}
    </div>
  )
}
