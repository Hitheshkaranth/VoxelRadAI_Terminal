// Run explicitly against a disposable test deployment; creates test users/studies.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
const baseUrl = process.env.BASE_URL || process.env.TEST_ORIGIN || 'http://localhost:5173'
const origin = process.env.TEST_ORIGIN || baseUrl
if (!process.env.TEST_ADMIN_EMAIL || !process.env.TEST_ADMIN_PASSWORD) throw new Error('Set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD for a disposable deployment')
async function call(path, { method = 'GET', data, cookie } = {}) {
  const response = await fetch(baseUrl + path, { method, headers: { Origin: origin, ...(data ? {'Content-Type':'application/json'} : {}), ...(cookie ? {Cookie:cookie} : {}) }, body: data ? JSON.stringify(data) : undefined })
  const type = response.headers.get('content-type') || ''
  const body = type.includes('json') ? await response.json() : await response.text()
  return { status: response.status, body, cookie: response.headers.get('set-cookie')?.split(';')[0] }
}
assert.equal((await call('/api/admin/metrics')).status,401)
assert.equal((await call('/api/auth/check')).status,401)
assert.equal((await fetch(baseUrl+'/api/login',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:'{}'})).status,403)
assert.equal((await fetch(baseUrl+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'null'})).status,400)
assert.equal((await fetch(baseUrl+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'x'.repeat(9000)})})).status,413)
const admin = await call('/api/login',{method:'POST',data:{email:process.env.TEST_ADMIN_EMAIL,password:process.env.TEST_ADMIN_PASSWORD}})
assert.equal(admin.status,200); assert.ok(admin.cookie)
const id = randomUUID(), email = `test-${id}@example.invalid`, password = `Test-${randomUUID()}`
assert.equal((await call('/api/admin/users',{method:'POST',cookie:admin.cookie,data:{email,password,role:'clinician'}})).status,201)
const clinician = await call('/api/login',{method:'POST',data:{email,password}})
assert.equal(clinician.status,200)
assert.equal((await call('/api/admin/metrics',{cookie:clinician.cookie})).status,403)
const metrics = await call('/api/admin/metrics',{cookie:admin.cookie})
assert.equal(metrics.status,200); assert.ok(metrics.body.users.total>=2); assert.equal(metrics.body.jobs.available,false)
assert.equal((await call('/api/admin/users?offset=NaN',{cookie:admin.cookie})).status,400)
assert.equal((await call('/api/studies?limit=Infinity',{cookie:clinician.cookie})).status,400)
assert.equal((await call('/api/studies',{method:'POST',cookie:clinician.cookie,data:{id:'bad',images:[],title:'bad'}})).status,400)
const study = {id:randomUUID(),title:'Integration fixture',createdAt:Date.now(),updatedAt:Date.now(),patient:{name:'Do not expose',patientId:'test-id',age:'',sex:'',studyDate:'',referringPhysician:'',indication:'',clinicalHistory:''},images:[],report:{technique:'',comparison:'',findings:'<script>unsafe</script>',impression:'',recommendations:'',radiologist:'',signed:false,generated:false,updatedAt:Date.now()}}
assert.equal((await call('/api/studies',{method:'POST',cookie:clinician.cookie,data:study})).status,200)
assert.equal((await call(`/api/studies/${study.id}`,{cookie:admin.cookie})).status,404)
assert.equal((await call(`/api/studies/${study.id}`,{cookie:clinician.cookie})).body.study.id,study.id)
const listed = await call('/api/studies?limit=1&offset=0',{cookie:clinician.cookie})
assert.equal(listed.body.studies.length,1); assert.ok(!('payload' in listed.body.studies[0]))
assert.equal((await call(`/api/studies/${study.id}/shares`,{method:'POST',cookie:clinician.cookie,data:{expiresInHours:0,includeIdentity:false,includeImages:false}})).status,400)
assert.equal((await call(`/api/studies/${study.id}/shares`,{method:'POST',cookie:admin.cookie,data:{expiresInHours:1,includeIdentity:false,includeImages:false}})).status,404)
const share = await call(`/api/studies/${study.id}/shares`,{method:'POST',cookie:clinician.cookie,data:{expiresInHours:1,includeIdentity:false,includeImages:false}})
assert.equal(share.status,201)
const sharedPath = new URL(share.body.share.url).pathname
const readable = await call(sharedPath)
assert.equal(readable.status,200); assert.ok(!readable.body.includes('Do not expose')); assert.ok(readable.body.includes('&lt;script&gt;'))
assert.equal((await call(`/api/shares/${share.body.share.id}`,{method:'DELETE',cookie:admin.cookie})).status,404)
assert.equal((await call(`/api/shares/${share.body.share.id}`,{method:'DELETE',cookie:clinician.cookie})).status,200)
assert.equal((await call(sharedPath)).status,404)
if (process.env.DATABASE_URL) {
  const pg = createRequire(`${process.cwd()}/package.json`)('pg'); const db = new pg.Pool({connectionString:process.env.DATABASE_URL})
  const expiring = await call(`/api/studies/${study.id}/shares`,{method:'POST',cookie:clinician.cookie,data:{expiresInHours:1,includeIdentity:false,includeImages:false}})
  assert.equal(expiring.status,201)
  await db.query("UPDATE share_grants SET expires_at=now()-interval '1 second' WHERE id=$1",[expiring.body.share.id])
  assert.equal((await call(new URL(expiring.body.share.url).pathname)).status,404)
  await db.end()
}
assert.equal((await call(`/api/studies/${study.id}`,{method:'DELETE',cookie:clinician.cookie})).status,200)
assert.equal((await call('/api/logout',{method:'POST',cookie:clinician.cookie})).status,200)
assert.equal((await call('/api/auth/check',{cookie:clinician.cookie})).status,401)
const signedAgain = await call('/api/login',{method:'POST',data:{email,password}})
const userId = signedAgain.body.user.id
assert.equal((await call(`/api/admin/users/${userId}`,{method:'PATCH',cookie:admin.cookie,data:{disabled:true}})).status,200)
assert.equal((await call('/api/auth/check',{cookie:signedAgain.cookie})).status,401)
assert.equal((await call('/api/login',{method:'POST',data:{email,password}})).status,401)
const nextPassword = `Reset-${randomUUID()}`
assert.equal((await call(`/api/admin/users/${userId}`,{method:'PATCH',cookie:admin.cookie,data:{disabled:false,password:nextPassword}})).status,200)
assert.equal((await call('/api/login',{method:'POST',data:{email,password}})).status,401)
assert.equal((await call('/api/login',{method:'POST',data:{email,password:nextPassword}})).status,200)
const [racingLogin,racingReset] = await Promise.all([
  call('/api/login',{method:'POST',data:{email,password:nextPassword}}),
  call(`/api/admin/users/${userId}`,{method:'PATCH',cookie:admin.cookie,data:{password:`Final-${randomUUID()}`}}),
])
assert.equal(racingReset.status,200); assert.ok([200,401].includes(racingLogin.status))
if(racingLogin.cookie) assert.equal((await call('/api/auth/check',{cookie:racingLogin.cookie})).status,401)
const limitedEmail=`rate-${randomUUID()}@example.invalid`
for(let attempt=0;attempt<16;attempt++) {
  const blocked=await call('/api/login',{method:'POST',data:{email:limitedEmail,password:'Invalid test password'}})
  assert.equal(blocked.status,attempt<15?401:429)
}
console.log('Integration passed: login, RBAC, owner isolation, inert sharing, revocation, deletion and logout.')
