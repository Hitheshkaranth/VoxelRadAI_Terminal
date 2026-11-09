import { ScanButton } from './ScanButton'
import { VolumeAcquisitionEditor } from './VolumeAcquisitionEditor'
import { acquisitionLabel, type VolumeAcquisition } from '../../lib/volumeAcquisition'
import { pauseVolumeJob } from '../../lib/volumeJobs'
import { ThinkingOrb } from 'thinking-orbs'
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useId, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight, Minus, Plus, X, Play, Pause, SlidersHorizontal, PanelsTopLeft, PanelRight, Box, Maximize } from 'lucide-react'
import { clampSliceIndex, clampZoom } from './displayAdjustments'
import { ThemeSwitch } from '../shell/ThemeSwitch'
import { decodeNrrd, getSliceGeometry, renderSlice, type Volume, type VolumePlane, type Vec3 } from '../../lib/volume'
import { VOLUME_SAMPLES, type VolumeSource } from '../../lib/volumeSources'
import { useApp } from '../../store'
import { validateVolumeAnalysis } from '../../lib/volumeValidation'
import { skandaSliceInput } from '../../lib/skandaSlice'
import { sourceEdgeCoverage } from '../../lib/volumeCoverage'
import { isTypingTarget, READING_SHORTCUTS } from './readingControls'
import { resetVolumeLayout, useVolumePreference } from './volumeLayout'
import { VolumeMultiplanar } from './VolumeMultiplanar'
import { VolumeIdentity } from '../shell/VolumeIdentity'
import { VolumeDisplayControls } from './VolumeDisplayControls'
import { useShell } from '../shell/shellState'
import { findingRegion, regionOnSlice, regionAnchor, type VolumeRegion } from '../../lib/volumeAnnotations'
import type { SliceRead } from '../../lib/volumeAnalysis'
import { volumeFingerprint } from '../../lib/volumeJobIdentity'
import { registerVolumeSource } from '../../lib/volumeSourceRegistry'
import { centerVoxel, setSliceAnchor, indexForPlane, slicePointFromVoxel, voxelFromSlicePoint, visibleContentBounds } from '../../lib/volumeNavigation'
import { VolumeMobileActions } from '../shell/VolumeMobileActions'
import { VolumeFindingsPanel } from './VolumeFindingsPanel'
import { VolumeReportPanel } from './VolumeReportPanel'
import { WholeVolumeAnalysis } from './WholeVolumeAnalysis'
import { VolumeAnalysis } from './VolumeAnalysis'
import { VolumeLocator } from './VolumeLocator'
import { VolumeRaycast } from './VolumeRaycast'
import './volumeViewer.css'

const planes: VolumePlane[] = ['axial', 'coronal', 'sagittal']
const title = (s: string) => s[0].toUpperCase() + s.slice(1)
const bound = (n: number, max: number) => clampSliceIndex(n, max + 1)

