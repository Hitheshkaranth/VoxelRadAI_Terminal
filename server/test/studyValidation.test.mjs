import test from 'node:test'
import assert from 'node:assert/strict'
import { validStudy } from '../src/studyValidation.mjs'
const valid = {id:'31f37b3e-946a-452c-a666-a1de7c06a47b',title:'Test',createdAt:1,updatedAt:1,patient:{name:'',patientId:'',age:'',sex:'',studyDate:'',referringPhysician:'',indication:'',clinicalHistory:''},images:[]}
test('study upload rejects malformed nested payloads', () => {
  assert.equal(validStudy(valid),true)
  assert.equal(validStudy({...valid,patient:null}),false)
  assert.equal(validStudy({...valid,images:[{id:'x'}]}),false)
  assert.equal(validStudy({...valid,report:{signed:true}}),false)
  const image={id:'x',name:'x.png',mime:'image/png',dataUrl:'data:image/png;base64,AAAA',status:'idle',width:10,height:10,addedAt:1}
  assert.equal(validStudy({...valid,images:[image]}),true)
  assert.equal(validStudy({...valid,images:[{...image,dataUrl:'https://tracker.invalid'}]}),false)
  assert.equal(validStudy({...valid,images:[{...image,analysis:{findings:null}}]}),false)
  assert.equal(validStudy({...valid,images:[{...image,sourceFrameCount:2}]}),true)
  assert.equal(validStudy({...valid,images:[{...image,sourceFrameCount:2,sourceFrameIndex:1,sourceSeriesUid:'1.2.3',sourceSopInstanceUid:'1.2.4'}]}),true)
  for (const fields of [{sourceFrameIndex:0},{sourceFrameCount:0},{sourceFrameCount:501},{sourceFrameCount:2,sourceFrameIndex:2},{sourceFrameCount:2,sourceFrameIndex:-1},{sourceSeriesUid:'patient-text'},{sourceSopInstanceUid:'1.'.repeat(33)}]) assert.equal(validStudy({...valid,images:[{...image,...fields}]}),false)
})
