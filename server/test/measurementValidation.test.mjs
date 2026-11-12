import test from 'node:test'
import assert from 'node:assert/strict'
import { validStudy } from '../src/studyValidation.mjs'
const study = {id:'31f37b3e-946a-452c-a666-a1de7c06a47b',title:'Test',createdAt:1,updatedAt:1,patient:{name:'',patientId:'',age:'',sex:'',studyDate:'',referringPhysician:'',indication:'',clinicalHistory:''},images:[]}
const image = {id:'x',name:'x.dcm',mime:'image/jpeg',dataUrl:'data:image/jpeg;base64,AAAA',status:'idle',width:10,height:10,addedAt:1}
const length = {id:'m1',kind:'length',points:[{x:0,y:0},{x:1,y:.5}],createdAt:1}
const angle = {id:'m2',kind:'angle',points:[{x:0,y:0},{x:.5,y:.5},{x:1,y:0}],createdAt:1}
const withImage = fields => validStudy({...study,images:[{...image,...fields}]})
test('saved studies keep measurements and pixel spacing within bounds', () => {
  assert.equal(withImage({sourceRows:2048,sourceColumns:2500,pixelSpacing:{row:.139,col:.139,source:'pixel'},measurements:[length,angle]}),true)
  assert.equal(withImage({pixelSpacing:{row:.2,col:.2,source:'imager'}}),true)
  for (const fields of [
    {measurements:[{...length,points:[{x:0,y:0}]}]},
    {measurements:[{...angle,points:angle.points.slice(0,2)}]},
    {measurements:[{...length,points:[{x:-.1,y:0},{x:1,y:1}]}]},
    {measurements:[{...length,kind:'area'}]},
    {measurements:[{...length,id:''}]},
    {measurements:Array.from({length:51},(_,i)=>({...length,id:`m${i}`}))},
    {measurements:'many'},
    {pixelSpacing:{row:0,col:.1,source:'pixel'}},
    {pixelSpacing:{row:.1,col:.1,source:'guess'}},
    {sourceRows:0},
    {sourceColumns:1.5},
  ]) assert.equal(withImage(fields),false,JSON.stringify(fields).slice(0,80))
})
