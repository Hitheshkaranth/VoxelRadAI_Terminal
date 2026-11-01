import type { Finding } from '../types.ts'
import { getSliceGeometry, type Vec3, type Volume, type VolumePlane } from './volume.ts'
export interface VolumeRegion {
  id: string; title: string; finding: Finding; plane: VolumePlane; index: number
  min: Vec3; max: Vec3
}
/** Bounding regions only. A single-slice finding gets exactly one voxel's depth. */
export function findingRegion(volume: Volume, plane: VolumePlane, index: number, finding: Finding): VolumeRegion | null {
  const box = finding.bbox
  if (finding.validationIssues?.length || !box || finding.severity === 'normal' || finding.review === 'dismissed') return null
  if (![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.w <= 0 || box.h <= 0) return null
  const g = getSliceGeometry(volume, plane)
  if (index < 0 || index >= g.count) return null
  const min: Vec3 = [0,0,0], max: Vec3 = [0,0,0]
  const x0=Math.max(0,box.x), x1=Math.min(1,box.x+box.w), y0=Math.max(0,box.y), y1=Math.min(1,box.y+box.h)
  if (x1 <= x0 || y1 <= y0) return null
  min[g.columnAxis]=g.flipColumn ? 1-x1 : x0; max[g.columnAxis]=g.flipColumn ? 1-x0 : x1
  min[g.rowAxis]=g.flipRow ? 1-y1 : y0; max[g.rowAxis]=g.flipRow ? 1-y0 : y1
  min[g.axis]=index/g.count; max[g.axis]=(index+1)/g.count
  return { id: `${plane}:${index}:${finding.id}`, title: finding.title, finding, plane, index, min, max }
}
export function regionOnSlice(volume: Volume, plane: VolumePlane, index: number, region: VolumeRegion) {
  const g=getSliceGeometry(volume,plane)
  // Intersect the voxel slab, including sub-voxel boxes between pixel centers.
  if ((index+1)/g.count <= region.min[g.axis] || index/g.count >= region.max[g.axis]) return null
  const x=g.flipColumn ? 1-region.max[g.columnAxis] : region.min[g.columnAxis]
  const y=g.flipRow ? 1-region.max[g.rowAxis] : region.min[g.rowAxis]
  return { x, y, w:region.max[g.columnAxis]-region.min[g.columnAxis], h:region.max[g.rowAxis]-region.min[g.rowAxis] }
}
export function projectRegion(volume: Volume, region: VolumeRegion, yaw: number, pitch: number, width: number, height: number) {
  const physical=volume.dimensions.map((n,i)=>n*volume.spacing[i]), largest=Math.max(...physical)
  const right=[Math.cos(yaw),Math.sin(yaw),0], up=[-Math.sin(pitch)*Math.sin(yaw),Math.sin(pitch)*Math.cos(yaw),Math.cos(pitch)]
  return Array.from({length:8},(_,corner)=>{
    const local=region.min.map((min,i)=>(((corner>>i)&1 ? region.max[i] : min)-.5)*physical[i]/largest)
    const world=[0,1,2].map(a=>local.reduce((sum,v,i)=>sum+v*volume.directions[i][a],0))
    const x=world.reduce((sum,v,i)=>sum+v*right[i],0)/.92
    const y=world.reduce((sum,v,i)=>sum+v*up[i],0)/.92
    return [(x/(width/height)+1)*width/2,(1-y)*height/2]
  })
}

/** Shared anatomical target for selecting a finding in any viewing plane. */
export function regionAnchor(volume: Pick<Volume, 'dimensions'>, region: VolumeRegion): Vec3 {
  return region.min.map((value, axis) => Math.max(0, Math.min(volume.dimensions[axis]-1, ((value + region.max[axis])/2)*volume.dimensions[axis]-.5))) as Vec3
}
