import test from 'node:test'
import assert from 'node:assert/strict'
import { sharedDocument } from '../src/share.mjs'
test('shared snapshots omit identity by default, escape prose and reject remote/script images', () => {
  const study = { patient: { name: 'Secret', patientId: 'ID-secret' }, report: { findings: '<script>danger</script>' }, images: [{dataUrl:'https://tracker.example/patient'},{dataUrl:'data:image/svg+xml;base64,AAAA'},{dataUrl:'data:image/png;base64,AAAA'}] }
  const plain = sharedDocument(study)
  assert.ok(!plain.includes('Secret')); assert.ok(!plain.includes('<script>')); assert.ok(plain.includes('&lt;script&gt;'))
  assert.ok(!plain.includes('<img'))
  const included = sharedDocument(study,{includeIdentity:true,includeImages:true})
  assert.ok(included.includes('Secret')); assert.ok(included.includes('data:image/png'))
  assert.ok(!included.includes('tracker.example')); assert.ok(!included.includes('image/svg'))
})
test('signed report sharing uses frozen patient snapshot and explicit disclosure choice',()=>{
  const study={patient:{name:'Live patient'},report:{signed:true,patientSnapshot:{name:'Signed patient',patientId:'frozen-id'}}}
  const disclosed=sharedDocument(study,{includeIdentity:true})
  assert.ok(disclosed.includes('Signed patient'));assert.ok(!disclosed.includes('Live patient'))
  assert.ok(!sharedDocument(study).includes('Signed patient'));assert.ok(!sharedDocument(study).includes('frozen-id'))
})
