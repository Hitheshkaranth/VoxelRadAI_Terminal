import assert from 'node:assert/strict'
import { findingIssues, validateVolumeAnalysis } from '../src/lib/volumeValidation.ts'
import { reviewedVolumeReads, buildVolumeDraft } from '../src/lib/volumeReview.ts'
import { decodeNrrd } from '../src/lib/volume.ts'
import type { AnalysisResult, Finding } from '../src/types.ts'
import { readFile } from 'node:fs/promises'
const f={id:'test',title:'Observation',description:'Visible focus',location:'image center',severity:'minor',bbox:{x:.1,y:.1,w:.2,h:.2}} as Finding
const black=new Uint8ClampedArray(10*10*4), bright=black.map(()=>255)
assert.match(findingIssues(f,black,10,10).join(' '),/background/)
assert.equal(findingIssues(f,bright,10,10).length,0)
const enclosed=bright.slice();for(let y=1;y<4;y++)for(let x=1;x<4;x++)enclosed.fill(0,(y*10+x)*4,(y*10+x)*4+3)
assert.equal(findingIssues(f,enclosed,10,10).length,0,'Enclosed dark anatomy must not be treated as exterior background')
for(const description of ['Lesion measures 13 mm','Involving 10 slices (37 mm)','Hyperintense on T1-weighted imaging'])assert.ok(findingIssues({...f,description},bright,10,10).length)
assert.ok(findingIssues({...f,title:'Normal midline structures'},bright,10,10).length)
const bytes=await readFile(new URL('../public/samples/mr-head.nrrd',import.meta.url));const v=await decodeNrrd(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))
const result=validateVolumeAnalysis(v,'sagittal',4,{center:139.5,width:279},{findings:[{...f,bbox:{x:.385,y:.416,w:.064,h:.054}}]} as AnalysisResult)
assert.match(result.findings[0].validationIssues!.join(' '),/background/)
assert.ok(result.findings[0].bbox,'Raw box retained for audit')
assert.match(result.findings[0].validationIssues!.join(' '),/Limited visible context/)
const job={id:'j',title:'MRI',modality:'MRI',plane:'sagittal',count:130,snapshot:{model:'test',center:139.5,width:279},reads:[{index:4,analysis:result}],reviews:{'4:test':{decision:'accepted' as const,updatedAt:0}}}
assert.equal(reviewedVolumeReads(job)[0].analysis!.findings[0].bbox,undefined)
assert.ok(!buildVolumeDraft(job).includes('Slice 5: Observation'))
console.log('Source-consistency validation: 12 checks passed (including real MRI background and report exclusion)')
