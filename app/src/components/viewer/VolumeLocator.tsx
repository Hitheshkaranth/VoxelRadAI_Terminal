import { ScanButton } from './ScanButton'
import { useId, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCcw } from 'lucide-react'
import './volumeLocator.css'

type Vector3 = readonly [number, number, number]
type VolumeAxis = 0 | 1 | 2
export interface VolumeLocatorProps {
  dimensions: Vector3
  /** Increasing voxel axes, expressed as direction cosines in patient LPS coordinates. */
  directions: readonly [Vector3, Vector3, Vector3]
  /** Patient coordinate of the center of voxel (0, 0, 0). */
  origin: Vector3
  spacing?: Vector3
  coordinateSystem?: 'LPS' | 'unknown'
  axis: VolumeAxis
  /** Zero-based voxel index on the selected acquisition axis. */
  index: number
  /** Canvas image in display order, with the axis mapping used to render that same slice. */
  sliceTexture?: { url: string; columnAxis: number; rowAxis: number; flipColumn: boolean; flipRow: boolean }
  onAxisChange?: (axis: VolumeAxis) => void
  onIndexChange?: (index: number) => void
}

const AXES = [0, 1, 2] as const
const DEFAULT_YAW = 0.65
const DEFAULT_PITCH = 0.38
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const cross = (a: Vector3, b: Vector3): Vector3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const magnitude = (v: Vector3) => Math.hypot(...v)

/** Names describe the actual acquisition plane; they never imply oblique resampling. */
function planeName(directions: VolumeLocatorProps['directions'], axis: VolumeAxis, anatomical: boolean): string {
  if (!anatomical) return `Axis ${axis + 1}`
  const other = AXES.filter((a) => a !== axis)
  const normal = cross(directions[other[0]], directions[other[1]])
  const length = magnitude(normal)
  const dominant = AXES.reduce((best, a) => Math.abs(normal[a]) > Math.abs(normal[best]) ? a : best, 0 as VolumeAxis)
  const name = ['Sagittal', 'Coronal', 'Axial'][dominant]
  return Math.abs(normal[dominant]) / length > 0.999 ? name : `Oblique ${name.toLowerCase()}`
}

