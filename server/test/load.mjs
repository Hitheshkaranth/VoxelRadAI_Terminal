// Bounded, read-only authenticated load smoke. Never logs credentials or responses.
import assert from 'node:assert/strict'
const base = process.env.BASE_URL || 'http://localhost:8088'
const origin = process.env.TEST_ORIGIN || new URL(base).origin
if (!process.env.TEST_ADMIN_EMAIL || !process.env.TEST_ADMIN_PASSWORD) throw new Error('Set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD for a disposable deployment')
const requests = Number(process.env.LOAD_REQUESTS || 100)
const concurrency = Number(process.env.LOAD_CONCURRENCY || 8)
if (!Number.isInteger(requests) || requests < 1 || requests > 10000 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) throw new Error('Use 1–10000 requests and concurrency 1–100')
const login = await fetch(base + '/api/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({email:process.env.TEST_ADMIN_EMAIL,password:process.env.TEST_ADMIN_PASSWORD}), signal: AbortSignal.timeout(30000) })
assert.equal(login.status,200,'Load test sign-in failed')
const cookie=login.headers.get('set-cookie')?.split(';')[0]
assert.ok(cookie)
const latencies=[]; let issued=0, failed=0
const started=performance.now()
try {
  await Promise.all(Array.from({length:Math.min(concurrency,requests)},async()=>{
    while(issued<requests) {
      issued++; const start=performance.now()
      try { const response=await fetch(base+'/api/session',{headers:{Cookie:cookie},signal:AbortSignal.timeout(15000)}); const data=await response.json(); if(response.status!==200 || !data.user) failed++ } catch { failed++ }
      latencies.push(performance.now()-start)
    }
  }))
} finally {
  await fetch(base+'/api/logout',{method:'POST',headers:{Origin:origin,Cookie:cookie},signal:AbortSignal.timeout(15000)})
}
latencies.sort((a,b)=>a-b)
const percentile=p=>Math.round(latencies[Math.min(latencies.length-1,Math.ceil(latencies.length*p)-1)])
console.log(JSON.stringify({kind:'authenticated-session-smoke',requests,concurrency,failed,elapsedMs:Math.round(performance.now()-started),p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),note:'Not a clinical throughput benchmark or capacity guarantee'},null,2))
assert.equal(failed,0,'Some authenticated session requests failed')
