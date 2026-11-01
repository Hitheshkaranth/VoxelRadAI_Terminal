import assert from 'node:assert/strict'
import { findingRegion, regionOnSlice, projectRegion, regionAnchor } from '../src/lib/volumeAnnotations.ts'
import { getSliceGeometry, type Volume, type VolumePlane } from '../src/lib/volume.ts'
import { indexForPlane } from '../src/lib/volumeNavigation.ts'
import type { Finding } from '../src/types.ts'
const volume: Volume = { dimensions:[10,20,30],spacing:[.5,1,2],directions:[[1,0,0],[0,1,0],[0,0,1]],origin:[-3,10,50],space:'LPS',range:[0,100],data:new Uint8Array(6000),worldBounds:{min:[-3,10,50],max:[2,30,110]} }
const finding={id:'one',title:'Fixture',severity:'minor',bbox:{x:.2,y:.3,w:.25,h:.4}} as Finding
let checks=0
for(const directions of [volume.directions,[[0,1,0],[0,0,-1],[-1,0,0]],[[.8,.6,0],[-.6,.8,0],[0,0,1]]] as Volume['directions'][]){
 const v={...volume,directions}
 for(const plane of ['axial','coronal','sagittal'] as VolumePlane[]){
  const g=getSliceGeometry(v,plane),r=findingRegion(v,plane,3,finding)!
  const b=regionOnSlice(v,plane,3,r)!
  for(const k of ['x','y','w','h'] as const)assert.ok(Math.abs(b[k]-finding.bbox![k])<1e-10)
  assert.equal(regionOnSlice(v,plane,4,r),null)
  assert.ok(Math.abs(r.max[g.axis]-r.min[g.axis]-1/g.count)<1e-10)
  assert.ok(projectRegion(v,r,.55,.3,320,290).flat().every(Number.isFinite))
  checks+=7
 }
}
assert.equal(findingRegion(volume,'axial',1,{...finding,bbox:undefined}),null)
assert.equal(findingRegion(volume,'axial',1,{...finding,severity:'normal'}),null)
assert.equal(findingRegion(volume,'axial',1,{...finding,review:'dismissed'}),null)
assert.equal(findingRegion(volume,'axial',30,finding),null)
checks+=4
console.log(`Volume finding geometry: ${checks} checks passed`)

const mr={...volume,directions:[[0,1,0],[0,0,-1],[-1,0,0]] as Volume['directions']}
for(const bbox of [{x:.2,y:.3,w:.25,h:.4},{x:.013,y:.017,w:.001,h:.001}]) {
 const region=findingRegion(mr,'sagittal',3,{...finding,bbox})!
 const anchor=regionAnchor(mr,region)
 for(const plane of ['axial','coronal','sagittal'] as VolumePlane[]) {
  assert.ok(regionOnSlice(mr,plane,indexForPlane(mr,anchor,plane),region),`Sagittal source must intersect selected ${plane} slab`)
 }
}
console.log('MRI sagittal finding accessibility across three planes: 6 checks passed')
