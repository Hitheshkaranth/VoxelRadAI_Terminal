import test from 'node:test'
import assert from 'node:assert/strict'
import { expectedRevision, preservesSignedHistory, studyWriteConflict, validStudy } from '../src/studyValidation.mjs'
const patient = {name:'',patientId:'',age:'',sex:'',studyDate:'',referringPhysician:'',indication:'',clinicalHistory:''}
const valid = {id:'31f37b3e-946a-452c-a666-a1de7c06a47b',title:'Test',createdAt:1,updatedAt:1,patient,images:[]}
const sections = {technique:'PA',comparison:'',findings:'Clear.',impression:'Normal.',recommendations:''}
const v1 = {version:1,signedAt:10,signedBy:'Dr A',sections,patientSnapshot:patient}
const signedReport = {...sections,radiologist:'Dr A',signed:true,generated:true,updatedAt:10,versions:[v1],addenda:[{id:'a1',text:'Rib fracture.',createdAt:20,by:'Dr B',signedAt:20,version:1}]}
test('report history fields are validated and signed text must match the latest version', () => {
  assert.equal(validStudy({...valid,report:signedReport}),true)
  assert.equal(validStudy({...valid,report:{...signedReport,findings:'Edited after signing.'}}),false)
  assert.equal(validStudy({...valid,report:{...signedReport,signed:false,findings:'Correction draft',correction:{of:1,startedAt:30,by:'Dr B'}}}),true)
  assert.equal(validStudy({...valid,report:{...signedReport,versions:[{...v1,version:2}]}}),false)
  assert.equal(validStudy({...valid,report:{...signedReport,versions:[{...v1,sections:{findings:'x'}}]}}),false)
  assert.equal(validStudy({...valid,report:{...signedReport,versions:[v1,{...v1,version:2,corrects:2}]}}),false)
  assert.equal(validStudy({...valid,report:{...signedReport,addenda:[signedReport.addenda[0],signedReport.addenda[0]]}}),false)
  assert.equal(validStudy({...valid,report:{...signedReport,addenda:[{id:'a',text:'x'.repeat(20001),createdAt:1,by:''}]}}),false)
  assert.equal(validStudy({...valid,report:{...signedReport,correction:{of:'1'}}}),false)
  // Reports signed before versions existed still load.
  assert.equal(validStudy({...valid,report:{...sections,radiologist:'Dr A',signed:true,generated:true,updatedAt:1,amendments:[{signedAt:1,unlockedAt:2,by:'Dr A'}]}}),true)
})
test('saved signed versions and signed addenda are append-only', () => {
  // jsonb reorders keys; equality must not depend on key order.
  const reordered = {...signedReport,versions:[Object.fromEntries(Object.entries(v1).reverse())]}
  assert.equal(preservesSignedHistory(signedReport,reordered),true)
  const v2 = {...v1,version:2,signedAt:40,corrects:1,sections:{...sections,findings:'Fracture.'}}
  assert.equal(preservesSignedHistory(signedReport,{...signedReport,versions:[v1,v2]}),true)
  assert.equal(preservesSignedHistory(signedReport,{...signedReport,versions:[]}),false)
  assert.equal(preservesSignedHistory(signedReport,undefined),false)
  assert.equal(preservesSignedHistory(signedReport,{...signedReport,versions:[{...v1,sections:{...sections,impression:'Rewritten.'}}]}),false)
  assert.equal(preservesSignedHistory(signedReport,{...signedReport,versions:[{...v1,signedBy:'Someone else'}]}),false)
  assert.equal(preservesSignedHistory(signedReport,{...signedReport,addenda:[]}),false)
  assert.equal(preservesSignedHistory(signedReport,{...signedReport,addenda:[{...signedReport.addenda[0],text:'Changed.'}]}),false)
  assert.equal(preservesSignedHistory(undefined,signedReport),true)
  assert.equal(preservesSignedHistory({signed:true},{signed:false}),true)
})
test('study writes check the expected revision before signed history', () => {
  assert.equal(expectedRevision(undefined),undefined)
  assert.equal(expectedRevision('new'),'new')
  assert.equal(expectedRevision('7'),7)
  for (const bad of ['0','-1','1.5','abc','01','9999999999','']) assert.equal(expectedRevision(bad),null)
  const existing = {revision:3,report:signedReport}
  const next = {...valid,report:signedReport}
  assert.equal(studyWriteConflict(null,next,'new'),null)
  assert.equal(studyWriteConflict(null,next,4),null)
  assert.equal(studyWriteConflict(existing,next,3),null)
  assert.equal(studyWriteConflict(existing,next,undefined),null)
  assert.equal(studyWriteConflict(existing,next,2).code,'stale')
  assert.equal(studyWriteConflict(existing,next,'new').code,'stale')
  assert.equal(studyWriteConflict(existing,{...valid},3).code,'signed-history')
  // Unconditional (overwrite) writes still may not drop signed versions.
  assert.equal(studyWriteConflict(existing,{...valid,report:{...signedReport,versions:[]}},undefined).code,'signed-history')
})