export function VolumeViewer({ source: originalSource }: { source: VolumeSource }) {
  const source = useMemo(() => originalSource.acquisition ? { ...originalSource, modality: originalSource.acquisition.modality, sequence: originalSource.acquisition.sequence } : originalSource, [originalSource])
  const model = useApp((s) => s.settings.model)
  const connection = useApp((s) => s.connection)
  const connectionLabel = connection === 'online' ? 'Connected' : connection === 'checking' ? 'Checking…' : connection === 'model-missing' ? 'Model not loaded' : 'Disconnected'
  const [volume, setVolume] = useState<Volume | null>(null)
  const skandaCache = useRef<{ mriRange?: [number, number] }>({})  // per-volume MRI normalisation for Skanda reads
  useEffect(() => { skandaCache.current = {} }, [volume])
  const [wholeRegions, setRegions] = useState<VolumeRegion[]>([])
  const [singleRegions, setSingleRegions] = useState<VolumeRegion[]>([])
  const regions = useMemo(() => [...wholeRegions, ...singleRegions], [wholeRegions, singleRegions])
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null)
  const [reviewedCount, setReviewedCount] = useState(0)
  const [singleReviewed, setSingleReviewed] = useState(false)
  const [showRegions, setShowRegions] = useState(true)
  const [sliceReads, setSliceReads] = useState<SliceRead[]>([])
  const [readPlane, setReadPlane] = useState<VolumePlane>('axial')
  const receiveReads = useCallback((reads: SliceRead[], readPlane: VolumePlane) => {
    if (!volume) return
    setSliceReads(reads); setReadPlane(readPlane)
    setReviewedCount(reads.filter((r) => r.analysis && !r.analysis.truncated).length)
    setRegions(reads.flatMap((r) => (r.analysis?.findings ?? []).flatMap((f) => { const region = findingRegion(volume, readPlane, r.index, f); return region ? [region] : [] })))
  }, [volume])
  const [error, setError] = useState('')
  const [phase, setPhase] = useState('Loading scan…')
  const [plane, setPlane] = useState<VolumePlane>('axial')
  const [anchor, setAnchor] = useState<Vec3>([0, 0, 0])
  const index = volume ? indexForPlane(volume, anchor, plane) : 0
  const setIndex = useCallback((next: number | ((i: number) => number)) => { if (volume) setAnchor((point) => setSliceAnchor(volume, point, plane, typeof next === 'function' ? next(indexForPlane(volume, point, plane)) : next)) }, [volume, plane])
  const [resultsTab, setResultsTab] = useState<'findings' | 'report'>('findings')
  const reviewId = useId()
  const [expanded3D, setExpanded3D] = useState(false)
  const [level, setLevel] = useState(0)
  const [width, setWidth] = useState(1)
  const [activeTool, setActiveTool] = useState<'pan' | 'window'>('pan')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [showLocator, setShowLocator] = useVolumePreference('showLocator')
  const mobileView = useShell((s) => s.mobileView)
  const [readingMode, setReadingMode] = useVolumePreference('readingMode')
  const [multiPlane, setMultiPlane] = useVolumePreference('multiPlane')
  const [toolsOpen, setToolsOpen] = useVolumePreference('toolsOpen')
  const [cine, setCine] = useState(false)
  const [cineSpeed, setCineSpeed] = useState(3)
  const [heldOverlays, setHeldOverlays] = useState(false)
  const [overlayOpacity, setOverlayOpacity] = useState(.8)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [showReviewPanel, setShowReviewPanel] = useVolumePreference('showReviewPanel')
  const [panelWidth, setPanelWidth] = useVolumePreference('panelWidth')
  const [spatialHeight, setSpatialHeight] = useVolumePreference('spatialHeight')
  const panelDrag = useRef<{ x: number; width: number } | null>(null)
  const heightDrag = useRef<{ y: number; height: number } | null>(null)
  const reportReturn = useRef<{ plane: VolumePlane; anchor: Vec3; level: number; width: number; zoom: number; pan: {x:number;y:number}; multiPlane: boolean } | null>(null)
  const [viewingEvidence, setViewingEvidence] = useState(false)
  const overlaysVisible = showRegions && !heldOverlays
  const keyActions = useRef<(key: string) => void>(() => {})

  const [size, setSize] = useState({ w: 1, h: 1 })
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; pan: typeof pan; mode: 'pan' | 'window'; center: number; width: number } | null>(null)
  const geometry = useMemo(() => volume ? getSliceGeometry(volume, plane) : null, [volume, plane])
  const readMap = useMemo(() => new Map(sliceReads.map((r) => [r.index, r])), [sliceReads])
  const findingSlices = useMemo(() => sliceReads.filter((r) => r.analysis?.findings.some((f) => f.severity !== 'normal' && f.review !== 'dismissed')).map((r) => r.index).sort((a,b)=>a-b), [sliceReads])
  const count = geometry?.count ?? 1
  const sliceIndex = bound(index, count - 1)
  const sliceData = useMemo(() => volume ? renderSlice(volume, plane, sliceIndex, { center: level, width }) : null, [volume, plane, sliceIndex, level, width])
  const sourceCoverage = useMemo(() => volume ? sourceEdgeCoverage(volume, plane, sliceIndex) : null, [volume, plane, sliceIndex])
  const sliceTexture = useMemo(() => {
    if (!sliceData) return undefined
    const image = document.createElement('canvas')
    image.width = sliceData.width; image.height = sliceData.height
    image.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(sliceData.pixels), sliceData.width, sliceData.height), 0, 0)
    return { url: image.toDataURL('image/png'), columnAxis: sliceData.columnAxis, rowAxis: sliceData.rowAxis, flipColumn: sliceData.flipColumn, flipRow: sliceData.flipRow }
  }, [sliceData])
  const fit = () => { setCine(false); setZoom(1); setPan({ x: 0, y: 0 }) }
  const saveAcquisition = async (acquisition: VolumeAcquisition) => {
    const identity = volume ? `${await volumeFingerprint(volume)}:${source.modality.toUpperCase()}` : null
    if (useShell.getState().volumeSource !== originalSource) throw new Error('The open scan changed. Edit acquisition details on the current scan.')
    if (identity) pauseVolumeJob(identity)
    useShell.setState({ volumeSource: { ...originalSource, modality: acquisition.modality, sequence: acquisition.sequence, acquisition } })
  }

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    void (async () => {
      await Promise.resolve()
      if (!active) return
      setError(''); setVolume(null); setPhase('Loading scan…')
      try {
        let bytes: ArrayBuffer
        if (source.file) bytes = await source.file.arrayBuffer()
        else {
          const response = await fetch(source.url!, { signal: controller.signal })
          if (!response.ok) throw new Error(`Scan download failed (${response.status}).`)
          bytes = await response.arrayBuffer()
        }
        if (!active) return
        setPhase('Decoding volume…')
        const rawDecoded = await decodeNrrd(bytes)
        const decoded: Volume = source.acquisition ? { ...rawDecoded, acquisition: source.acquisition } : rawDecoded
        if (!active) return
        setAnchor(centerVoxel(decoded))
        // CT sample scalar values retain their native acquisition range; no calibration is inferred.
        setLevel(source.initialWindow?.center ?? (decoded.range[0] + decoded.range[1]) / 2)
        setWidth(source.initialWindow?.width ?? Math.max(1, decoded.range[1] - decoded.range[0]))
        setVolume(decoded)
        void volumeFingerprint(decoded).then((fingerprint) => registerVolumeSource(`${fingerprint}:${source.modality.toUpperCase()}`, source, decoded))
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Could not open volume.')
      }
    })()
    return () => { active = false; controller.abort() }
  }, [source])

  useLayoutEffect(() => {
    const element = stage.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [volume, multiPlane])

  useEffect(() => {
    if (!sliceData || !canvas.current) return
    canvas.current.width = sliceData.width
    canvas.current.height = sliceData.height
    canvas.current.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(sliceData.pixels), sliceData.width, sliceData.height), 0, 0)
  }, [sliceData, multiPlane])

  useEffect(() => {
    const element = stage.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      setCine(false)
      if (event.ctrlKey || event.metaKey) setZoom((z) => Math.max(.5, Math.min(8, z * Math.exp(-event.deltaY * .005))))
      else if (Math.abs(event.deltaY) > 0) setIndex((i) => bound(i + Math.sign(event.deltaY), count - 1))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [volume, count, setIndex, multiPlane])

  useEffect(() => {
    if (!expanded3D) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = document.querySelector<HTMLElement>('.volume-spatial-panel--expanded')
    const focusable = () => [...(panel?.querySelectorAll<HTMLElement>('button, input, summary, [tabindex="0"]') ?? [])].filter((el) => el.getClientRects().length && !el.hasAttribute('disabled'))
    focusable()[0]?.focus()
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded3D(false)
      if (e.key === 'Tab') { const items = focusable(); const first = items[0], last = items.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() } }
    }
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('keydown', close); if (previousFocus?.isConnected) previousFocus.focus() }
  }, [expanded3D])

  const selectPlane = (next: VolumePlane) => { setCine(false); setPlane(next); fit() }
  const navigate = (p: VolumePlane, i: number, window?: { center: number; width: number }) => {
    if (!volume) return
    setCine(false); setMultiPlane(false)
    setAnchor((point) => setSliceAnchor(volume, point, p, i)); setPlane(p)
    if (window) { setLevel(window.center); setWidth(window.width) }
    fit(); useShell.getState().setMobileView('viewer')
  }
  const chooseRegion = (region: VolumeRegion) => {
    if (!volume) return
    setCine(false); setSelectedRegion(region.id); setAnchor(regionAnchor(volume, region)); fit(); useShell.getState().setMobileView('viewer')
  }
  const crosshair = volume ? slicePointFromVoxel(volume, plane, anchor) : null
  const fitContent = () => {
    setCine(false)
    if (!sliceData) return
    const bounds = visibleContentBounds(sliceData.pixels, sliceData.width, sliceData.height)
    if (!bounds) { fit(); return }
    const pixelW = physicalW * scale, pixelH = physicalH * scale
    const nextZoom = Math.max(.5, Math.min(8, Math.min((size.w - 40) / (bounds.width / sliceData.width * pixelW), (size.h - 128) / (bounds.height / sliceData.height * pixelH))))
    setZoom(nextZoom); setPan({ x: -((bounds.x + bounds.width / 2) / sliceData.width - .5) * pixelW * nextZoom, y: -((bounds.y + bounds.height / 2) / sliceData.height - .5) * pixelH * nextZoom })
  }
  const selectFinding = ({ plane: p, index: i, window, findingId }: { plane: VolumePlane; index: number; window: {center:number;width:number}; findingId: string }) => {
    const region = regions.find((region) => region.plane === p && region.index === i && region.finding.id === findingId)
    if (region) { chooseRegion(region); setLevel(window.center); setWidth(window.width) }
    else { navigate(p, i, window); setSelectedRegion(null) }
  }
  const navigateEvidence = (p: VolumePlane, i: number, window: {center:number;width:number}) => {
    if (!reportReturn.current) reportReturn.current = { plane, anchor: [...anchor] as Vec3, level, width, zoom, pan: {...pan}, multiPlane }
    setShowReviewPanel(true); setViewingEvidence(true); navigate(p, i, window); setResultsTab('findings')
  }
  const returnToReport = () => {
    setCine(false); setShowReviewPanel(true)
    const saved = reportReturn.current
    if (saved) { setPlane(saved.plane); setAnchor(saved.anchor); setLevel(saved.level); setWidth(saved.width); setZoom(saved.zoom); setPan(saved.pan); setMultiPlane(saved.multiPlane) }
    reportReturn.current = null; setViewingEvidence(false); setResultsTab('report'); useShell.getState().setMobileView('report')
  }
  const toggleCine = () => { if (!volume) return; if (sliceIndex === count - 1) setIndex(0); setCine((v) => !v) }
  useEffect(() => {
    if (!cine || !volume || mobileView !== 'viewer') return
    const timer = window.setTimeout(() => { if (sliceIndex >= count - 1) setCine(false); else setIndex(sliceIndex + 1) }, 1000 / cineSpeed)
    return () => window.clearTimeout(timer)
  }, [cine, volume, mobileView, sliceIndex, count, setIndex, cineSpeed])
  useEffect(() => {
    if (!readingMode) return
    const previous = useShell.getState().sidebarCollapsed
    useShell.getState().setSidebarCollapsed(true)
    return () => useShell.getState().setSidebarCollapsed(previous)
  }, [readingMode])
  useEffect(() => useShell.subscribe((state, previous) => { if (state.mobileView !== previous.mobileView && state.mobileView !== 'viewer') setCine(false) }), [])
  useLayoutEffect(() => { keyActions.current = (key) => {
    if (key === ' ') toggleCine()
    else if (key === 'f') { setCine(false); fit() }
    else if (key === 'w' || key === 'p') { setCine(false); setActiveTool(key === 'w' ? 'window' : 'pan') }
    else if (key === 'm') { setCine(false); setMultiPlane((v) => !v) }
    else if (key === 'h') setShowRegions((v) => !v)
    else if (key === '?') setShortcutsOpen((v) => !v)
  } })
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]') || isTypingTarget(event.target) || event.ctrlKey || event.metaKey || event.repeat) return
      if (event.key === 'Alt') { setHeldOverlays(true); return }
      if (event.altKey || useShell.getState().mobileView !== 'viewer') return
      if (event.key === ' ' && event.target instanceof HTMLElement && event.target.closest('button,summary,[role="button"]')) return
      const key = event.key.toLowerCase()
      if ([' ', 'f', 'w', 'p', 'm', 'h', '?'].includes(key)) { event.preventDefault(); keyActions.current(key) }
    }
    const up = (event: KeyboardEvent) => { if (event.key === 'Alt') setHeldOverlays(false) }
    const blur = () => { setHeldOverlays(false); setCine(false) }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [])
  const oblique = volume?.directions.some((direction) => Math.max(...direction.map(Math.abs)) < .9999)
  const physicalW = geometry ? geometry.width * geometry.pixelSpacing[0] : 1
  const physicalH = geometry ? geometry.height * geometry.pixelSpacing[1] : 1
  const scale = Math.min(Math.max(1, size.w - 40) / physicalW, Math.max(1, size.h - 128) / physicalH)

  return <section className={`volume-workspace${readingMode ? ' volume-reading-mode' : ''}`} style={{ '--volume-panel-width': `${panelWidth}px`, '--volume-spatial-height': `${spatialHeight}px` } as CSSProperties} aria-label="Volume viewer" data-review-open={showReviewPanel}>
    <header className="volume-header scan-header">
      <ScanButton className="btn btn-sm" onClick={() => { if (window.matchMedia('(max-width: 1023px)').matches) useShell.getState().setMobileView('studies'); else useShell.getState().toggleSidebar() }}><PanelsTopLeft size={16} />Studies</ScanButton>
      <div className="scan-title"><strong>{source.title}</strong><span>{volume ? `${volume.dimensions.join(' × ')} · ${oblique ? 'Oblique acquisition' : source.modality}` : 'Loading scan'}</span></div>
      <ScanButton className="btn btn-sm scan-connection" title={model} onClick={() => useApp.getState().openSheet('settings')}>{connectionLabel}</ScanButton>
      <ScanButton className="btn btn-sm" aria-pressed={showReviewPanel} onClick={() => { setShowReviewPanel(v => !v); useShell.getState().setMobileView('viewer') }}><PanelRight size={16} />Review</ScanButton>
      <ThemeSwitch compact /><ScanButton className="icon-btn" aria-label="Close volume" onClick={() => useShell.getState().closeVolume()}><X /></ScanButton>
    </header>
    {!readingMode && <VolumeIdentity source={source} />}
    {error ? <div className="volume-message" role="alert"><h2>Could not open scan</h2><p>{error}</p><ScanButton className="btn" onClick={() => useShell.getState().openVolume({ ...source })}>Retry</ScanButton></div> : !volume || !geometry ? <div className="volume-message" role="status"><ThinkingOrb state="working" size={64} theme="dark" aria-hidden="true" /><p>{phase}</p></div> : <>
      {viewingEvidence && <ScanButton className="btn btn-primary volume-mobile-return" onClick={returnToReport}>Return to report</ScanButton>}
      {shortcutsOpen && <div className="volume-shortcut-help" role="region" aria-label="Reading shortcuts">{READING_SHORTCUTS.map(([key, description]) => <span key={key}><kbd>{key}</kbd> {description}</span>)}</div>}
      <VolumeMobileActions />
      <div className={`volume-body${showLocator ? '' : ' volume-body--image-only'}${showReviewPanel || showLocator ? '' : ' volume-body--review-hidden'}`}>
        <div className="volume-image-column">
          <div className="scan-overlay-top" aria-label="Scan tools">
            <div className="volume-planes" role="group" aria-label="Slice plane">{planes.map(p => <ScanButton key={p} aria-pressed={plane === p} onClick={() => selectPlane(p)}>{title(p)}</ScanButton>)}</div>
            <ScanButton className="btn btn-sm" aria-label={multiPlane ? 'Single plane' : 'Three planes'} aria-pressed={multiPlane} onClick={() => { setCine(false); setMultiPlane(v => !v) }}><PanelsTopLeft size={16} /><span>{multiPlane ? 'Single plane' : 'Three planes'}</span></ScanButton>
            <ScanButton className="btn btn-sm" aria-label="Toggle 3D locator" aria-pressed={showLocator} onClick={() => setShowLocator(v => !v)}><Box size={16} /><span>3D</span></ScanButton>
            <VolumeAcquisitionEditor source={source} onSave={saveAcquisition} />
            <Popover><PopoverTrigger asChild><ScanButton aria-label="More scan tools"><SlidersHorizontal size={16} /><span>Tools</span></ScanButton></PopoverTrigger><PopoverContent align="end" className="scan-popover">
              <ScanButton className="btn btn-sm" aria-pressed={readingMode} onClick={() => setReadingMode(v => !v)}>{readingMode ? 'Show volume details' : 'Hide volume details'}</ScanButton>
              <ScanButton className="btn btn-sm" aria-expanded={shortcutsOpen} onClick={() => setShortcutsOpen(v => !v)}>Keyboard shortcuts</ScanButton>
              <ScanButton className="btn btn-sm" onClick={() => { resetVolumeLayout(); setExpanded3D(false); setResultsTab('findings'); setPlane('axial'); fit(); useShell.getState().setMobileView('viewer'); useShell.getState().setSidebarCollapsed(true) }}>Reset workspace</ScanButton>
              {!source.file && VOLUME_SAMPLES.some(sample => sample.id === source.id) && <div className="volume-sample-switch" role="group" aria-label="Sample dataset"><span>Sample</span>{VOLUME_SAMPLES.map(sample => <ScanButton className="btn btn-sm" key={sample.id} aria-pressed={source.id === sample.id} onClick={() => useShell.getState().openVolume(sample)}>{sample.modality}</ScanButton>)}</div>}
              {viewingEvidence && <ScanButton className="btn btn-sm" onClick={returnToReport}>Return to report</ScanButton>}
            </PopoverContent></Popover>
          </div>
          {multiPlane ? <VolumeMultiplanar activePlane={plane} volume={volume} anchor={anchor} center={level} width={width} zoom={zoom} onAnchorChange={setAnchor} onInteraction={() => setCine(false)} selectedRegion={selectedRegion} onRegionSelect={chooseRegion} onMaximize={(p) => { setMultiPlane(false); selectPlane(p) }} regions={regions} showOverlays={overlaysVisible} overlayOpacity={overlayOpacity} /> : <div ref={stage} className="volume-stage" tabIndex={0} aria-label={`${title(plane)} slice ${sliceIndex + 1} of ${count}`}
            onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { event.preventDefault(); setIndex((i) => bound(i + 1, count - 1)) } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') { event.preventDefault(); setIndex((i) => bound(i - 1, count - 1)) } }}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => { setCine(false); if (event.button !== 0 && event.button !== 2) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, pan, mode: event.button === 2 || event.shiftKey ? 'window' : activeTool, center: level, width } }}
            onPointerMove={(event) => { const d = drag.current; if (d?.id !== event.pointerId) return; if (d.mode === 'window') { const sensitivity = Math.max(1, d.width / 200); setWidth(Math.max(1, Math.round(d.width + (event.clientX - d.x) * sensitivity))); setLevel(Math.round(d.center + (event.clientY - d.y) * sensitivity)) } else setPan({ x: d.pan.x + event.clientX - d.x, y: d.pan.y + event.clientY - d.y }) }}
            onPointerUp={(event) => { const d = drag.current; if (d?.mode === 'pan' && Math.hypot(event.clientX - d.x, event.clientY - d.y) < 5 && canvas.current && volume) { const rect = canvas.current.getBoundingClientRect(); setAnchor(voxelFromSlicePoint(volume, plane, sliceIndex, { x: (event.clientX-rect.left)/rect.width, y: (event.clientY-rect.top)/rect.height })) } drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }} onDoubleClick={fit}>
            <canvas className="volume-full-image" ref={canvas} aria-label={`${source.modality} ${plane} image, slice ${sliceIndex + 1}`} role="img" style={{ width: physicalW * scale, height: physicalH * scale, transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})` }} />
            {overlaysVisible && crosshair && <svg className="volume-crosshair" opacity={overlayOpacity} viewBox="0 0 1000 1000" preserveAspectRatio="none" style={{ width: physicalW * scale, height: physicalH * scale, transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})` }} aria-label="Shared anatomical position"><line x1={crosshair.x*1000} x2={crosshair.x*1000} y1="0" y2="1000" /><line x1="0" x2="1000" y1={crosshair.y*1000} y2={crosshair.y*1000} /></svg>}
            {overlaysVisible && <svg className="volume-region-overlay" opacity={overlayOpacity} viewBox="0 0 1000 1000" preserveAspectRatio="none" style={{ width: physicalW * scale, height: physicalH * scale, transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})` }} aria-label="Finding bounding regions">
              {regions.map((region, number) => { const b = regionOnSlice(volume!, plane, sliceIndex, region); return b && <g key={region.id} data-selected={selectedRegion === region.id} role="button" tabIndex={0} aria-label={`Finding ${number + 1}: ${region.title}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => chooseRegion(region)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); chooseRegion(region) } }}><title>{region.title}</title><rect x={b.x*1000} y={b.y*1000} width={b.w*1000} height={b.h*1000} /><text x={b.x*1000+4} y={Math.max(18,b.y*1000-8)}>{number+1}</text></g> })}
            </svg>}
            <span className="volume-orientation volume-top">{geometry.labels.top}</span><span className="volume-orientation volume-bottom">{geometry.labels.bottom}</span><span className="volume-orientation volume-left">{geometry.labels.left}</span><span className="volume-orientation volume-right">{geometry.labels.right}</span>
            <span className="volume-image-caption">{title(plane)}{oblique ? ' · acquired oblique plane' : ''} · {sliceIndex + 1}/{count}</span>
          </div>
          }
          {!multiPlane && sourceCoverage && <div className="volume-source-note" role="note"><strong>Uniform area in source image</strong><span>The {sourceCoverage.edge} edge contains {sourceCoverage.rows} of {sourceCoverage.totalRows} constant-value rows. {zoom === 1 && pan.x === 0 && pan.y === 0 ? 'Full image extent is shown; this is not a display crop.' : 'Source pixels are retained; the current view is zoomed or panned.'}</span></div>}
          <div className="scan-overlay-bottom">
          <ScanButton className="btn btn-sm scan-play" onClick={toggleCine} aria-label={cine ? 'Pause slices' : 'Play slices'} aria-pressed={cine}>{cine ? <Pause size={16} /> : <Play size={16} />}</ScanButton>
          <div className="volume-slice-controls" onPointerDown={() => setCine(false)} onKeyDown={() => setCine(false)}><ScanButton className="icon-btn" aria-label="Previous slice" disabled={sliceIndex === 0} onClick={() => setIndex((i) => bound(i - 1, count - 1))}><ChevronLeft /></ScanButton><label>Slice <input type="number" aria-label="Slice number" min={1} max={count} value={sliceIndex + 1} onChange={(event) => { if (event.target.value.trim()) setIndex(bound(Number(event.target.value) - 1, count - 1)) }} /> / {count}</label><div className="volume-slice-track">{plane === readPlane && sliceReads.length > 0 && <div className="volume-coverage-markers" aria-hidden="true">{Array.from({ length: count }, (_, i) => { const r = readMap.get(i); const kind = !r ? 'unreviewed' : r.error || r.analysis?.truncated ? 'incomplete' : findingSlices.includes(i) ? 'finding' : 'reviewed'; return <span key={i} data-kind={kind} /> })}</div>}<input aria-label="Slice position" type="range" min={0} max={count - 1} value={sliceIndex} onChange={(event) => setIndex(Number(event.target.value))} /></div><ScanButton className="icon-btn" aria-label="Next slice" disabled={sliceIndex === count - 1} onClick={() => setIndex((i) => bound(i + 1, count - 1))}><ChevronRight /></ScanButton></div>
          <div className="volume-quick-display" role="group" aria-label="Quick image display controls">
            <ScanButton className="btn btn-sm" aria-label="Zoom out" disabled={zoom <= .5} onClick={() => { setCine(false); setZoom((value) => clampZoom(value / 1.25)) }}><Minus aria-hidden="true" /></ScanButton>
            <output aria-label="Zoom relative to fitted image">{Math.round(zoom * 100)}%</output>
            <ScanButton className="btn btn-sm" aria-label="Zoom in" disabled={zoom >= 8} onClick={() => { setCine(false); setZoom((value) => clampZoom(value * 1.25)) }}><Plus aria-hidden="true" /></ScanButton>
            <ScanButton className="btn btn-sm" aria-label="Fit scan" onClick={fit}><Maximize size={16} /></ScanButton>


          </div>
          <Popover open={toolsOpen} onOpenChange={setToolsOpen}><PopoverTrigger asChild><ScanButton className="scan-display-trigger"><SlidersHorizontal size={16} /><span>Display</span></ScanButton></PopoverTrigger><PopoverContent side="top" align="end" className="scan-display-popover"><div className="volume-cine-controls"><label>Playback speed <select aria-label="Playback speed" value={cineSpeed} onChange={e => setCineSpeed(Number(e.target.value))}>{[1,3,5,10].map(fps => <option key={fps} value={fps}>{fps} fps</option>)}</select></label></div><VolumeDisplayControls center={level} width={width} range={volume.range} modality={source.modality} initialWindow={source.initialWindow} activeTool={activeTool} onToolChange={(tool) => { setCine(false); setActiveTool(tool) }} onWindowChange={(window) => { setCine(false); setLevel(window.center); setWidth(window.width) }} onFit={fit} onFitContent={multiPlane ? undefined : fitContent} onZoomIn={() => { setCine(false); setZoom((z) => clampZoom(z * 1.25)) }} onZoomOut={() => { setCine(false); setZoom((z) => clampZoom(z / 1.25)) }} /></PopoverContent></Popover>
          </div>
        </div>
        <div className="volume-panel-divider" role="separator" aria-label="Resize findings panel" aria-orientation="vertical" aria-valuemin={280} aria-valuemax={600} aria-valuenow={panelWidth} tabIndex={0} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); panelDrag.current={x:e.clientX,width:panelWidth} }} onPointerMove={(e) => { if(panelDrag.current)setPanelWidth(Math.max(280,Math.min(600,panelDrag.current.width+panelDrag.current.x-e.clientX))) }} onPointerUp={() => {panelDrag.current=null}} onPointerCancel={() => {panelDrag.current=null}} onKeyDown={(e) => { if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setPanelWidth((v)=>Math.max(280,Math.min(600,v+(e.key==='ArrowLeft'?20:-20))))} }} />
        <div className="volume-locator-column" onPointerDown={() => setCine(false)}>{showLocator && <div role={expanded3D ? 'dialog' : undefined} aria-modal={expanded3D || undefined} aria-label={expanded3D ? 'Expanded 3D volume' : undefined} className={`volume-spatial-panel${expanded3D ? ' volume-spatial-panel--expanded' : ''}`}><ScanButton className="btn btn-sm volume-expand-3d" onClick={() => setExpanded3D((v) => !v)}>{expanded3D ? 'Close expanded 3D' : 'Expand 3D'}</ScanButton><VolumeRaycast hideOverlays={!overlaysVisible} overlayOpacity={overlayOpacity} regions={overlaysVisible ? regions : []} selectedRegion={selectedRegion} onRegionSelect={chooseRegion} volume={volume} axis={geometry.axis as 0 | 1 | 2} index={sliceIndex} onIndexChange={(i) => { setCine(false); setIndex(i) }} modality={source.modality} window={{ center: level, width }} />{expanded3D && <div className="volume-expanded-findings"><strong>Finding regions</strong>{regions.length ? regions.map((region, i) => <ScanButton className="btn btn-sm" key={region.id} aria-pressed={selectedRegion === region.id} onClick={() => chooseRegion(region)}>{i+1}. {region.title} · {region.plane} {region.index+1}</ScanButton>) : <p>No localized finding regions available.</p>}</div>}<details className="volume-geometry"><summary>Geometry &amp; orientation</summary><VolumeLocator dimensions={volume.dimensions} directions={volume.directions} origin={volume.origin} spacing={volume.spacing} coordinateSystem="LPS" sliceTexture={sliceTexture} axis={geometry.axis as 0 | 1 | 2} index={sliceIndex} onIndexChange={(i) => { setCine(false); setIndex(i) }} onAxisChange={(axis) => { const next = planes.find((p) => getSliceGeometry(volume, p).axis === axis); if (next) selectPlane(next) }} /></details></div>}{showLocator && <div className="volume-spatial-divider" role="separator" aria-label="Resize 3D locator" aria-orientation="horizontal" aria-valuemin={180} aria-valuemax={500} aria-valuenow={spatialHeight} tabIndex={0} onPointerDown={(e)=>{e.currentTarget.setPointerCapture(e.pointerId);heightDrag.current={y:e.clientY,height:spatialHeight}}} onPointerMove={(e)=>{if(heightDrag.current)setSpatialHeight(Math.max(180,Math.min(500,heightDrag.current.height+e.clientY-heightDrag.current.y)))}} onPointerUp={()=>{heightDrag.current=null}} onPointerCancel={()=>{heightDrag.current=null}} onKeyDown={(e)=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();setSpatialHeight(v=>Math.max(180,Math.min(500,v+(e.key==='ArrowDown'?20:-20))))}}} />}<div className="volume-results-panel" data-tab={resultsTab}><div className="volume-results-tabs" role="tablist" aria-label="Volume review" onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 'findings' : event.key === 'End' ? 'report' : resultsTab === 'findings' ? 'report' : 'findings'; setResultsTab(next); document.getElementById(`${reviewId}-${next}-tab`)?.focus() }}>{(['findings', 'report'] as const).map(tab => <ScanButton key={tab} id={`${reviewId}-${tab}-tab`} role="tab" aria-controls={`${reviewId}-${tab}-panel`} tabIndex={resultsTab === tab ? 0 : -1} aria-selected={resultsTab === tab} onClick={() => setResultsTab(tab)}>{tab === 'findings' ? 'Findings' : 'Report'}</ScanButton>)}</div><div className="volume-mobile-findings" role="tabpanel" id={`${reviewId}-findings-panel`} aria-labelledby={`${reviewId}-findings-tab`}>      <div className="volume-label-navigation" aria-label="Findings across all views"><span>AI candidates</span>{regions.map((region, number) => <ScanButton key={region.id} className="btn btn-sm" aria-pressed={selectedRegion === region.id} title={`Source: ${region.plane} slice ${region.index+1}. Locate in the current view.`} onClick={() => chooseRegion(region)}>{number+1}. {region.title}</ScanButton>)}{regions.length === 0 && <span className="volume-label-empty">{reviewedCount || singleReviewed ? 'No localized findings available' : 'Not analyzed — localized findings will link across 2D and 3D views'}</span>}</div>
      {selectedRegion && regions.some(region => region.id === selectedRegion) && <div className="volume-label-source">{regions.filter(region => region.id === selectedRegion).map(region => <span key={region.id}>{region.title} · Source: {region.plane} {region.index+1} · Linked position in all views <ScanButton className="btn btn-sm" onClick={() => navigate(region.plane,region.index)}>View source slice</ScanButton></span>)}<small>Other planes show the source box intersection, not a new segmentation.</small></div>}
          {sliceReads.length > 0 && <div className="volume-finding-navigation"><span>Review markers: {readPlane} · amber findings / red incomplete / blue reviewed</span><div><ScanButton className="btn btn-sm" disabled={!findingSlices.length} onClick={() => { const current = indexForPlane(volume, anchor, readPlane); navigate(readPlane, [...findingSlices].reverse().find((i) => i < current) ?? findingSlices[findingSlices.length - 1]) }}>Previous finding</ScanButton><ScanButton className="btn btn-sm" disabled={!findingSlices.length} onClick={() => { const current = indexForPlane(volume, anchor, readPlane); navigate(readPlane, findingSlices.find((i) => i > current) ?? findingSlices[0]) }}>Next finding</ScanButton></div></div>}
