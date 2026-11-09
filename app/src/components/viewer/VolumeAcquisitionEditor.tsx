import { useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { ScanButton } from './ScanButton'
import { normalizeAcquisition, type VolumeAcquisition } from '../../lib/volumeAcquisition'
import type { VolumeSource } from '../../lib/volumeSources'
import './volumeAcquisition.css'

export function VolumeAcquisitionEditor({ source, onSave }: { source: VolumeSource; onSave: (context: VolumeAcquisition) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<VolumeAcquisition>(() => source.acquisition ?? {
    modality: source.modality === 'CT' ? 'CT' : /^(MR|MRI)$/.test(source.modality) ? 'MRI' : 'Volume',
    sequence: source.sequence ?? '', bodyPart: '', contrast: 'unknown', intensityIsHU: false,
  })
  const change = <K extends keyof VolumeAcquisition>(key: K, value: VolumeAcquisition[K]) => setDraft(current => ({ ...current, [key]: value }))
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><ScanButton aria-label="Acquisition details"><ClipboardList size={16} /><span>{source.modality === 'Volume' ? 'Set modality' : 'Acquisition'}</span></ScanButton></PopoverTrigger>
    <PopoverContent className="scan-display-popover volume-acquisition" align="end" aria-label="Acquisition details">
      <form onSubmit={async event => { event.preventDefault(); setSaving(true); setError(''); try { await onSave(normalizeAcquisition(draft)); setOpen(false) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update acquisition details.') } finally { setSaving(false) } }}>
        <h3>Acquisition details</h3>
        <p>Enter details from the source acquisition. Unknown values remain unknown; the filename does not confirm them.</p>
        <label>Modality<select value={draft.modality} onChange={event => change('modality', event.target.value as VolumeAcquisition['modality'])}><option value="Volume">Unknown</option><option value="CT">CT</option><option value="MRI">MRI</option></select></label>
        <label>Body region<input maxLength={120} value={draft.bodyPart} placeholder="Unknown" onChange={event => change('bodyPart', event.target.value)} /></label>
        {draft.modality === 'MRI' && <label>MRI sequence<input maxLength={120} value={draft.sequence} placeholder="For example, T2 or T1 post-contrast" onChange={event => change('sequence', event.target.value)} /></label>}
        <label>Contrast<select value={draft.contrast} onChange={event => change('contrast', event.target.value as VolumeAcquisition['contrast'])}><option value="unknown">Unknown</option><option value="without">Without contrast</option><option value="with">With contrast</option></select></label>
        {draft.modality === 'CT' && <label className="volume-acquisition-check"><input type="checkbox" checked={draft.intensityIsHU} onChange={event => change('intensityIsHU', event.target.checked)} /><span>Source voxels are already calibrated in Hounsfield units</span></label>}
        <p>Saving pauses the previous analysis and opens a separate review identity. Previous results stay in browser storage.</p>
        {error && <p role="alert">{error}</p>}
        <ScanButton type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save acquisition details'}</ScanButton>
      </form>
    </PopoverContent>
  </Popover>
}
