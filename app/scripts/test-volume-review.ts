import assert from 'node:assert/strict'
import { buildVolumeDraft, nextPendingFinding, validateFindingGroup, reviewedVolumeReads, volumeFindingRows, volumeReportSourceKey, type ReviewableVolume } from '../src/lib/volumeReview.ts'
import type { AnalysisResult } from '../src/types.ts'
const finding = { id:'a',title:'Fixture finding',description:'Original evidence',severity:'minor' as const,confidence:.5,location:'Test region' }
const analysis = { findings:[finding],createdAt:1,impression:'Fixture',truncated:false } as AnalysisResult
const job:ReviewableVolume = {id:'job1',title:'Test CT',modality:'CT',plane:'axial',count:2,snapshot:{model:'model',center:40,width:100},reads:[{index:0,analysis}]}
assert.equal(volumeFindingRows(job)[0].decision,'pending')
assert.match(buildVolumeDraft(job),/INCOMPLETE COVERAGE/)
assert.doesNotMatch(buildVolumeDraft(job),/Slice 1: Fixture finding/)
const edited={...job,reviews:{'0:a':{decision:'accepted' as const,description:'Corrected evidence',updatedAt:2}}}
assert.equal(volumeFindingRows(edited)[0].description,'Corrected evidence')
assert.equal(reviewedVolumeReads(edited)[0].analysis!.findings[0].description,'Corrected evidence')
assert.equal(job.reads[0].analysis!.findings[0].description,'Original evidence')
assert.match(buildVolumeDraft(edited),/Slice 1: Fixture finding. Corrected evidence/)
assert.notEqual(volumeReportSourceKey(job),volumeReportSourceKey(edited))
const rejected={...edited,reviews:{'0:a':{decision:'dismissed' as const,updatedAt:3}}}
assert.equal(reviewedVolumeReads(rejected)[0].analysis!.findings[0].review,'dismissed')
assert.doesNotMatch(buildVolumeDraft(rejected),/Slice 1: Fixture finding/)
const truncated={...edited,reads:[{index:0,analysis:{...analysis,truncated:true}}]}
assert.doesNotMatch(buildVolumeDraft(truncated),/Slice 1: Fixture finding/)
assert.notEqual(volumeReportSourceKey(edited),volumeReportSourceKey({...edited,reads:[...edited.reads,{index:1,analysis:{...analysis,findings:[]}}]}))
assert.equal(volumeReportSourceKey(edited),volumeReportSourceKey({...edited,draftReport:{text:'manual edit',sourceKey:'a',updatedAt:5}}))
console.log('Volume finding review and report: 13 checks passed')

const multi:ReviewableVolume={...job,count:3,reads:[{index:0,analysis},{index:1,analysis},{index:2,analysis}]}
const queue=volumeFindingRows(multi)
assert.equal(nextPendingFinding(queue,null)?.key,'0:a')
assert.equal(nextPendingFinding(queue,'0:a')?.key,'1:a')
assert.equal(nextPendingFinding(queue,'2:a')?.key,'0:a')
assert.equal(nextPendingFinding(queue,'0:a',-1)?.key,'2:a')
assert.equal(nextPendingFinding([],null),undefined)
assert.equal(nextPendingFinding(volumeFindingRows(job),'0:a'),undefined)
assert.equal(nextPendingFinding(volumeFindingRows({...multi,reviews:{'1:a':{decision:'accepted',updatedAt:1}}}),'0:a')?.key,'2:a')
assert.deepEqual(validateFindingGroup(multi,' Related observations ',['0:a','1:a','0:a']),{label:'Related observations',members:['0:a','1:a']})
assert.throws(()=>validateFindingGroup(multi,'', ['0:a','1:a']),/name/)
assert.throws(()=>validateFindingGroup(multi,'Test', ['0:a']),/two slices/)
assert.throws(()=>validateFindingGroup(multi,'Test', ['0:a','missing']),/no longer available/)
const grouped={...multi,findingGroups:[{id:'group',label:'Test',members:['0:a','1:a'],createdAt:1}]}
assert.throws(()=>validateFindingGroup(grouped,'Second', ['1:a','2:a']),/already belongs/)
assert.notEqual(volumeReportSourceKey(multi),volumeReportSourceKey(grouped))
assert.deepEqual(volumeFindingRows(grouped),volumeFindingRows(multi))
console.log('Guided queue and manual grouping: 14 checks passed')
