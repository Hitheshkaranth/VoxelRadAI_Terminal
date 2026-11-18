import assert from 'node:assert/strict'
import { gpuQuota } from '../src/lib/gpuQuota.ts'

const raw = 'Model service error: ZeroGPU read failed or quota exhausted. ' + JSON.stringify({
  error: 'You have exceeded your ZeroGPU quota (90s requested vs. 36s left). Try again in 22:37:37. Authenticate with a Hugging Face token for more quota',
  title: 'ZeroGPU quota exceeded',
})
const quota = gpuQuota(raw)!
assert.ok(quota)
assert.match(quota.message, /36 seconds.*90 seconds/)
assert.equal(quota.resetWait, '22:37:37')
assert.ok(gpuQuota('You have exceeded your free ZeroGPU quota (90s requested vs. 2s left). Try again in 1 day, 2:00:00.'))
assert.ok(gpuQuota('Space app has reached its GPU limit.'))
assert.equal(gpuQuota('Model service error: ZeroGPU read failed or quota exhausted. {"error":"CUDA out of memory"}'), null)
assert.equal(gpuQuota('Model service error: model not found'), null)
assert.equal(gpuQuota('The model stopped responding (no output for 120 s).'), null)
console.log('GPU quota: provider error parsing, budget/reset details and ordinary model-error separation passed')
