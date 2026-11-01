import assert from 'node:assert/strict'
import { reviewAllSlices, volumeCoverage, type SliceRead } from '../src/lib/volumeAnalysis.ts'
import type { AnalysisResult } from '../src/types.ts'
const result = { findings: [], truncated: false } as unknown as AnalysisResult
let reads: SliceRead[] = [], visited: number[] = []
const controller = new AbortController()
await reviewAllSlices({ count: 76, signal: controller.signal, read: async (i) => { visited.push(i); return result }, onSlice: r => reads.push(r) })
assert.deepEqual(visited, Array.from({length:76}, (_,i)=>i))
assert.deepEqual(volumeCoverage(reads,76), { completed:76,total:76,complete:true })
assert.equal(volumeCoverage([...reads,reads[0]],76).completed,76)
assert.equal(volumeCoverage(reads,77).complete,false)
reads=[]; visited=[]
const cancelled=new AbortController()
await reviewAllSlices({ count:4, signal:cancelled.signal, read:async(i)=>{visited.push(i);if(i===1)cancelled.abort();return result},onSlice:r=>reads.push(r) })
assert.deepEqual(visited,[0,1]);assert.deepEqual(reads.map(r=>r.index),[0])
visited=[]
await reviewAllSlices({count:4,previous:reads,signal:controller.signal,read:async(i)=>{visited.push(i);return result},onSlice:r=>reads.push(r)})
assert.deepEqual(visited,[1,2,3]);assert.equal(volumeCoverage(reads,4).complete,true)
reads=[];visited=[]
await reviewAllSlices({count:4,signal:controller.signal,read:async(i)=>{visited.push(i);throw new Error('offline')},onSlice:r=>reads.push(r)})
assert.deepEqual(visited,[0]);assert.equal(reads[0].error,'offline');assert.equal(volumeCoverage(reads,4).completed,0)
reads=[{index:0,analysis:{...result,truncated:true}},{index:1,analysis:result}];visited=[]
await reviewAllSlices({count:2,previous:reads,signal:controller.signal,read:async(i)=>{visited.push(i);return result},onSlice:()=>{}})
assert.deepEqual(visited,[0]);assert.equal(volumeCoverage(reads,2).complete,false)
visited=[]
await assert.rejects(reviewAllSlices({count:3,signal:controller.signal,read:async(i)=>{visited.push(i);return result},onSlice:async()=>{throw new Error('checkpoint failed')}}),/checkpoint failed/)
assert.deepEqual(visited,[0])
console.log('Whole-volume coverage, cancellation, resume, failures, truncation and checkpoint ordering: 15 checks passed')
let attempts=0
reads=[]
await reviewAllSlices({count:1,retries:2,retryDelayMs:0,signal:controller.signal,read:async()=>{if(++attempts<3)throw new Error('network error');return result},onSlice:r=>reads.push(r)})
assert.equal(attempts,3);assert.equal(volumeCoverage(reads,1).completed,1)
attempts=0
await reviewAllSlices({count:1,retries:2,retryDelayMs:0,signal:controller.signal,read:async()=>{attempts++;throw new Error('invalid model configuration')},onSlice:()=>{}})
assert.equal(attempts,1)
attempts=0;reads=[]
await reviewAllSlices({count:2,retries:2,retryDelayMs:0,signal:controller.signal,read:async()=>{attempts++;throw new Error('network error')},onSlice:r=>reads.push(r)})
assert.equal(attempts,3);assert.equal(reads.length,1);assert.equal(reads[0].error,'network error')
const retryCancel=new AbortController();attempts=0;reads=[]
await reviewAllSlices({count:1,retries:2,retryDelayMs:0,signal:retryCancel.signal,onRetry:()=>retryCancel.abort(),read:async()=>{attempts++;throw new Error('network error')},onSlice:r=>reads.push(r)})
assert.equal(attempts,1);assert.equal(reads.length,0)
console.log('Bounded transient retries and cancellation: 8 checks passed')
