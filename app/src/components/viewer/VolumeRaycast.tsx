import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { projectRegion, type VolumeRegion } from '../../lib/volumeAnnotations'
import type { Volume } from '../../lib/volume'
import './volumeRaycast.css'
import { useVolumePreference } from './volumeLayout'

type Axis = 0 | 1 | 2
export interface VolumeRaycastProps {
  volume: Volume
  hideOverlays?: boolean
  overlayOpacity?: number
  regions?: VolumeRegion[]
  selectedRegion?: string | null
  onRegionSelect?: (region: VolumeRegion) => void
  axis: Axis
  index: number
  onIndexChange?: (index: number) => void
  modality?: string
  window?: { center: number; width: number }
}
type Display = { yaw: number; pitch: number; threshold: number; opacity: number; overlayOpacity: number; plane: boolean; axis: Axis; index: number; center: number; width: number }
type Renderer = { draw: (display: Display) => void; dispose: () => void; pick: (x: number, y: number, display: Display) => number | null }

const VERTEX = `#version 300 es
precision highp float;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`
const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler3D uVolume;
uniform vec2 uResolution;
uniform vec3 uExtent;
uniform mat3 uDirections;
uniform vec2 uRotation;
uniform vec2 uRange;
uniform float uThreshold;
uniform float uOpacity;
uniform float uOverlayOpacity;
uniform float uCenter;
uniform float uWidth;
uniform int uAxis;
uniform float uSlice;
uniform bool uShowPlane;
uniform bool uPicking;
out vec4 fragColor;
float raw(vec3 p) { return texture(uVolume, clamp(p, vec3(0.0), vec3(1.0))).r * uRange.y + uRange.x; }
float grey(float value) { return clamp((value - uCenter) / max(uWidth, 0.001) + 0.5, 0.0, 1.0); }
void composite(inout vec4 accumulated, vec3 color, float alpha) {
  accumulated.rgb += (1.0 - accumulated.a) * color * alpha;
  accumulated.a += (1.0 - accumulated.a) * alpha;
}
void main() {
  vec2 screen = (gl_FragCoord.xy / uResolution * 2.0 - 1.0);
  screen.x *= uResolution.x / uResolution.y;
  // Patient LPS camera, then rotate into the acquired volume basis.
  float yaw = uRotation.x, pitch = uRotation.y;
  vec3 front = vec3(sin(yaw) * cos(pitch), -cos(yaw) * cos(pitch), sin(pitch));
  vec3 right = vec3(cos(yaw), sin(yaw), 0.0);
  vec3 up = normalize(cross(front, right));
  mat3 toLocal = transpose(uDirections);
  vec3 origin = toLocal * (right * screen.x * 0.92 + up * screen.y * 0.92 + front * 2.0);
  vec3 ray = normalize(toLocal * -front);
  vec3 safeRay = vec3(abs(ray.x) < 1e-7 ? (ray.x < 0.0 ? -1e-7 : 1e-7) : ray.x,
                      abs(ray.y) < 1e-7 ? (ray.y < 0.0 ? -1e-7 : 1e-7) : ray.y,
                      abs(ray.z) < 1e-7 ? (ray.z < 0.0 ? -1e-7 : 1e-7) : ray.z);
  vec3 low = (-uExtent * 0.5 - origin) / safeRay;
  vec3 high = (uExtent * 0.5 - origin) / safeRay;
  vec3 near = min(low, high), far = max(low, high);
  float enter = max(max(near.x, near.y), near.z);
  float leave = min(min(far.x, far.y), far.z);
  vec3 background = vec3(0.035, 0.055, 0.07);
  if (leave <= max(enter, 0.0)) { fragColor = uPicking ? vec4(0.0) : vec4(background, 1.0); return; }
  enter = max(enter, 0.0);
  float planeT = ((uSlice - 0.5) * uExtent[uAxis] - origin[uAxis]) / safeRay[uAxis];
  bool planePending = !uPicking && uShowPlane && abs(ray[uAxis]) > 1e-7 && planeT >= enter && planeT <= leave;
  // A fixed physical step makes the opacity transfer stable as the object rotates.
  float stepSize = 0.006;
  float softness = max(uRange.y * 0.025, 0.001);
  vec4 accumulated = vec4(0.0);
  for (int step = 0; step < 320; step++) {
    float t = enter + (float(step) + 0.5) * stepSize;
    if (planePending && planeT <= min(t + 0.5 * stepSize, leave)) {
      vec3 p = (origin + planeT * ray) / uExtent + 0.5;
      if (all(greaterThanEqual(p, vec3(-0.001))) && all(lessThanEqual(p, vec3(1.001)))) {
        float edge = 1.0;
        for (int a = 0; a < 3; a++) if (a != uAxis) edge = min(edge, min(p[a], 1.0 - p[a]));
        float value = grey(raw(p));
        bool outline = edge < 0.012;
        composite(accumulated, outline ? vec3(0.2, 0.94, 1.0) : mix(vec3(value), vec3(0.1, 0.65, 0.7), 0.14), (outline ? 0.94 : 0.62) * uOverlayOpacity);
      }
      planePending = false;
    }
    if (t > leave || accumulated.a > 0.985) break;
    vec3 p = (origin + t * ray) / uExtent + 0.5;
    float value = raw(p);
    float density = smoothstep(uThreshold, uThreshold + softness, value);
    if (uPicking) {
      if (density > 0.1) { float encoded = floor(clamp(p[uAxis], 0.0, 1.0) * 65535.0 + 0.5); fragColor = vec4(floor(encoded / 256.0) / 255.0, mod(encoded, 256.0) / 255.0, 1.0, 1.0); return; }
      continue;
    }
    if (density < 0.001) continue;
    float lightValue = clamp((value - uThreshold) / max(uRange.y * 0.35, 0.001), 0.0, 1.0);
    // Directional gradient shading reveals surfaces using the measured scalar field.
    vec3 texel = 1.0 / vec3(textureSize(uVolume, 0));
    vec3 gradient = vec3(
      texture(uVolume, clamp(p + vec3(texel.x,0,0),0.0,1.0)).r - texture(uVolume, clamp(p - vec3(texel.x,0,0),0.0,1.0)).r,
      texture(uVolume, clamp(p + vec3(0,texel.y,0),0.0,1.0)).r - texture(uVolume, clamp(p - vec3(0,texel.y,0),0.0,1.0)).r,
      texture(uVolume, clamp(p + vec3(0,0,texel.z),0.0,1.0)).r - texture(uVolume, clamp(p - vec3(0,0,texel.z),0.0,1.0)).r
    ) / max(texel * uExtent, vec3(0.00001));
    float shading = length(gradient) < 0.00001 ? 0.7 : 0.3 + 0.7 * abs(dot(normalize(gradient), -ray));
    vec3 color = mix(vec3(0.56,0.60,0.64), vec3(0.97,0.93,0.84), lightValue) * shading;
    float alpha = 1.0 - exp(-density * uOpacity * stepSize * 28.0);
    composite(accumulated, color, alpha);
  }
  if (uPicking) { fragColor = vec4(0.0); return; }
  fragColor = vec4(accumulated.rgb + background * (1.0 - accumulated.a), 1.0);
}`

/** Every source voxel contributes to its display cell; all source slices are included. */
async function downsample(volume: Volume, cancelled: () => boolean): Promise<{ data: Uint8Array; size: [number, number, number] }> {
  const size = volume.dimensions.map((n) => Math.min(n, 160)) as [number, number, number]
  const [nx, ny, nz] = volume.dimensions, [dx, dy, dz] = size
  const data = new Uint8Array(dx * dy * dz)
  const [min, max] = volume.range, span = Math.max(max - min, 1)
  for (let z = 0; z < dz; z++) {
    if (cancelled()) throw new Error('Cancelled')
    const z0 = Math.floor(z * nz / dz), z1 = Math.floor((z + 1) * nz / dz)
    for (let y = 0; y < dy; y++) {
      const y0 = Math.floor(y * ny / dy), y1 = Math.floor((y + 1) * ny / dy)
      for (let x = 0; x < dx; x++) {
        const x0 = Math.floor(x * nx / dx), x1 = Math.floor((x + 1) * nx / dx)
        let sum = 0
        for (let sz = z0; sz < z1; sz++) for (let sy = y0; sy < y1; sy++) {
          const start = nx * (sy + ny * sz)
          for (let sx = x0; sx < x1; sx++) sum += volume.data[start + sx]
        }
        const mean = sum / ((x1 - x0) * (y1 - y0) * (z1 - z0))
        data[x + dx * (y + dy * z)] = Math.round(Math.min(1, Math.max(0, (mean - min) / span)) * 255)
      }
    }
    if (z % 4 === 3) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  return { data, size }
}

function createRenderer(canvas: HTMLCanvasElement, volume: Volume, textureData: Uint8Array, size: [number, number, number]): Renderer {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true })
  if (!gl) throw new Error('3D rendering needs WebGL 2. Enable hardware acceleration or use another browser.')
  if (Math.max(...size) > gl.getParameter(gl.MAX_3D_TEXTURE_SIZE)) throw new Error('This GPU cannot hold the display volume.')
  const shaders: WebGLShader[] = []
  let program: WebGLProgram | null = null, texture: WebGLTexture | null = null
  const dispose = () => { if (texture) gl.deleteTexture(texture); if (program) gl.deleteProgram(program); shaders.forEach((s) => gl.deleteShader(s)) }
  try {
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)
      if (!shader) throw new Error('Could not allocate a 3D shader.')
      shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`3D shader failed: ${gl.getShaderInfoLog(shader) || 'unsupported GPU'}`)
      return shader
    }
    program = gl.createProgram()
    if (!program) throw new Error('Could not create the 3D renderer.')
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT)); gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('The 3D renderer could not link on this GPU.')
    gl.useProgram(program)
    texture = gl.createTexture()
    if (!texture) throw new Error('Could not allocate a 3D texture.')
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, texture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    for (const parameter of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, parameter, gl.CLAMP_TO_EDGE)
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, size[0], size[1], size[2], 0, gl.RED, gl.UNSIGNED_BYTE, textureData)
    if (gl.getError() !== gl.NO_ERROR) throw new Error('The GPU could not upload the 3D volume.')
    const uniform = (name: string) => gl.getUniformLocation(program!, name)
    const uniforms = Object.fromEntries(['uVolume','uResolution','uExtent','uDirections','uRotation','uRange','uThreshold','uOpacity','uOverlayOpacity','uCenter','uWidth','uAxis','uSlice','uShowPlane','uPicking'].map((name) => [name, uniform(name)]))
    const physical = volume.dimensions.map((n, i) => n * volume.spacing[i]), extent = physical.map((n) => n / Math.max(...physical))
    gl.uniform1i(uniforms.uVolume, 0); gl.uniform3fv(uniforms.uExtent, extent)
    gl.uniformMatrix3fv(uniforms.uDirections, false, volume.directions.flat())
    gl.uniform2f(uniforms.uRange, volume.range[0], Math.max(volume.range[1] - volume.range[0], 1))
    return {
      dispose,
      pick: (x, y, display) => {
        gl.disable(gl.DITHER)
        gl.uniform1i(uniforms.uPicking, 1)
        try {
          gl.drawArrays(gl.TRIANGLES, 0, 3)
          const pixel = new Uint8Array(4)
          gl.readPixels(Math.min(canvas.width - 1, Math.max(0, Math.floor(x * canvas.width))), Math.min(canvas.height - 1, Math.max(0, Math.floor((1 - y) * canvas.height))), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
          return pixel[2] === 255 ? Math.max(0, Math.min(volume.dimensions[display.axis] - 1, Math.round((pixel[0] * 256 + pixel[1]) / 65535 * volume.dimensions[display.axis] - .5))) : null
        } finally {
          gl.uniform1i(uniforms.uPicking, 0)
          gl.drawArrays(gl.TRIANGLES, 0, 3)
        }
      },
      draw: (display) => {
        const width = Math.max(1, Math.round(canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 1.5)))
        const height = Math.max(1, Math.round(canvas.clientHeight * Math.min(window.devicePixelRatio || 1, 1.5)))
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
        gl.viewport(0, 0, width, height); gl.useProgram(program)
        gl.uniform2f(uniforms.uResolution, width, height); gl.uniform2f(uniforms.uRotation, display.yaw, display.pitch)
        gl.uniform1f(uniforms.uOverlayOpacity, display.overlayOpacity); gl.uniform1f(uniforms.uThreshold, display.threshold); gl.uniform1f(uniforms.uOpacity, display.opacity)
        gl.uniform1f(uniforms.uCenter, display.center); gl.uniform1f(uniforms.uWidth, display.width)
        gl.uniform1i(uniforms.uAxis, display.axis)
        gl.uniform1f(uniforms.uSlice, (Math.max(0, Math.min(volume.dimensions[display.axis] - 1, display.index)) + 0.5) / volume.dimensions[display.axis])
        gl.uniform1i(uniforms.uShowPlane, display.plane ? 1 : 0)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      },
    }
  } catch (error) { dispose(); throw error }
}

export function VolumeRaycast({ hideOverlays = false, overlayOpacity = .8, regions = [], selectedRegion, onRegionSelect, volume, axis, index, onIndexChange, modality = '', window: windowLevel }: VolumeRaycastProps) {
  const [toolsOpen, setToolsOpen] = useVolumePreference('threeDToolsOpen')
  const canvas = useRef<HTMLCanvasElement>(null), renderer = useRef<Renderer | null>(null)
  const [viewport, setViewport] = useState({ width: 320, height: 290 })
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [rotation, setRotation] = useState({ yaw: 0.55, pitch: 0.3 })
  const span = Math.max(volume.range[1] - volume.range[0], 1)
  const bone = modality.toUpperCase() === 'CT' && volume.range[0] < 0 && volume.range[1] > 400
  const initialThreshold = bone ? 250 : volume.range[0] + span * 0.18
  const [threshold, setThreshold] = useState(initialThreshold)
  const [opacity, setOpacity] = useState(0.3)
  const [showPlane, setShowPlane] = useState(true)
  const [displaySize, setDisplaySize] = useState<[number, number, number] | null>(null)
  const pointer = useRef<{ id: number; x: number; y: number; yaw: number; pitch: number; moved: boolean } | null>(null)
  const display: Display = { ...rotation, threshold, opacity, overlayOpacity, plane: showPlane && !hideOverlays, axis, index, center: windowLevel?.center ?? (volume.range[0] + volume.range[1]) / 2, width: windowLevel?.width ?? span }
  const displayRef = useRef(display)
  useLayoutEffect(() => { displayRef.current = display })

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    let cancelled = false
    setStatus('loading'); setError(''); setDisplaySize(null); setThreshold(initialThreshold)
    const lost = (event: Event) => { event.preventDefault(); setStatus('error'); setError('GPU context lost. Reload this volume to rebuild the 3D view.') }
    element.addEventListener('webglcontextlost', lost)
    void downsample(volume, () => cancelled).then(({ data, size }) => {
      if (cancelled) return
      renderer.current = createRenderer(element, volume, data, size)
      setDisplaySize(size); setStatus('ready'); renderer.current.draw(displayRef.current)
    }).catch((reason: unknown) => { if (!cancelled) { setStatus('error'); setError(reason instanceof Error ? reason.message : '3D rendering failed.') } })
    const observer = new ResizeObserver(() => { setViewport({ width: element.clientWidth, height: element.clientHeight }); renderer.current?.draw(displayRef.current) })
    observer.observe(element)
    return () => { cancelled = true; observer.disconnect(); element.removeEventListener('webglcontextlost', lost); renderer.current?.dispose(); renderer.current = null }
  }, [volume, initialThreshold])

  useEffect(() => { if (status === 'ready') renderer.current?.draw(displayRef.current) }, [status, rotation, threshold, opacity, showPlane, hideOverlays, overlayOpacity, axis, index, windowLevel?.center, windowLevel?.width])
  const stopDrag = () => { pointer.current = null }
  return (
    <section className="vr-volume" aria-label="3D volume reconstruction">
      <header className="vr-header"><h3>3D volume</h3><button type="button" aria-label="Reset 3D orientation" title="Reset orientation" onClick={() => setRotation({ yaw: 0.55, pitch: 0.3 })}><RotateCcw /></button></header>
      <div className="vr-stage">
        <canvas ref={canvas} role="img" aria-label={`3D reconstruction from all ${volume.dimensions[2]} source slices. Selected acquired axis ${axis + 1}, slice ${index + 1}. Tap anatomy to navigate; drag to rotate.`}
          onPointerDown={(event) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, ...rotation } }}
          onPointerMove={(event) => { const p = pointer.current; if (!p || p.id !== event.pointerId) return; if (Math.hypot(event.clientX - p.x, event.clientY - p.y) > 6) p.moved = true; if (!p.moved) return; setRotation({ yaw: p.yaw + (event.clientX - p.x) * 0.012, pitch: Math.max(-1.3, Math.min(1.3, p.pitch + (event.clientY - p.y) * 0.012)) }) }}
          onPointerUp={(event) => {
            const p = pointer.current
            if (p?.id === event.pointerId && !p.moved && status === 'ready') {
              const rect = event.currentTarget.getBoundingClientRect()
              const selected = renderer.current?.pick((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height, displayRef.current)
              if (selected != null) onIndexChange?.(selected)
            }
            stopDrag()
          }} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag} />
        {status === 'ready' && regions.length > 0 && <svg opacity={overlayOpacity} className="vr-region-overlay" viewBox={`0 0 ${viewport.width} ${viewport.height}`} aria-label="3D finding bounding regions">
          {regions.map((region, number) => {
            const points = projectRegion(volume, region, rotation.yaw, rotation.pitch, viewport.width, viewport.height)
            const edges = [[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]]
            return <g key={region.id} data-selected={selectedRegion === region.id} role="button" tabIndex={0} aria-label={`3D finding ${number + 1}: ${region.title}`} onClick={() => onRegionSelect?.(region)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRegionSelect?.(region) } }}>
              <title>{region.title} · {region.plane} slice {region.index + 1}</title>
              <rect className="vr-region-hit" x={Math.min(...points.map(p=>p[0]))-4} y={Math.min(...points.map(p=>p[1]))-16} width={Math.max(16, Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0]))+8)} height={Math.max(24, Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1]))+20)} />
              <polygon points={[0,1,3,2].map(i=>points[i].join(',')).join(' ')} />
              {edges.map(([a,b]) => <line key={`${a}-${b}`} x1={points[a][0]} y1={points[a][1]} x2={points[b][0]} y2={points[b][1]} />)}
              <text x={points[0][0]} y={points[0][1]-5}>{number+1}</text>
            </g>
          })}
        </svg>}
        {status !== 'ready'  && <div className="vr-status" role="status">{status === 'loading' ? 'Building 3D view from the full scan…' : error}</div>}
        {status === 'ready' && <span className="vr-hint">Tap anatomy to select slice · Drag to rotate</span>}
      </div>
      <details className="vr-controls" open={toolsOpen} onToggle={(event) => setToolsOpen(event.currentTarget.open)}><summary>3D display controls</summary>{regions.length > 0 && <p className="vr-resolution">Finding boxes are visible through the volume. Depth shows the analyzed slice, not lesion thickness.</p>}
        <div className="vr-presets" role="group" aria-label="3D display presets">
          {bone && <button type="button" onClick={() => { setThreshold(250); setOpacity(0.3) }}>CT bone</button>}
          <button type="button" onClick={() => { setThreshold(bone ? -200 : volume.range[0] + span * 0.12); setOpacity(0.12) }}>Tissue</button>
          <button type="button" onClick={() => { setThreshold(initialThreshold); setOpacity(0.08) }}>Transparent</button>
        </div>
        <label className="vr-field"><span>Intensity threshold <output>{Math.round(threshold)}</output></span><input type="range" min={volume.range[0]} max={volume.range[1]} step={Math.max(1, span / 1000)} value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} /></label>
        <label className="vr-field"><span>Opacity <output>{Math.round(opacity * 100)}%</output></span><input type="range" min="0.02" max="1" step="0.01" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></label>
        <label className="vr-check"><input type="checkbox" checked={showPlane} onChange={(event) => setShowPlane(event.target.checked)} /> Show current slice inside volume</label>
        <div className="vr-rotation" role="group" aria-label="Rotate 3D volume">
          <button type="button" onClick={() => setRotation((r) => ({ ...r, yaw: r.yaw - 0.3 }))}>Left</button>
          <button type="button" onClick={() => setRotation((r) => ({ ...r, yaw: r.yaw + 0.3 }))}>Right</button>
          <button type="button" onClick={() => setRotation((r) => ({ ...r, pitch: Math.max(-1.3, r.pitch - 0.2) }))}>Up</button>
          <button type="button" onClick={() => setRotation((r) => ({ ...r, pitch: Math.min(1.3, r.pitch + 0.2) }))}>Down</button>
        </div>
        {displaySize && <p className="vr-resolution">All source slices · {displaySize.join(' × ')} display voxels · 8-bit intensity</p>}
      </details>
    </section>
  )
}
