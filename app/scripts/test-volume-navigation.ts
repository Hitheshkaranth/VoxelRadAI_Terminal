import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { centerVoxel, setSliceAnchor, indexForPlane, indexAcrossPlanes, slicePointFromVoxel, voxelFromSlicePoint, worldToVoxel, visibleContentBounds } from '../src/lib/volumeNavigation.ts'
import { decodeNrrd, getSliceGeometry, renderSlice, voxelToWorld, type Vec3, type Volume, type VolumePlane } from '../src/lib/volume.ts'
const volume: Volume = { dimensions:[10,20,30],spacing:[.5,1,2],directions:[[1,0,0],[0,1,0],[0,0,1]],origin:[-3,10,50],space:'LPS',range:[0,100],data:new Uint8Array(6000),worldBounds:{min:[-3,10,50],max:[2,30,110]} }
let checks=0
const near=(actual:number,expected:number)=>{assert.ok(Math.abs(actual-expected)<1e-8,`${actual} ≈ ${expected}`);checks++}
for(const directions of [volume.directions,[[0,1,0],[0,0,-1],[-1,0,0]],[[.8,.6,0],[-.6,.8,0],[0,0,1]]] as Volume['directions'][]){
 const v={...volume,directions}; const anchor:Vec3=[2.25,13.5,23.75]
 const inverse=worldToVoxel(v,voxelToWorld(v,anchor));inverse.forEach((n,i)=>near(n,anchor[i]))
 for(const plane of ['axial','coronal','sagittal'] as VolumePlane[]){
  const g=getSliceGeometry(v,plane)
  const selected=setSliceAnchor(v,anchor,plane,3)
  near(selected[g.axis],3)
  near(selected[g.columnAxis],anchor[g.columnAxis]);near(selected[g.rowAxis],anchor[g.rowAxis])
  const point=slicePointFromVoxel(v,plane,selected), roundtrip=voxelFromSlicePoint(v,plane,3,point)
  roundtrip.forEach((n,i)=>near(n,selected[i]))
  for(const next of ['axial','coronal','sagittal'] as VolumePlane[]){
   near(indexAcrossPlanes(v,plane,3,next,anchor),indexForPlane(v,selected,next))
  }
  const clamp=setSliceAnchor(v,anchor,plane,999);near(clamp[g.axis],g.count-1)
 }
}
assert.deepEqual(centerVoxel(volume),[4.5,9.5,14.5]);checks++
const pixels=new Uint8ClampedArray(64*64*4)
for(let y=10;y<=15;y++)for(let x=15;x<=20;x++)pixels.set([100,100,100,255],(x+y*64)*4)
assert.deepEqual(visibleContentBounds(pixels,64,64),{x:13,y:8,width:10,height:10});checks++
assert.equal(visibleContentBounds(new Uint8ClampedArray(64*64*4),64,64),null);checks++
assert.equal(visibleContentBounds(pixels,20,20),null);checks++
const bytes=readFileSync(new URL('../public/samples/ct-brain.nrrd',import.meta.url))
const ct=await decodeNrrd(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))
const slice=renderSlice(ct,'axial',3,{center:40,width:100})
const bounds=visibleContentBounds(slice.pixels,slice.width,slice.height)!
assert.ok(bounds && bounds.height < 180 && bounds.height > 100, 'CT slice 4 display-content fit excludes constant lower rows');checks++
assert.equal(slice.height,507,'content fit never alters source dimensions');checks++
console.log(`Volume spatial navigation and content fit: ${checks} checks passed`)
