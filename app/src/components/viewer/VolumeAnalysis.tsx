import { useEffect, useRef, useState } from 'react'
import { useApp } from '../../store'
import { analyzeImage } from '../../lib/medgemma'
import type { AnalysisResult, PatientInfo } from '../../types'

const patient: PatientInfo = { name: '', patientId: '', age: '', sex: '', studyDate: '', referringPhysician: '', indication: '', clinicalHistory: '' }

export function VolumeAnalysis({ image, modality, label, width, height, onResult }: { image: string; modality: string; label: string; width: number; height: number; onResult?: (result: AnalysisResult | null) => void }) {
  const settings = useApp((s) => s.settings)
  const connection = useApp((s) => s.connection)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ analysis: AnalysisResult; label: string } | null>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => { controller.current?.abort(); controller.current = null }, [])
  const run = async () => {
    if (controller.current) return
    const request = new AbortController()
    controller.current = request
    setError(''); setProgress('Reviewing selected slice…'); setResult(null); onResult?.(null)
    try {
      const analysis = await analyzeImage({ settings, patient, signal: request.signal,
        image: { id: crypto.randomUUID(), name: label, mime: 'image/png', dataUrl: image, width, height, addedAt: Date.now(), status: 'idle', sourceModality: modality === 'MRI' ? 'MR' : modality },
        onProgress: (text) => { if (controller.current === request) setProgress(text) },
      })
      if (controller.current === request && !request.signal.aborted) { setResult({ analysis, label }); onResult?.(analysis) }
    } catch (reason) {
      if (controller.current === request && !request.signal.aborted) setError(reason instanceof Error ? reason.message : 'Analysis failed. Try again.')
    } finally {
      if (controller.current === request) { controller.current = null; setProgress('') }
    }
  }
  return <section className="volume-analysis" aria-label="Slice abnormality detection">
    <div className="volume-analysis-heading"><h3>Single-slice analysis</h3><button className="btn btn-primary btn-sm" disabled={!!progress || connection !== 'online'} onClick={() => void run()}>Analyze slice</button></div>
    <p>{label} · Selected slice only</p>
    {progress && <div><p role="status">{progress}</p><button className="btn btn-sm" onClick={() => { controller.current?.abort(); controller.current = null; setProgress('') }}>Cancel analysis</button></div>}
    {connection !== 'online' && <button className="btn btn-sm" onClick={() => useApp.getState().openSheet('settings')}>Connect model</button>}
    {error && <p role="alert">{error}</p>}
    {result && <div className="volume-analysis-result" aria-live="polite">
      <strong>Results: {result.label}</strong>
      {result.label !== label && <p>These results are for a different slice or window. Analyze the current slice to update.</p>}
      <p>{result.analysis.impression}</p>
      {result.analysis.truncated && <p>Output was cut off; findings may be incomplete.</p>}
      {result.analysis.findings.length ? result.analysis.findings.map((finding) => <article key={finding.id}><strong>{finding.title}</strong><p>{finding.description}</p><p>{finding.location} · {finding.severity}</p>{finding.severity !== 'normal' && !finding.bbox && <p>No location coordinates returned; no box available.</p>}</article>) : <p>No abnormality reported on this slice. This does not assess the rest of the scan.</p>}
      <p>{result.analysis.model} · {(result.analysis.durationMs / 1000).toFixed(1)} s</p>
    </div>}
  </section>
}
