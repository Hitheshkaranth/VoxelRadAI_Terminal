import { ScanButton } from './ScanButton'
import { useState } from 'react'
import type { Volume, VolumePlane } from '../../lib/volume'
import { saveVolumeDraft } from '../../lib/volumeJobs'
import { volumeCoverage } from '../../lib/volumeAnalysis'
import { buildVolumeDraft, volumeFindingRows, volumeReportSourceKey } from '../../lib/volumeReview'
import { useVolumeReview } from './useVolumeReview'
import './volumeReview.css'
import './volumeReport.css'

export function VolumeReportPanel({volume,modality,onNavigateEvidence}:{volume:Volume;modality:string;onNavigateEvidence?:(plane:VolumePlane,index:number,window:{center:number;width:number})=>void}) {
  const {identity,job,loading,error:loadError}=useVolumeReview(volume,modality)
  const [edit,setEdit]=useState<{text:string;sourceKey:string}|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false)
  if(loading)return <section className="volume-review-panel"><p role="status">Loading draft…</p></section>
  if(loadError)return <section className="volume-review-panel"><p role="alert">{loadError}</p></section>
  if(!job)return <section className="volume-review-panel"><h2>Report</h2><p>No volume analysis yet. Analyze the scan and review findings before creating a draft.</p></section>
  const text=edit?.text??job.draftReport?.text??'', sourceKey=edit?.sourceKey??job.draftReport?.sourceKey??''
  const currentKey=volumeReportSourceKey(job), stale=!!text&&sourceKey!==currentKey
  const coverage=volumeCoverage(job.reads,job.count), pending=volumeFindingRows(job).filter(r=>r.decision==='pending').length
  const accepted=volumeFindingRows(job).filter(row=>row.decision==='accepted'&&!row.incomplete&&!row.blocked)
  const reviewed=!!job.draftReport?.reviewedAt&&!stale&&!edit
  const save=async(nextText:string,key:string,markReviewed=false)=>{
    setBusy(true);setError('')
    try{await saveVolumeDraft(identity,job.id,nextText,key,markReviewed);setEdit(null);setConfirmed(false)}catch(e){setError(e instanceof Error?e.message:'Could not save draft')}finally{setBusy(false)}
  }
  const generate=()=>{
    if(text&&!window.confirm('Replace this draft with the current accepted findings? Unsaved report edits will be replaced.'))return
    void save(buildVolumeDraft(job),currentKey)
  }
  const download=()=>{
    const blob=new Blob([text],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a')
    a.href=url;a.download='voxelrad-volume-draft.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  return <section className="volume-review-panel" aria-label="Volume draft report">
    <h2>Draft report</h2><p>{reviewed?'Reviewed draft · Not signed':'Draft · Not signed'} · {coverage.completed}/{job.count} slices analyzed</p>

    {!coverage.complete&&<p className="volume-review-note">Incomplete coverage. The draft will identify unreviewed slices.</p>}
    {pending>0&&<p>{pending} findings still await acceptance or rejection.</p>}
    <ScanButton className="btn btn-sm" disabled={busy||!job.reads.length} onClick={generate}>{text?'Regenerate from accepted findings':'Create draft from accepted findings'}</ScanButton>
    {stale&&<p role="status" className="volume-review-note">Findings or coverage changed after this draft. Regenerate and review the updated draft.</p>}
    {accepted.length>0&&<details className="volume-report-evidence" open>
      <summary>Accepted evidence ({accepted.length})</summary>
      <ul>{accepted.map(row=><li key={row.key}>
        <div><strong>{row.finding.title}</strong><p>{row.description}</p>{job.findingGroups?.filter(group=>group.members.includes(row.key)).map(group=><small key={group.id}>Reviewer group: {group.label}</small>)}</div>
        {onNavigateEvidence?<ScanButton className="btn btn-sm" aria-label={`View source: ${row.finding.title}, ${job.plane} slice ${row.index+1}`} onClick={()=>onNavigateEvidence(job.plane,row.index,job.snapshot)}>{job.plane} · {row.index+1}/{job.count}</ScanButton>:<span>{job.plane} · Slice {row.index+1}</span>}
      </li>)}</ul>
      {stale&&<p>Current accepted evidence may differ from the saved draft.</p>}
    </details>}
    {text&&<><label className="volume-report-editor">Report text<textarea aria-label="Volume draft report text" value={text} onChange={e=>{setEdit({text:e.target.value,sourceKey});setConfirmed(false)}}/></label><div className="volume-review-actions"><ScanButton className="btn btn-sm" disabled={busy||!edit||!text.trim()} onClick={()=>void save(text,sourceKey)}>Save report edits</ScanButton><ScanButton className="btn btn-sm" onClick={download}>Download draft</ScanButton></div>
    {!reviewed&&<><label className="volume-report-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={!coverage.complete||pending>0||stale||busy}/> I reviewed the source images and this draft.</label><ScanButton className="btn btn-sm" disabled={!confirmed||busy||!coverage.complete||pending>0||stale||!text.trim()} onClick={()=>void save(text,sourceKey,true)}>Mark draft reviewed</ScanButton></>}</>}
    {error&&<p role="alert">{error}</p>}{job.storageError&&<p role="alert">{job.storageError}</p>}
  </section>
}
