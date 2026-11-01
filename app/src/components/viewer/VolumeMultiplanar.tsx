import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Maximize } from 'lucide-react'
import { getSliceGeometry, renderSlice, type Vec3, type Volume, type VolumePlane } from '../../lib/volume'
import { indexForPlane, setSliceAnchor, slicePointFromVoxel, voxelFromSlicePoint } from '../../lib/volumeNavigation'
import { regionOnSlice, type VolumeRegion } from '../../lib/volumeAnnotations'
import './volumeMultiplanar.css'

export interface VolumeMultiplanarProps {
  volume: Volume
  activePlane?: VolumePlane
  anchor: Vec3
  center: number
  width: number
  onAnchorChange: (anchor: Vec3) => void
  onMaximize: (plane: VolumePlane) => void
  regions?: VolumeRegion[]
  selectedRegion?: string | null
  onRegionSelect?: (region: VolumeRegion) => void
  showOverlays?: boolean
  overlayOpacity?: number
  onInteraction?: () => void
}
const planes: VolumePlane[] = ['axial', 'coronal', 'sagittal']
const title = (plane: VolumePlane) => plane[0].toUpperCase() + plane.slice(1)

/** Three orthogonal acquired planes share one voxel position; no independent slice state. */
export function VolumeMultiplanar(props: VolumeMultiplanarProps) {
  return <div className="volume-multiplanar" data-active-plane={props.activePlane ?? 'axial'} aria-label="Synchronized three-plane viewer">
    {planes.map((plane) => <PlaneView key={plane} plane={plane} {...props} />)}
  </div>
}

function PlaneView({ plane, volume, anchor, center, width, onAnchorChange, onMaximize, regions = [], selectedRegion, onRegionSelect, showOverlays = true, overlayOpacity = 1, onInteraction }: VolumeMultiplanarProps & { plane: VolumePlane }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const drag = useRef<number | null>(null)
  const [size, setSize] = useState({ width: 1, height: 1 })
  const geometry = useMemo(() => getSliceGeometry(volume, plane), [volume, plane])
  const index = indexForPlane(volume, anchor, plane)
  const slice = useMemo(() => renderSlice(volume, plane, index, { center, width }), [volume, plane, index, center, width])
  const point = slicePointFromVoxel(volume, plane, anchor)
  const physicalWidth = geometry.width * geometry.pixelSpacing[0], physicalHeight = geometry.height * geometry.pixelSpacing[1]
  const scale = Math.min(Math.max(1, size.width - 36) / physicalWidth, Math.max(1, size.height - 36) / physicalHeight)
  const imageWidth = physicalWidth * scale, imageHeight = physicalHeight * scale
  const opacity = Number.isFinite(overlayOpacity) ? Math.max(0, Math.min(1, overlayOpacity)) : 1
  const current = useRef({ anchor, index, onAnchorChange, onInteraction })
  useLayoutEffect(() => { current.current = { anchor, index, onAnchorChange, onInteraction } })
  useLayoutEffect(() => {
    const element = stage.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const image = canvas.current
    if (!image) return
    image.width = slice.width; image.height = slice.height
    image.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(slice.pixels), slice.width, slice.height), 0, 0)
  }, [slice])
  useEffect(() => {
    const element = stage.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      if (!event.deltaY) return
      event.preventDefault()
      const latest = current.current
      latest.onInteraction?.()
      latest.onAnchorChange(setSliceAnchor(volume, latest.anchor, plane, latest.index + Math.sign(event.deltaY)))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [volume, plane])
  const pick = (clientX: number, clientY: number) => {
    const rect = canvas.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    const x = (clientX - rect.left) / rect.width, y = (clientY - rect.top) / rect.height
    if (x < 0 || x > 1 || y < 0 || y > 1) return
    onInteraction?.()
    onAnchorChange(voxelFromSlicePoint(volume, plane, index, { x, y }))
  }
  return <section className="volume-plane-view" data-plane={plane} aria-label={`${title(plane)} plane`}>
    <header><div><strong>{title(plane)}</strong><span>{index + 1}/{geometry.count}{geometry.oblique ? ' · acquired oblique' : ''}</span></div><button type="button" className="icon-btn" aria-label={`Maximize ${plane} view`} title={`Maximize ${plane}`} onClick={() => { onInteraction?.(); onMaximize(plane) }}><Maximize /></button></header>
    <div ref={stage} className="volume-plane-stage" tabIndex={0} aria-label={`${title(plane)} slice ${index + 1} of ${geometry.count}. Click to position crosshairs; scroll or use arrow keys to change slices.`}
      onKeyDown={(event) => {
        const change = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0
        if (!change) return
        event.preventDefault(); event.stopPropagation(); onInteraction?.()
        onAnchorChange(setSliceAnchor(volume, anchor, plane, index + change))
      }}
      onPointerDown={(event) => { if (event.button !== 0) return; event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = event.pointerId; pick(event.clientX, event.clientY) }}
      onPointerMove={(event) => { if (drag.current === event.pointerId) pick(event.clientX, event.clientY) }}
      onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}>
      <canvas ref={canvas} className="volume-plane-image" style={{ width: imageWidth, height: imageHeight }} role="img" aria-label={`${title(plane)} source image, slice ${index + 1}`} />
      {showOverlays && <svg className="volume-plane-overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none" style={{ width: imageWidth, height: imageHeight, opacity }} aria-label={`${title(plane)} finding locations`}>
        <line className="volume-plane-crosshair" x1={point.x * 1000} x2={point.x * 1000} y1="0" y2="1000" />
        <line className="volume-plane-crosshair" x1="0" x2="1000" y1={point.y * 1000} y2={point.y * 1000} />
        {regions.map((region, number) => { const box = regionOnSlice(volume, plane, index, region); return box && <g key={region.id} data-selected={selectedRegion === region.id} role="button" tabIndex={0} aria-label={`Finding ${number+1}: ${region.title}; source ${region.plane} slice ${region.index+1}`} onPointerDown={event => event.stopPropagation()} onClick={() => onRegionSelect?.(region)} onKeyDown={event => { if(event.key === 'Enter' || event.key === ' ') {event.preventDefault();event.stopPropagation();onRegionSelect?.(region)} }}><title>{region.title} · source {region.plane} {region.index+1}</title><rect x={box.x * 1000} y={box.y * 1000} width={box.w * 1000} height={box.h * 1000} /><text x={box.x * 1000 + 4} y={Math.max(22, box.y * 1000 - 8)}>{number + 1}</text></g> })}
      </svg>}
      <span className="volume-plane-direction volume-plane-direction--top">{geometry.labels.top}</span><span className="volume-plane-direction volume-plane-direction--bottom">{geometry.labels.bottom}</span><span className="volume-plane-direction volume-plane-direction--left">{geometry.labels.left}</span><span className="volume-plane-direction volume-plane-direction--right">{geometry.labels.right}</span>
    </div>
    <footer>Click or touch to position · Scroll to browse</footer>
  </section>
}
