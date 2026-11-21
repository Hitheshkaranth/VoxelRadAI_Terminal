import { ScanButton } from './ScanButton'
import { useEffect, useRef, useState } from 'react'
import { uid, useApp } from '../../store'
import { analyzeImage, isSkandaModel } from '../../lib/medgemma'
import type { SkandaSliceInput } from '../../lib/skandaSlice'
import type { AnalysisResult, PatientInfo } from '../../types'

const patient: PatientInfo = { name: '', patientId: '', age: '', sex: '', studyDate: '', referringPhysician: '', indication: '', clinicalHistory: '' }

export function VolumeAnalysis({ image, modality, label, width, height, onResult, validate, skandaInput, seriesInput, currentIndex, onJump }: { image: string; modality: string; label: string; width: number; height: number; onResult?: (result: AnalysisResult | null) => void; validate?: (result: AnalysisResult) => AnalysisResult; skandaInput?: () => { input: SkandaSliceInput | null; reason?: string }
  /** Skanda-V2 CT: the whole axial series to send with the slice (the server reads the series, findings carry sliceIndex). */
  seriesInput?: () => Promise<NonNullable<SkandaSliceInput['extension']['series']>>; currentIndex?: number; onJump?: (index: number) => void }) {
  const [notice, setNotice] = useState('')
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
    setError(''); setNotice(''); setProgress('Reviewing selected slice…'); setResult(null); onResult?.(null)
    try {
      let skanda: SkandaSliceInput | undefined
      if (isSkandaModel(settings.model)) {
        const built = skandaInput?.() ?? { input: null, reason: 'Skanda needs the volume data for this slice.' }
        if (!built.input) throw new Error(built.reason ?? 'Skanda cannot read this slice.')
        skanda = built.input
      }
      const ask = (sk: SkandaSliceInput | undefined) => analyzeImage({ settings, patient, signal: request.signal, skanda: sk,
        image: { id: uid(), name: label, mime: 'image/png', dataUrl: image, width, height, addedAt: Date.now(), status: 'idle', sourceModality: modality === 'MRI' ? 'MR' : modality },
        onProgress: (text) => { if (controller.current === request) setProgress(text) },
      })
      let raw: AnalysisResult
      if (skanda && seriesInput) {
        try {
          setProgress('Reading the whole series…')
          const series = await seriesInput()
          raw = await ask({ ...skanda, extension: { ...skanda.extension, series } })
          setNotice('Read as one whole series; findings on other slices can be opened below.')
        } catch (reason) {
          if (request.signal.aborted) throw reason
          setNotice(`Whole-series read failed (${reason instanceof Error ? reason.message : 'unknown error'}); this slice was read on its own.`)
          raw = await ask(skanda)
        }
      } else raw = await ask(skanda)
      const analysis = validate ? validate(raw) : raw
      if (controller.current === request && !request.signal.aborted) { setResult({ analysis, label }); onResult?.(analysis) }
    } catch (reason) {
      if (controller.current === request && !request.signal.aborted) setError(reason instanceof Error ? reason.message : 'Analysis failed. Try again.')
    } finally {
      if (controller.current === request) { controller.current = null; setProgress('') }
    }
  }
  return <section className="volume-analysis" aria-label="Slice abnormality detection">
    <div className="volume-analysis-heading"><h3>Single-slice analysis</h3><ScanButton className="btn btn-primary btn-sm" disabled={!!progress || connection !== 'online'} onClick={() => void run()}>Analyze slice</ScanButton></div>
    <p>{label} · Selected slice only</p>
    {progress && <div><p role="status">{progress}</p><ScanButton className="btn btn-sm" onClick={() => { controller.current?.abort(); controller.current = null; setProgress('') }}>Cancel analysis</ScanButton></div>}
    {connection !== 'online' && <ScanButton className="btn btn-sm" onClick={() => useApp.getState().openSheet('settings')}>Connect model</ScanButton>}
    {error && <p role="alert">{error}</p>}
    {notice && <p className="volume-review-note">{notice}</p>}
    {result && <div className="volume-analysis-result" aria-live="polite">
      <strong>Results: {result.label}</strong>
      {result.label !== label && <p>These results are for a different slice or window. Analyze the current slice to update.</p>}
      <p>{result.analysis.impression}</p>
      {result.analysis.truncated && <p>Output was cut off; findings may be incomplete.</p>}
      {result.analysis.findings.length ? result.analysis.findings.map((finding) => <article key={finding.id}><strong>{finding.title}</strong><p>{finding.description}</p>{!!finding.validationIssues?.length && <p className="volume-review-note">Unverified model claim — overlay withheld. {finding.validationIssues.join(" ")}</p>}<p>{finding.location} · {finding.severity}</p>{typeof finding.sliceIndex === 'number' && finding.sliceIndex !== currentIndex && <ScanButton className="btn btn-sm" onClick={() => onJump?.(finding.sliceIndex!)}>Go to slice {finding.sliceIndex + 1}</ScanButton>}{finding.severity !== 'normal' && !finding.bbox && <p>No location coordinates returned; no box available.</p>}</article>) : <p>No abnormality reported on this slice. This does not assess the rest of the scan.</p>}
      <p>{result.analysis.model} · {(result.analysis.durationMs / 1000).toFixed(1)} s</p>
    </div>}
  </section>
}
