import { useSyncExternalStore } from 'react'
import { getAllVolumeJobs, subscribeAllVolumeJobs, pauseVolumeJob, startVolumeJob } from '../../lib/volumeJobs'
import { volumeCoverage } from '../../lib/volumeAnalysis'
import { registeredVolumeSource } from '../../lib/volumeSourceRegistry'
import { VOLUME_SAMPLES } from '../../lib/volumeSources'
import { useShell } from './shellState'
import './volumeJobs.css'

export function VolumeJobIndicator() {
  const jobs = useSyncExternalStore(subscribeAllVolumeJobs, getAllVolumeJobs)
  if (!jobs.length) return null
  const running = jobs.filter((job) => job.status === 'running').length
  return <details className="volume-job-tray"><summary>{running ? `${running} volume analysis running` : 'Volume analysis jobs'} <span>{jobs.length}</span></summary><div className="volume-job-list" aria-label="Volume analysis jobs">
    {jobs.map((job) => {
      const coverage = volumeCoverage(job.reads, job.count), registered = registeredVolumeSource(job.identity)
      const source = registered?.source ?? VOLUME_SAMPLES.find((source) => source.title === job.title)
      return <article key={job.identity}><strong>{job.title}</strong><p>{job.status} · {coverage.completed}/{job.count} slices reviewed</p><div>
        {source && <button className="btn btn-sm" onClick={() => useShell.getState().openVolume(source)}>Return to scan</button>}
        {job.status === 'running' ? <button className="btn btn-sm" onClick={() => pauseVolumeJob(job.identity)}>Pause</button> : !coverage.complete && registered && <button className="btn btn-sm" onClick={() => void startVolumeJob({ identity: job.identity, volume: registered.volume, title: job.title, modality: job.modality, settings: job.snapshot.settings, center: job.snapshot.center, width: job.snapshot.width })}>Resume</button>}
      </div></article>
    })}
  </div></details>
}
