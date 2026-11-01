import { useEffect, useState } from 'react'
import type { Volume } from '../../lib/volume'
import { volumeFingerprint } from '../../lib/volumeJobIdentity'
import { auditVolumeJob, subscribeVolumeJob, type VolumeJob } from '../../lib/volumeJobs'

export function useVolumeReview(volume: Volume, modality: string) {
  const [state,setState] = useState<{ volume: Volume; identity: string; job: VolumeJob | null; error: string } | null>(null)
  useEffect(() => {
    let active=true, unsubscribe: (()=>void) | undefined
    void (async()=>{
      try {
        const identity=`${await volumeFingerprint(volume)}:${modality.toUpperCase()}`
        const job=await auditVolumeJob(identity,volume)
        if(!active)return
        setState({volume,identity,job,error:''})
        unsubscribe=subscribeVolumeJob(identity,(updated)=>{ if(active)setState({volume,identity,job:updated,error:''}) })
      } catch { if(active)setState({volume,identity:'',job:null,error:'Could not load saved review. Reload and try again.'}) }
    })()
    return ()=>{active=false;unsubscribe?.()}
  },[volume,modality])
  return state?.volume===volume ? {...state,loading:false} : {identity:'',job:null,error:'',loading:true}
}
