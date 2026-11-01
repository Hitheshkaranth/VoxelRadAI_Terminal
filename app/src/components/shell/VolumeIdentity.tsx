import type { VolumeSource } from '../../lib/volumeSources'
import { volumeSourceKind } from '../../lib/volumeIdentity'
import './volumeIdentity.css'

/** Never borrows identity from the previously selected radiograph study. */
export function VolumeIdentity({ source }: { source: VolumeSource }) {
  const kind = volumeSourceKind(source)
  const fields = <>
    <span className="volume-identity-kind">{kind}</span>
    <span><span className="volume-identity-label">Patient</span> Not linked</span>
    <span><span className="volume-identity-label">Exam date</span> Not provided</span>
    <span><span className="volume-identity-label">Series metadata</span> Not provided</span>
    <span className="volume-identity-source" title={source.file?.name || source.title}><span className="volume-identity-label">Source</span> {source.file?.name || source.title}</span>
  </>
  return <>
    <div className="volume-identity" aria-label="Volume identity">{fields}</div>
    <details className="volume-identity-mobile">
      <summary>Study details <span>{kind}</span></summary>
      <div aria-label="Volume identity details">{fields}</div>
    </details>
  </>
}