export function VolumeLocator({ dimensions, directions, origin, spacing = [1, 1, 1], coordinateSystem = 'unknown', axis, index, sliceTexture, onAxisChange, onIndexChange }: VolumeLocatorProps) {
  const titleId = useId()
  const descriptionId = useId()
  const sliderId = useId()
  const [rotation, setRotation] = useState({ yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH })
  const pointer = useRef<{ id: number; x: number; y: number; yaw: number; pitch: number } | null>(null)
  const valid = Number.isFinite(index) && [...dimensions, ...spacing, ...origin, ...directions.flat()].every(Number.isFinite) &&
    dimensions.every((n) => n >= 1 && Number.isInteger(n)) && spacing.every((n) => n > 0) &&
    directions.every((v) => magnitude(v) > 0) && Math.abs(directions[0].reduce((dot, v, i) => dot + v * cross(directions[1], directions[2])[i], 0)) > 1e-6
  if (!valid) return <aside className="vl-locator"><p className="vl-unavailable">Slice locator unavailable: invalid volume geometry.</p></aside>

  const anatomical = coordinateSystem === 'LPS'
  const selectedIndex = clamp(Math.round(index), 0, dimensions[axis] - 1)
  const position = dimensions[axis] > 1 ? selectedIndex / (dimensions[axis] - 1) : 0.5
  const unit = anatomical ? 'mm' : 'units'
  const world = (voxel: Vector3): Vector3 => AXES.map((component) => origin[component] + AXES.reduce<number>((sum, a) => sum + voxel[a] * spacing[a] * directions[a][component], 0)) as unknown as Vector3
  const centerVoxel = dimensions.map((n) => (n - 1) / 2) as unknown as Vector3
  const center = world(centerVoxel)
  const projectVector = (v: Vector3) => {
    const x = v[0] * Math.cos(rotation.yaw) - v[1] * Math.sin(rotation.yaw)
    const depth = v[0] * Math.sin(rotation.yaw) + v[1] * Math.cos(rotation.yaw)
    return { x, y: depth * Math.sin(rotation.pitch) - v[2] * Math.cos(rotation.pitch), z: depth * Math.cos(rotation.pitch) + v[2] * Math.sin(rotation.pitch) }
  }
  const project = (point: Vector3) => projectVector(point.map((v, a) => v - center[a]) as unknown as Vector3)
  // Extent includes half a voxel around the first and last voxel centers.
  const corners = Array.from({ length: 8 }, (_, bits) => world(AXES.map((a) => bits & (1 << a) ? dimensions[a] - 0.5 : -0.5) as unknown as Vector3))
  const projected = corners.map(project)
  const minX = Math.min(...projected.map((p) => p.x)), maxX = Math.max(...projected.map((p) => p.x))
  const minY = Math.min(...projected.map((p) => p.y)), maxY = Math.max(...projected.map((p) => p.y))
  const scale = Math.min(222 / Math.max(maxX - minX, 1e-6), 156 / Math.max(maxY - minY, 1e-6))
  const screen = (p: ReturnType<typeof project>) => ({ x: 150 + (p.x - (minX + maxX) / 2) * scale, y: 112 + (p.y - (minY + maxY) / 2) * scale })
  const points = (vertices: Vector3[]) => vertices.map((v) => { const p = screen(project(v)); return `${p.x},${p.y}` }).join(' ')
  const faceIndices = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]]
  const faces = faceIndices.map((vertices) => ({ vertices, depth: vertices.reduce((n, i) => n + projected[i].z, 0) / 4 })).sort((a, b) => a.depth - b.depth)
  const edges = AXES.flatMap((a) => Array.from({ length: 8 }, (_, i) => i).filter((i) => !(i & (1 << a))).map((i) => [i, i | (1 << a)]))
  const otherAxes = AXES.filter((a) => a !== axis)
  const slice = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => {
    const voxel: [number, number, number] = [0, 0, 0]
    voxel[axis] = selectedIndex
    voxel[otherAxes[0]] = u ? dimensions[otherAxes[0]] - 0.5 : -0.5
    voxel[otherAxes[1]] = v ? dimensions[otherAxes[1]] - 0.5 : -0.5
    return world(voxel)
  })
  // An orthographic projection maps the slice to a parallelogram. Place the image's
  // outer pixel boundaries there (not voxel centers), so edge pixels align with the
  // full scan extent. Flips belong to the display canvas and are reversed here.
  const validTexture = sliceTexture && AXES.includes(sliceTexture.columnAxis as VolumeAxis) &&
    AXES.includes(sliceTexture.rowAxis as VolumeAxis) && sliceTexture.columnAxis !== sliceTexture.rowAxis &&
    sliceTexture.columnAxis !== axis && sliceTexture.rowAxis !== axis ? sliceTexture : undefined
  let textureTransform: string | undefined
  if (validTexture) {
    const textureCorner = (u: number, v: number) => {
      const voxel: [number, number, number] = [0, 0, 0]
      voxel[axis] = selectedIndex
      voxel[validTexture.columnAxis] = (validTexture.flipColumn ? 1 - u : u) * dimensions[validTexture.columnAxis] - 0.5
      voxel[validTexture.rowAxis] = (validTexture.flipRow ? 1 - v : v) * dimensions[validTexture.rowAxis] - 0.5
      return screen(project(world(voxel)))
    }
    const p = textureCorner(0, 0), column = textureCorner(1, 0), row = textureCorner(0, 1)
    textureTransform = `matrix(${column.x - p.x} ${column.y - p.y} ${row.x - p.x} ${row.y - p.y} ${p.x} ${p.y})`
  }
  const sliceCenterVoxel = [...centerVoxel] as [number, number, number]
  sliceCenterVoxel[axis] = selectedIndex
  const sliceCenter = world(sliceCenterVoxel)
  const marker = screen(project(sliceCenter))
  const selectedPlane = planeName(directions, axis, anatomical)
  const rotate = (yaw: number, pitch: number) => setRotation((r) => ({ yaw: r.yaw + yaw, pitch: clamp(r.pitch + pitch, -1.2, 1.2) }))
  const stopDrag = () => { pointer.current = null }

  return (
    <aside className="vl-locator" aria-label="3D slice locator">
      <header className="vl-header"><h3>Slice locator</h3><span className="vl-current-plane">{selectedPlane}</span></header>
      <div className="vl-canvas">
        <svg viewBox="0 0 300 226" role="img" aria-labelledby={`${titleId} ${descriptionId}`}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, ...rotation }
          }}
          onPointerMove={(event) => {
            const p = pointer.current
            if (!p || p.id !== event.pointerId) return
            setRotation({ yaw: p.yaw + (event.clientX - p.x) * 0.012, pitch: clamp(p.pitch + (event.clientY - p.y) * 0.012, -1.2, 1.2) })
          }}
          onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}>
          <title id={titleId}>{`${selectedPlane} slice ${selectedIndex + 1} of ${dimensions[axis]} within the acquired volume`}</title>
          <desc id={descriptionId}>Wireframe scan extent with the selected slice highlighted. Drag to rotate the locator, or use the rotation buttons. A 2D slice is positioned within scan bounds; this is not a surface reconstruction.</desc>
          {faces.map(({ vertices }, i) => <polygon key={i} points={points(vertices.map((v) => corners[v]))} className="vl-face" />)}
          {edges.map(([a, b]) => { const p = screen(projected[a]), q = screen(projected[b]); return <line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="vl-edge" /> })}
          <polygon points={points(slice)} className="vl-plane" />
          {validTexture && textureTransform && <image href={validTexture.url} width="1" height="1" preserveAspectRatio="none" transform={textureTransform} className="vl-slice-texture" />}
          <polygon points={points(slice)} className="vl-plane-border" />
          <circle cx={marker.x} cy={marker.y} r="3.5" className="vl-center" />
          <text x="12" y="212" className="vl-svg-caption">{anatomical ? 'Patient orientation · LPS' : 'Voxel orientation · anatomy unknown'}</text>
          {anatomical && (
            <g aria-hidden="true" className="vl-compass">
              {(['L', 'R', 'P', 'A', 'S', 'I'] as const).map((label, i) => {
                const v: [number, number, number] = [0, 0, 0]
                v[Math.floor(i / 2)] = i % 2 === 0 ? 1 : -1
                const p = projectVector(v)
                return <g key={label}><line x1="257" y1="34" x2={257 + p.x * 16} y2={34 + p.y * 16} /><text x={257 + p.x * 27} y={34 + p.y * 27 + 3}>{label}</text></g>
              })}
            </g>
          )}
        </svg>
        <div className="vl-rotate" role="group" aria-label="Rotate slice locator">
          <ScanButton type="button" title="Rotate left" aria-label="Rotate locator left" onClick={() => rotate(-0.25, 0)}><ArrowLeft /></ScanButton>
          <ScanButton type="button" title="Rotate right" aria-label="Rotate locator right" onClick={() => rotate(0.25, 0)}><ArrowRight /></ScanButton>
          <ScanButton type="button" title="Rotate up" aria-label="Rotate locator up" onClick={() => rotate(0, -0.2)}><ArrowUp /></ScanButton>
          <ScanButton type="button" title="Rotate down" aria-label="Rotate locator down" onClick={() => rotate(0, 0.2)}><ArrowDown /></ScanButton>
          <ScanButton type="button" title="Reset orientation" aria-label="Reset locator orientation" onClick={() => setRotation({ yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH })}><RotateCcw /></ScanButton>
        </div>
      </div>
      <div className="vl-controls">
        <div className="vl-axis-buttons" role="group" aria-label="Slice plane">
          {AXES.map((a) => <ScanButton type="button" key={a} aria-pressed={axis === a} disabled={!onAxisChange} onClick={() => onAxisChange?.(a)}>{planeName(directions, a, anatomical)}</ScanButton>)}
        </div>
        <div className="vl-index-label"><label htmlFor={sliderId}>Slice <strong>{selectedIndex + 1}</strong> / {dimensions[axis]}</label><span>{Math.round(position * 100)}% through stack</span></div>
        <input id={sliderId} className="vl-slice-range" type="range" min="0" max={Math.max(0, dimensions[axis] - 1)} step="1" value={selectedIndex}
          disabled={!onIndexChange || dimensions[axis] <= 1} aria-label={`${selectedPlane} slice`} aria-valuetext={`Slice ${selectedIndex + 1} of ${dimensions[axis]}`}
          onChange={(event) => onIndexChange?.(Number(event.target.value))} />
        <dl className="vl-metadata">
          <div><dt>Matrix</dt><dd>{dimensions.join(' × ')} voxels</dd></div>
          <div><dt>Spacing</dt><dd>{spacing.map((n) => Number(n.toFixed(3))).join(' × ')} {unit}</dd></div>
          <div><dt>{anatomical ? 'Center · LPS' : 'Slice center'}</dt><dd>{sliceCenter.map((n) => n.toFixed(1)).join(', ')} {unit}</dd></div>
        </dl>
        <p className="vl-note">2D slice positioned within scan bounds; no surface reconstruction.</p>
      </div>
    </aside>
  )
}
