import assert from 'node:assert/strict'
import { volumeFingerprint } from '../src/lib/volumeJobIdentity.ts'
import type { Volume } from '../src/lib/volume.ts'
const volume: Volume = { data:new Int16Array([1,2,3,4,5,6,7,8]),dimensions:[2,2,2],spacing:[1,1,1],directions:[[1,0,0],[0,1,0],[0,0,1]],origin:[0,0,0],space:'LPS',range:[1,8],worldBounds:{min:[0,0,0],max:[1,1,1]} }
const original=await volumeFingerprint(volume)
assert.equal(original.length,64)
assert.equal(original,await volumeFingerprint({...volume,data:new Int16Array(volume.data)}))
const changed=new Int16Array(volume.data);changed[7]=9
assert.notEqual(original,await volumeFingerprint({...volume,data:changed}))
assert.notEqual(original,await volumeFingerprint({...volume,origin:[1,0,0]}))
assert.notEqual(original,await volumeFingerprint({...volume,spacing:[1,1,2]}))
assert.notEqual(original,await volumeFingerprint({...volume,directions:[[-1,0,0],[0,1,0],[0,0,1]]}))
const padded=new Int16Array([999,...volume.data,999])
assert.equal(original,await volumeFingerprint({...volume,data:padded.subarray(1,9)}))
assert.equal(volumeFingerprint(volume),volumeFingerprint(volume))
console.log('Volume job identity: 8 checks passed (content, geometry, offset and memoization)')
