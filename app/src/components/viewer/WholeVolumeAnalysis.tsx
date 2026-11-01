import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../store'
import { getSliceGeometry, type Volume, type VolumePlane } from '../../lib/volume'
import { reviewedVolumeReads } from '../../lib/volumeReview'
import { volumeCoverage, type SliceRead } from '../../lib/volumeAnalysis'
import { volumeFingerprint } from '../../lib/volumeJobIdentity'
import { loadVolumeJob, pauseVolumeJob, startVolumeJob, subscribeVolumeJob, type VolumeJob } from '../../lib/volumeJobs'

const planes: VolumePlane[] = ['axial', 'coronal', 'sagittal']
const EMPTY_READS: SliceRead[] = []
const duration = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)} h ${Math.floor(seconds % 3600 / 60)} min` : seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`
}
export function WholeVolumeAnalysis({ volume, modality, title, center, width, onNavigate, onReads }: {
  volume: Volume; modality: string; title: string; center: number; width: number
  onReads: (reads: SliceRead[], plane: VolumePlane) => void
  onNavigate: (plane: VolumePlane, index: number, window: { center: number; width: number }) => void
}) {
  const settings = useApp((s) => s.settings)
  const connection = useApp((s) => s.connection)
  const plane = useMemo(() => planes.find((p) => getSliceGeometry(volume, p).axis === 2)!, [volume])
  const count = volume.dimensions[2]
  const [identity, setIdentity] = useState('')
  const [job, setJob] = useState<VolumeJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let active = true, unsubscribe: (() => void) | undefined
    void (async () => {
      try {
        const id = `${await volumeFingerprint(volume)}:${modality.toUpperCase()}`
        const restored = await loadVolumeJob(id)
        if (!active) return
        setIdentity(id); setJob(restored); setLoading(false)
        unsubscribe = subscribeVolumeJob(id, setJob)
      } catch {
        if (active) { setLoading(false); setLoadError('Could not restore saved review data. Reload this page before starting another review.') }
      }
    })()
    // A running job lives outside this component and continues through in-app navigation.
    return () => { active = false; unsubscribe?.() }
  }, [volume, modality])
  const reads = job?.reads ?? EMPTY_READS
  const running = job?.status === 'running'
  const snapshot = job?.snapshot
  const reviews = job?.reviews
  const displayReads = useMemo(() => reviewedVolumeReads({ reads, reviews }), [reads, reviews])
  useEffect(() => { onReads(displayReads, plane) }, [displayReads, plane, onReads])
  useEffect(() => {
    if (!running) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [running])
  const coverage = volumeCoverage(reads, count)
  const changed = !!snapshot && (snapshot.center !== center || snapshot.width !== width || snapshot.model !== settings.model || snapshot.settings.baseUrl !== settings.baseUrl)
  const elapsed = (job?.elapsedMs ?? 0) + (running ? Math.max(0, now - (job?.runStartedAt ?? now)) : 0)
  const durations = reads.filter((r) => r.analysis && !r.analysis.truncated && r.analysis.durationMs > 0).map((r) => r.analysis!.durationMs)
  const estimatedRemaining = durations.length >= 2 ? durations.slice(-5).reduce((sum, ms) => sum + ms, 0) / Math.min(5, durations.length) * (count - coverage.completed) : null
  const run = (restart = false) => {
    if (!identity || running) return
    void startVolumeJob({ identity, volume, title, modality, settings, center, width, restart })
  }
  const status = loading ? 'Restoring saved review…' : !job ? 'Not analyzed' : running ? 'Analysis running' : coverage.complete ? 'Analysis complete' : job.status === 'error' ? 'Analysis stopped' : 'Analysis paused'
  return <section className="volume-analysis" aria-label="Whole volume analysis">
    <div className="volume-analysis-heading"><h3>Volume analysis</h3><button className="btn btn-primary btn-sm" disabled={loading || !!loadError || running || connection !== 'online' || coverage.complete} onClick={() => run()}>{loading ? 'Restoring…' : coverage.complete ? 'Analysis complete' : running ? 'Analyzing…' : job ? 'Resume analysis' : 'Analyze volume'}</button></div>
    <p role="status"><strong>{status}</strong>{job ? ` · ${coverage.completed}/${count} slices analyzed` : ''}</p>
    {job && <progress aria-label="Volume analysis coverage" max={count} value={coverage.completed} style={{ width: '100%', accentColor: 'var(--accent)' }} />}
    {job && !coverage.complete && <p className="volume-review-note">Incomplete coverage: {count - coverage.completed} slices still need a complete response.</p>}
    {running && <><p>Elapsed {duration(elapsed)}{estimatedRemaining !== null ? ` · About ${duration(estimatedRemaining)} remaining, based on recent slices` : ' · Estimating remaining time after two slices'}</p><button className="btn btn-sm" onClick={() => pauseVolumeJob(identity)}>Pause analysis</button></>}
    {!running && job && <p>Elapsed {duration(elapsed)} · {coverage.complete ? 'Review findings before clinical use.' : 'Resume retries failed or incomplete slices.'}</p>}
    <details className="volume-analysis-method"><summary>Analysis scope &amp; storage</summary>
      <p>{count} acquired {plane} slices, analyzed independently at W {snapshot?.width ?? width} / L {snapshot?.center ?? center}. One window and one series; no combined 3D model interpretation.</p>
      <p>{snapshot?.model || settings.model} · Results are saved in this browser. Analysis continues during in-app navigation; closing or refreshing pauses it at the last saved slice.</p>
    </details>
    {connection !== 'online' && !running && <button className="btn btn-sm" onClick={() => useApp.getState().openSheet('settings')}>Connect model</button>}
    {loadError && <p role="alert">{loadError}</p>}
    {job?.error && <p role="alert">{job.error}</p>}
    {job?.storageError && <p role="alert">{job.storageError}</p>}
    {changed && <p>View or model changed. Resume keeps the original model, endpoint and window. Restart uses current settings.</p>}
    {!running && job && <button className="btn btn-sm" onClick={() => { if (window.confirm('Start a new review of every slice with the current settings? The previous saved review will be retained in browser storage.')) run(true) }} disabled={connection !== 'online'}>Restart volume analysis</button>}
    {reads.length > 0 && <div className="volume-analysis-result">
      <details><summary>Raw slice results ({reads.length})</summary>{reads.map((r) => <article key={r.index}>
        <button className="btn btn-sm" onClick={() => onNavigate(plane, r.index, snapshot!)}>View {plane} slice {r.index + 1}</button>
        {r.error ? <p role="alert">{r.error}</p> : <p>{r.analysis?.impression || 'No impression returned'}</p>}
        {r.analysis?.truncated && <p>Incomplete response. Resume analysis to retry this slice.</p>}
      </article>)}</details>
    </div>}
  </section>
}
