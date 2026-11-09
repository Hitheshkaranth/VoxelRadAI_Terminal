import { ScanButton } from './ScanButton'
import { Hand, Maximize, Minus, Plus, SlidersHorizontal } from 'lucide-react'

type DisplayWindow = { center: number; width: number }
export interface VolumeDisplayControlsProps {
  center: number
  width: number
  range: [number, number]
  initialWindow?: DisplayWindow
  modality: string
  activeTool: 'pan' | 'window'
  onToolChange: (tool: 'pan' | 'window') => void
  onWindowChange: (window: DisplayWindow) => void
  onFit: () => void
  onFitContent?: () => void
  onZoomIn: () => void
  onZoomOut: () => void
}

export function VolumeDisplayControls({ center, width, range, initialWindow, modality, activeTool, onToolChange, onWindowChange, onFit, onFitContent, onZoomIn, onZoomOut }: VolumeDisplayControlsProps) {
  const fullRange = { center: (range[0] + range[1]) / 2, width: Math.max(1, range[1] - range[0]) }
  const presets = modality.toUpperCase() === 'CT'
    ? [
        { name: 'Narrow display (100/40)', center: 40, width: 100 },
        { name: 'Medium display (400/40)', center: 40, width: 400 },
        { name: 'Wide display (2000/500)', center: 500, width: 2000 },
        { name: 'Full range', ...fullRange },
      ]
    : [
        { name: 'Full range', ...fullRange },
        { name: 'Medium display (50% range)', center: fullRange.center, width: Math.max(1, fullRange.width * .5) },
        { name: 'Narrow display (25% range)', center: fullRange.center, width: Math.max(1, fullRange.width * .25) },
      ]
  const selected = presets.find((preset) => preset.center === center && preset.width === width)?.name ?? 'Custom'
  const changeNumber = (key: 'center' | 'width', value: string) => {
    if (!value.trim()) return
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return
    onWindowChange({ center, width, [key]: key === 'width' ? Math.max(1, numeric) : numeric })
  }
  return <div className="volume-display-controls">
    <div className="volume-display-row">
      <div className="volume-interaction-tools" role="group" aria-label="Image drag tool">
        <ScanButton type="button" className="btn btn-sm" aria-pressed={activeTool === 'pan'} onClick={() => onToolChange('pan')} title="Drag to pan the image"><Hand /> Pan</ScanButton>
        <ScanButton type="button" className="btn btn-sm" aria-pressed={activeTool === 'window'} onClick={() => onToolChange('window')} title="Drag horizontally for width and vertically for level"><SlidersHorizontal /> Window</ScanButton>
      </div>
      <div className="volume-zoom-tools" role="group" aria-label="Image scale">
        <ScanButton type="button" className="icon-btn" aria-label="Zoom out" onClick={onZoomOut}><Minus /></ScanButton>
        <ScanButton type="button" className="icon-btn" aria-label="Zoom in" onClick={onZoomIn}><Plus /></ScanButton>
        <ScanButton type="button" className="btn btn-sm" onClick={onFit}><Maximize /> Fit full image</ScanButton>
        {onFitContent && <ScanButton type="button" className="btn btn-sm" onClick={onFitContent} title="Zoom to visible pixels at the current window; source image remains unchanged">Fit visible content</ScanButton>}
      </div>
    </div>
    <div className="volume-display-row volume-window-row">
      <label>Display preset
        <select aria-label="Display window preset" value={selected} onChange={(event) => {
          const preset = presets.find((option) => option.name === event.target.value)
          if (preset) onWindowChange({ center: preset.center, width: preset.width })
        }}>
          <option value="Custom" disabled>Custom</option>
          {presets.map((preset) => <option key={preset.name} value={preset.name}>{preset.name}</option>)}
        </select>
      </label>
      <label>Width <input type="number" aria-label="Display window" min={1} step="any" value={width} onChange={(event) => changeNumber('width', event.target.value)} /></label>
      <label>Level <input type="number" aria-label="Display level" step="any" value={center} onChange={(event) => changeNumber('center', event.target.value)} /></label>
      <ScanButton type="button" className="btn btn-sm" onClick={() => onWindowChange(initialWindow ?? fullRange)}>Reset window</ScanButton>
    </div>
    <span className="volume-calibration-note">{modality.toUpperCase() === 'CT' ? 'Calibration unknown · Values are not verified HU' : 'Uncalibrated display values'}</span>
    <span className="volume-display-note">Display values{activeTool === 'window' ? ' · Drag left/right for width, up/down for level' : ' · Shift-drag or right-drag to window'}</span>
  </div>
}
