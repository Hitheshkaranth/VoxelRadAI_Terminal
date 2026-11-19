import { ScanButton } from './ScanButton'
import { useState, type CSSProperties } from 'react'
import { Circle, FileInput, Ruler, Trash2 } from 'lucide-react'
import type { Volume, VolumePlane } from '../../lib/volume'
import { ellipseStats, measurementsOnSlice, sliceLengthMm, valueUnit, volumeMeasurementText, type VolumeMeasurement, type VolumeMeasurementKind } from '../../lib/volumeMeasure'
import { SLAB_LABELS, type SlabMode, type SlabSettings } from '../../lib/volumeSlab'
import { insertIntoReport, insertResultLabel } from '../../lib/reportInsert'
import './volumeMeasure.css'

const fixed = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1)

/** Measurements of the current slice, drawn in display pixels of the unzoomed image box. */
export function VolumeMeasureOverlay({ volume, plane, index, measurements, draft, width, height, zoom, style }: {
  volume: Volume; plane: VolumePlane; index: number; measurements: VolumeMeasurement[]; draft: VolumeMeasurement | null
  width: number; height: number; zoom: number; style: CSSProperties
}) {
  const shown = measurementsOnSlice(measurements, plane, index)
  // The overlay is scaled with the image; keep text a constant on-screen size.
  const font = 12 / zoom
  const shape = (m: VolumeMeasurement, n: number | null) => {
    const ax = m.a.x * width, ay = m.a.y * height, bx = m.b.x * width, by = m.b.y * height
    let label: string
    if (m.kind === 'length') label = `${fixed(Math.round(sliceLengthMm(volume, plane, m.a, m.b) * 10) / 10)} mm`
    else { const s = ellipseStats(volume, plane, index, m.a, m.b); label = s ? `μ ${fixed(s.mean)} σ ${fixed(s.sd)} · ${(s.areaMm2 / 100).toFixed(2)} cm²` : 'Empty ROI' }
    const prefix = n ? `${n}. ` : ''
    return <g key={m.id} className={n ? undefined : 'volume-measure-draft'}>
      {m.kind === 'length'
        ? <><line x1={ax} y1={ay} x2={bx} y2={by} /><circle cx={ax} cy={ay} r={3 / zoom} /><circle cx={bx} cy={by} r={3 / zoom} /></>
        : <ellipse cx={(ax + bx) / 2} cy={(ay + by) / 2} rx={Math.abs(bx - ax) / 2} ry={Math.abs(by - ay) / 2} />}
      <text x={Math.max(ax, bx) + 6 / zoom} y={Math.min(ay, by) - 4 / zoom} fontSize={font}>{prefix}{label}</text>
    </g>
  }
  return <svg className="volume-measure-overlay" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={style} aria-label="Measurements on this slice">
    {shown.map((m) => shape(m, measurements.indexOf(m) + 1))}
    {draft && shape(draft, null)}
  </svg>
}

/** Tool choice, the volume's measurement list and report insertion. */
export function VolumeMeasurePanel({ volume, modality, tool, onTool, measurements, onChange, onSelect }: {
  volume: Volume; modality: string; tool: VolumeMeasurementKind | null; onTool: (tool: VolumeMeasurementKind | null) => void
  measurements: VolumeMeasurement[]; onChange: (next: VolumeMeasurement[]) => void; onSelect: (m: VolumeMeasurement) => void
}) {
  const [status, setStatus] = useState('')
  const insert = async (text: string) => setStatus(insertResultLabel(await insertIntoReport(text)))
  return <div className="volume-measure-panel">
    <div className="volume-measure-tools" role="radiogroup" aria-label="Measuring tool">
      <ScanButton role="radio" className="btn btn-sm" aria-checked={tool === 'length'} onClick={() => onTool(tool === 'length' ? null : 'length')}><Ruler size={14} /> Length (L)</ScanButton>
      <ScanButton role="radio" className="btn btn-sm" aria-checked={tool === 'ellipse'} onClick={() => onTool(tool === 'ellipse' ? null : 'ellipse')}><Circle size={14} /> Ellipse ROI (E)</ScanButton>
    </div>
    <p className="volume-measure-note">Drag on the single-plane image. Lengths use voxel spacing; ROI values are source scalars in {valueUnit(modality)}. Manual measurements are the reader's own.</p>
    {measurements.length ? <ol className="volume-measure-list" aria-label="Volume measurements">
      {measurements.map((m, i) => <li key={m.id}>
        <ScanButton className="volume-measure-item" title="Show this slice" onClick={() => onSelect(m)}><span>{i + 1}.</span> {volumeMeasurementText(volume, m, modality)}</ScanButton>
        <ScanButton className="icon-btn" aria-label={`Insert measurement ${i + 1} into report`} title="Insert into report" onClick={() => void insert(volumeMeasurementText(volume, m, modality))}><FileInput size={14} /></ScanButton>
        <ScanButton className="icon-btn" aria-label={`Delete measurement ${i + 1}`} title="Delete" onClick={() => onChange(measurements.filter((x) => x.id !== m.id))}><Trash2 size={14} /></ScanButton>
      </li>)}
    </ol> : <p className="volume-measure-note">No measurements on this volume yet.</p>}
    <div className="volume-measure-actions">
      <ScanButton className="btn btn-sm" disabled={!measurements.length} onClick={() => void insert(measurements.map((m) => volumeMeasurementText(volume, m, modality)).join('; '))}>Insert all into report</ScanButton>
      <ScanButton className="btn btn-sm" disabled={!measurements.length} onClick={() => { onChange([]); setStatus('') }}>Clear all</ScanButton>
    </div>
    {status && <p className="volume-measure-note" role="status">{status}</p>}
  </div>
}

/** Thick-slab projection along the active plane; display only. */
export function VolumeSlabControls({ slab, onChange, sliceSpacing }: { slab: SlabSettings; onChange: (slab: SlabSettings) => void; sliceSpacing: number }) {
  return <div className="volume-slab-controls" role="group" aria-label="Slab projection">
    <label>Slab <select aria-label="Slab projection" value={slab.mode} onChange={(e) => onChange({ ...slab, mode: e.target.value as SlabMode })}>
      {(Object.keys(SLAB_LABELS) as SlabMode[]).map((mode) => <option key={mode} value={mode}>{SLAB_LABELS[mode]}</option>)}
    </select></label>
    <label>Thickness <input type="number" aria-label="Slab thickness in millimetres" min={sliceSpacing} max={200} step={sliceSpacing >= 1 ? 1 : .5} disabled={slab.mode === 'none'} value={slab.thicknessMm} onChange={(e) => { const mm = Number(e.target.value); if (Number.isFinite(mm) && mm > 0) onChange({ ...slab, thicknessMm: Math.min(200, mm) }) }} /> mm</label>
    <small>Display only · analysis and measurements use the single acquired slice.</small>
  </div>
}
