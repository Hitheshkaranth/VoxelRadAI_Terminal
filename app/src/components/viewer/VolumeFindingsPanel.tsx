import { ScanButton } from './ScanButton'
import { useEffect, useRef, useState } from 'react'
import type { Volume, VolumePlane } from '../../lib/volume'
import { createVolumeFindingGroup, removeVolumeFindingGroup, updateVolumeFinding, type VolumeJob } from '../../lib/volumeJobs'
import { volumeCoverage } from '../../lib/volumeAnalysis'
import { nextPendingFinding, volumeFindingRows } from '../../lib/volumeReview'
import { useVolumeReview } from './useVolumeReview'
import './volumeReview.css'

type Navigate = (plane: VolumePlane,index: number,window: {center:number;width:number})=>void
type FindingSelection = {plane:VolumePlane;index:number;window:{center:number;width:number};findingId:string}
type Props = {volume:Volume;modality:string;onNavigate:Navigate;onSelectFinding?:(selection:FindingSelection)=>void;keyboardEnabled?:boolean}
export function VolumeFindingsPanel({volume,modality,onNavigate,onSelectFinding,keyboardEnabled=true}: Props) {
  const {identity,job,loading,error}=useVolumeReview(volume,modality)
  if(loading)return <section className="volume-review-panel"><p role="status">Loading findings…</p></section>
  if(error)return <section className="volume-review-panel"><p role="alert">{error}</p></section>
  if(!job)return <section className="volume-review-panel"><h2>Findings</h2><p>Not analyzed. Use Analyze volume above. Findings will appear here as slices complete.</p></section>
  return <FindingQueue key={job.id} identity={identity} job={job} onNavigate={onNavigate} onSelectFinding={onSelectFinding} keyboardEnabled={keyboardEnabled}/>
}
function FindingQueue({identity,job,onNavigate,onSelectFinding,keyboardEnabled}:{identity:string;job:VolumeJob;onNavigate:Navigate;onSelectFinding?:Props['onSelectFinding'];keyboardEnabled:boolean}) {
  const [filter,setFilter]=useState<'all'|'pending'|'accepted'|'dismissed'>('all')
  const [selected,setSelected]=useState<string|null>(null),[opened,setOpened]=useState<string|null>(null)
  const [members,setMembers]=useState<string[]>([]),[label,setLabel]=useState(''),[grouping,setGrouping]=useState(false)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[announcement,setAnnouncement]=useState('')
  const lock=useRef(false),panel=useRef<HTMLElement>(null)
  const rows=volumeFindingRows(job),coverage=volumeCoverage(job.reads,job.count)
  const active=rows.find(row=>row.key===selected)??rows.find(row=>row.decision==='pending')??rows[0]
  const pending=rows.filter(row=>row.decision==='pending')
  const shown=rows.filter(row=>filter==='all'||row.decision===filter)
  const open=(row:typeof active)=>{
    if(!row)return
    setSelected(row.key);setOpened(row.key)
    if(onSelectFinding)onSelectFinding({plane:job.plane,index:row.index,window:job.snapshot,findingId:row.finding.id})
    else onNavigate(job.plane,row.index,job.snapshot)
  }
  const move=(direction:1|-1)=>{const next=nextPendingFinding(rows,active?.key??null,direction);if(next)open(next)}
  const decide=async(decision:'accepted'|'dismissed')=>{
    if(!active||active.decision!=='pending'||opened!==active.key||lock.current||(decision==='accepted'&&(active.incomplete||active.blocked)))return
    lock.current=true;setBusy(true);setError('')
    try {
      await updateVolumeFinding(identity,job.id,active.index,active.finding.id,{decision})
      const next=nextPendingFinding(rows,active.key)
      setAnnouncement(`${active.finding.title} ${decision==='accepted'?'accepted':'rejected'}.${next?' Next pending finding opened.':' No pending findings remain.'}`)
      if(next)open(next)
      else setOpened(null)
    } catch(e){setError(e instanceof Error?e.message:'Could not save review')}finally{lock.current=false;setBusy(false)}
  }
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(!keyboardEnabled||lock.current||event.repeat||event.metaKey||event.ctrlKey||event.altKey||!panel.current?.getClientRects().length)return
      const target=event.target as HTMLElement|null
      if(target?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]'))return
      const key=event.key.toLowerCase()
      if(!['a','r','j','k'].includes(key)||!active)return
      if((key==='a'||key==='r')&&opened!==active.key)return
      event.preventDefault()
      if(key==='j'||key==='k')move(key==='j'?1:-1)
      else void decide(key==='a'?'accepted':'dismissed')
    }
    window.addEventListener('keydown',handler)
    return ()=>window.removeEventListener('keydown',handler)
  })
  const mutateGroup=async(action:()=>Promise<void>)=>{
    if(lock.current)return
    lock.current=true;setBusy(true);setError('')
    try{await action();setMembers([]);setLabel('')}catch(e){setError(e instanceof Error?e.message:'Could not save group')}finally{lock.current=false;setBusy(false)}
  }
  return <section ref={panel} className="volume-review-panel" aria-label="Volume findings review">
    <h2>Findings</h2><p>AI candidates require source-image verification. Automated checks cannot confirm a lesion.</p><p>{coverage.completed}/{job.count} slices analyzed · {pending.length} findings awaiting review</p>
    {!coverage.complete&&<p className="volume-review-note">Coverage incomplete. Unreviewed slices have no result.</p>}
    <p role="status" className="review-announcement">{announcement}</p>
    {active&&<div className="volume-guided-review" aria-label="Guided finding review">
      <div className="volume-review-finding-head"><h3>{active.finding.title}</h3><span>Slice {active.index+1} · {active.decision==='dismissed'?'Rejected':active.decision}</span></div>
      <p>{active.description}</p>{active.blocked&&<p className="volume-review-note">Unverified model claim — withheld from overlays and reports. {active.finding.validationIssues?.join(" ")}</p>}
      {active.incomplete&&<p className="volume-review-note">Incomplete response: retry this slice before acceptance.</p>}
      <div className="volume-review-actions"><ScanButton className="btn btn-sm" disabled={busy} onClick={()=>open(active)}>Open finding</ScanButton><ScanButton className="btn btn-sm" disabled={busy||!nextPendingFinding(rows,active.key,-1)} onClick={()=>move(-1)}>Previous pending (K)</ScanButton><ScanButton className="btn btn-sm" disabled={busy||!nextPendingFinding(rows,active.key)} onClick={()=>move(1)}>Next pending (J)</ScanButton></div>
      <div className="volume-review-actions"><ScanButton className="btn btn-sm" disabled={busy||opened!==active.key||active.incomplete||active.blocked||active.decision!=='pending'} onClick={()=>void decide('accepted')}>Accept & next (A)</ScanButton><ScanButton className="btn btn-sm" disabled={busy||opened!==active.key||active.decision!=='pending'} onClick={()=>void decide('dismissed')}>Reject & next (R)</ScanButton></div>
      {opened!==active.key&&<p>Open the finding to review its source image before deciding.</p>}
    </div>}
    <div className="volume-review-filters" role="group" aria-label="Filter volume findings">{(['all','pending','accepted','dismissed'] as const).map(value=><ScanButton key={value} className="btn btn-sm" aria-pressed={filter===value} onClick={()=>setFilter(value)}>{value==='dismissed'?'Rejected':value[0].toUpperCase()+value.slice(1)}</ScanButton>)}</div>
    {!!rows.length&&<ScanButton className="btn btn-sm" aria-pressed={grouping} onClick={()=>{setGrouping(!grouping);setMembers([])}}>{grouping?'Finish grouping':'Group observations'}</ScanButton>}
    {grouping&&<div className="volume-group-builder"><p>Select related observations on multiple slices. Grouping records your association; it does not merge lesions or accept findings.</p><label>Group name<input value={label} maxLength={120} onChange={event=>setLabel(event.target.value)} placeholder="e.g. Right lower lobe observation"/></label><ScanButton className="btn btn-sm" disabled={busy||members.length<2||!label.trim()} onClick={()=>void mutateGroup(()=>createVolumeFindingGroup(identity,job.id,label,members))}>Create group ({members.length} selected)</ScanButton></div>}
    {shown.length ? shown.map(row=><div key={`${job.id}:${row.key}`} className="volume-finding-entry" data-active={active?.key===row.key}>
      {grouping&&<label className="volume-group-select"><input type="checkbox" checked={members.includes(row.key)} disabled={busy||job.findingGroups?.some(group=>group.members.includes(row.key))} onChange={event=>setMembers(current=>event.target.checked?[...current,row.key]:current.filter(key=>key!==row.key))}/>Group {row.finding.title}, slice {row.index+1}</label>}
      <FindingReview identity={identity} job={job} row={row} onNavigate={()=>open(row)}/>
    </div>) : <p>{rows.length?'No findings match this filter.':coverage.completed?'No abnormalities reported in the analyzed slices. This is not a reviewed normal examination.':'No completed slice results yet.'}</p>}
    {!!job.findingGroups?.length&&<section className="volume-finding-groups" aria-label="Reviewer observation groups"><h3>Reviewer groups</h3><p>Separate source observations; no automatic lesion merging.</p>{job.findingGroups.map(group=><div key={group.id}><h3>{group.label}</h3><div className="volume-review-actions">{group.members.map(key=>{const row=rows.find(item=>item.key===key);return row?<ScanButton key={key} className="btn btn-sm" onClick={()=>open(row)}>{row.finding.title} · slice {row.index+1}</ScanButton>:null})}<ScanButton className="btn btn-sm" disabled={busy} onClick={()=>void mutateGroup(()=>removeVolumeFindingGroup(identity,job.id,group.id))}>Ungroup {group.label}</ScanButton></div></div>)}</section>}
    {error&&<p role="alert">{error}</p>}{job.storageError&&<p role="alert">{job.storageError}</p>}
  </section>
}
function FindingReview({identity,job,row,onNavigate}:{identity:string;job:VolumeJob;row:ReturnType<typeof volumeFindingRows>[number];onNavigate:Navigate}) {
  const [editing,setEditing]=useState(false),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const change=async(patch:Parameters<typeof updateVolumeFinding>[4])=>{
    setBusy(true);setError('')
    try{await updateVolumeFinding(identity,job.id,row.index,row.finding.id,patch);setEditing(false)}catch(e){setError(e instanceof Error?e.message:'Could not save review')}finally{setBusy(false)}
  }
  return <article className="volume-review-finding" data-decision={row.decision}>
    <div className="volume-review-finding-head"><h3>{row.finding.title}</h3><span>{row.decision==='dismissed'?'Rejected':row.decision==='accepted'?'Accepted':'Pending'}</span></div>
    <ScanButton className="btn btn-sm" onClick={()=>onNavigate(job.plane,row.index,job.snapshot)}>View {job.plane} slice {row.index+1}</ScanButton>
    <p>{row.finding.location || 'Location not described'} · {row.finding.severity}</p>
    {row.blocked&&<p className="volume-review-note">Unverified model claim — withheld from overlays and reports. {row.finding.validationIssues?.join(" ")}</p>}
    {row.incomplete&&<p className="volume-review-note">The model response was incomplete. Retry this slice before including it in a draft.</p>}
    {editing?<div><label>Description<textarea aria-label={`Edit description for ${row.finding.title}`} value={text} onChange={e=>setText(e.target.value)}/></label><div className="volume-review-actions"><ScanButton className="btn btn-sm" disabled={busy||!text.trim()} onClick={()=>void change({description:text.trim()})}>Save description</ScanButton><ScanButton className="btn btn-sm" disabled={busy} onClick={()=>setEditing(false)}>Cancel edit</ScanButton></div></div>:<p>{row.description}</p>}
    {row.edited&&<details><summary>Original model description</summary><p>{row.finding.description}</p></details>}
    <div className="volume-review-actions"><ScanButton className="btn btn-sm" aria-pressed={row.decision==='accepted'} disabled={busy||row.incomplete||row.blocked} onClick={()=>void change({decision:'accepted'})}>Accept finding</ScanButton><ScanButton className="btn btn-sm" aria-pressed={row.decision==='dismissed'} disabled={busy} onClick={()=>void change({decision:'dismissed'})}>Reject finding</ScanButton><ScanButton className="btn btn-sm" disabled={busy} onClick={()=>{setText(row.description);setEditing(true)}}>Edit description</ScanButton>{row.decision!=='pending'&&<ScanButton className="btn btn-sm" disabled={busy} onClick={()=>void change({decision:'pending'})}>Reset decision</ScanButton>}</div>
    {error&&<p role="alert">{error}</p>}
  </article>
}
