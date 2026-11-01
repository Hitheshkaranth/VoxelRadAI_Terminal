import { useRef } from 'react'
import { useShell } from './shellState'
import { VOLUME_SAMPLES } from '../../lib/volumeSources'

export function SampleStudies({ onOpen }: { onOpen: () => void }) {
  const current = useShell((s) => s.volumeSource)
  const fileInput = useRef<HTMLInputElement>(null)
  return <section className="sample-studies" aria-label="Sample volumes">
    <div className="sample-studies-row"><span>Sample scans</span>
      {VOLUME_SAMPLES.map((sample) => <button key={sample.id} type="button" className="btn btn-sm" aria-label={`Open ${sample.modality} volume`} aria-pressed={current?.id === sample.id && !current.file} onClick={() => { onOpen(); useShell.getState().openVolume(sample) }}>{sample.modality}</button>)}
    </div>
    <small>Sample datasets, not patient studies.</small>
    <button className="volume-file-link" onClick={() => fileInput.current?.click()}>Open NRRD volume…</button>
    <input ref={fileInput} type="file" accept=".nrrd" hidden onChange={(event) => {
      const file = event.target.files?.[0]
      if (file) { onOpen(); useShell.getState().openVolume({ id: crypto.randomUUID(), title: file.name, modality: 'Volume', file }) }
      event.target.value = ''
    }} />
  </section>
}