<div className="volume-region-key"><label><input type="checkbox" checked={showRegions} onChange={(e) => setShowRegions(e.target.checked)} /> {reviewedCount ? `AI candidate regions (${regions.length}) · ${reviewedCount} slices reviewed` : singleReviewed ? `AI candidate regions (${regions.length}) · Single-slice review` : 'AI candidate regions · Not analyzed'}</label><details><summary>Overlay display</summary><label>Opacity <input aria-label="Annotation opacity" type="range" min="0.1" max="1" step="0.05" value={overlayOpacity} onChange={(e) => setOverlayOpacity(Number(e.target.value))} /></label><span>Hold Alt to hide overlays. Boxes indicate model locations, not segmentation.</span></details></div><WholeVolumeAnalysis onReads={receiveReads} volume={volume} modality={source.modality} title={source.title} center={level} width={width} onNavigate={navigate} /><VolumeFindingsPanel onSelectFinding={selectFinding} keyboardEnabled={!cine && !shortcutsOpen && !expanded3D && resultsTab === 'findings' && mobileView !== 'report'} volume={volume} modality={source.modality} onNavigate={navigate} /><details className="volume-geometry"><summary>Analyze current slice only</summary>{sliceTexture && <VolumeAnalysis skandaInput={() => skandaSliceInput(volume, plane, sliceIndex, { ...source.acquisition, modality: source.modality, title: source.title, sequence: source.sequence }, skandaCache.current)} validate={(result) => validateVolumeAnalysis(volume,plane,sliceIndex,{center:level,width},result,{ sequence: source.sequence })} onResult={(result) => { setSingleReviewed(!!result); setSingleRegions((result?.findings ?? []).flatMap((f) => { const region = findingRegion(volume, plane, sliceIndex, f); return region ? [region] : [] })); }} image={sliceTexture.url} modality={source.modality} label={`${source.title}${source.acquisition ? ` · ${acquisitionLabel(source.acquisition)}` : ''} · ${plane} ${sliceIndex + 1}/${count} · W ${width} / L ${level} · top ${geometry.labels.top}, left ${geometry.labels.left}`} width={geometry.width} height={geometry.height} />}</details></div><div className="volume-mobile-report" role="tabpanel" id={`${reviewId}-report-panel`} aria-labelledby={`${reviewId}-report-tab`}><VolumeReportPanel onNavigateEvidence={navigateEvidence} volume={volume} modality={source.modality} /></div></div></div>
      </div>
      <footer className="volume-footnote">Scroll over the image to change slices. Drag to pan. 3D uses reduced display resolution. Volume analysis reviews every acquired slice at the selected window.</footer>
    </>}
  </section>
}
