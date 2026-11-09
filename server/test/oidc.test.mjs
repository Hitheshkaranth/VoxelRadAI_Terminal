import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { createOidcRoutes, oidcFlowCookie, readOidcFlowCookie, readOidcSettings, validateIdentityClaims } from '../src/oidc.mjs'
import { hashToken } from '../src/security.mjs'

test('OIDC is opt-in and rejects partial/insecure configuration and insufficient assurance', () => {
  assert.deepEqual(readOidcSettings({},'http://localhost:8088'),{enabled:false})
  assert.throws(()=>readOidcSettings({OIDC_ENABLED:'true'},'https://app.example'))
  const env={OIDC_ENABLED:'true',OIDC_ISSUER:'http://id.example/realms/skanda',OIDC_CLIENT_ID:'skanda',OIDC_CLIENT_SECRET:'secret'}
  assert.throws(()=>readOidcSettings(env,'https://app.example'))
  assert.throws(()=>readOidcSettings({...env,OIDC_ALLOW_INSECURE_LOCALHOST:'true'},'http://localhost:8088'))
  const settings=readOidcSettings({...env,OIDC_ISSUER:'https://id.example/realms/skanda',OIDC_REQUIRED_ACR:'urn:skanda:mfa'},'https://app.example')
  assert.deepEqual(validateIdentityClaims({iss:settings.issuer,sub:'subject',acr:'urn:skanda:mfa'},settings),{issuer:settings.issuer,subject:'subject'})
  assert.throws(()=>validateIdentityClaims({iss:settings.issuer,sub:'subject',acr:'password'},settings))
  const token='a'.repeat(43)
  assert.equal(readOidcFlowCookie(oidcFlowCookie(token,true)),token)
  assert.match(oidcFlowCookie(token,true),/HttpOnly; SameSite=Lax; Max-Age=600; Secure/)
  assert.equal(readOidcFlowCookie('skanda_oidc_flow=invalid'),null)
})

// Real openid-client discovery, token exchange, JWKS and signed JWT validation against a local standards fixture.
// The pool double isolates application mapping/state persistence; DB transactions are covered separately.
test('OIDC signed authorization code flow enforces state, cookie, PKCE, nonce, issuer, audience, signature and active explicit mapping', async t => {
  const keys=generateKeyPairSync('rsa',{modulusLength:2048})
  const badKeys=generateKeyPairSync('rsa',{modulusLength:2048})
  const jwk={...keys.publicKey.export({format:'jwk'}),kid:'fixture-key',use:'sig',alg:'RS256'}
  const codes=new Map(); let issuer, mode='valid', exchanges=0
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url')
  const provider=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json')
    if(req.url==='/realm/.well-known/openid-configuration') return res.end(JSON.stringify({issuer,authorization_endpoint:issuer+'/auth',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_post'],code_challenge_methods_supported:['S256']}))
    if(req.url==='/realm/jwks') return res.end(JSON.stringify({keys:[jwk]}))
    if(req.url==='/realm/token') {
      let body=''; for await(const chunk of req) body+=chunk
      const fields=new URLSearchParams(body), auth=codes.get(fields.get('code')); exchanges++
      if(!auth || fields.get('client_secret')!=='fixture-secret' || createHash('sha256').update(fields.get('code_verifier')||'').digest('base64url')!==auth.challenge) { res.statusCode=400; return res.end(JSON.stringify({error:'invalid_grant'})) }
      codes.delete(fields.get('code'))
      const now=Math.floor(Date.now()/1000)
      const claims={iss:mode==='issuer'?'https://wrong.example':issuer,sub:'linked-subject',aud:mode==='audience'?'other-client':'skanda-test',exp:now+300,iat:now,auth_time:now,nonce:mode==='nonce'?'wrong-nonce':auth.nonce}
      const input=encode({alg:'RS256',kid:'fixture-key'})+'.'+encode(claims)
      const jwt=input+'.'+sign('RSA-SHA256',Buffer.from(input),mode==='signature'?badKeys.privateKey:keys.privateKey).toString('base64url')
      return res.end(JSON.stringify({access_token:'fixture-access-token',token_type:'Bearer',expires_in:300,id_token:jwt}))
    }
    res.statusCode=404; res.end('{}')
  })
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve)); issuer=`http://127.0.0.1:${provider.address().port}/realm`
  t.after(()=>new Promise(resolve=>provider.close(resolve)))
  const states=new Map(); let mapped=true, disabled=false, issued=0
  const pool={async query(sql,params=[]) {
    if(sql.includes('SELECT count(*)')) return {rows:[{total:states.size}]}
    if(sql.startsWith('INSERT INTO oidc_login_states')) { states.set(params[0],{state_hash:params[0],browser_hash:params[1],code_verifier:params[2],nonce:params[3],issuer:params[4],link_user_id:params[5],link_session_hash:params[6]}); return {rowCount:1,rows:[]} }
    if(sql.startsWith('DELETE FROM oidc_login_states WHERE state_hash')) { const row=states.get(params[0]); if(!row || row.browser_hash!==params[1] || row.issuer!==params[2] || row.expired) return {rows:[],rowCount:0}; states.delete(params[0]); return {rows:[row],rowCount:1} }
    if(sql.includes('FROM oidc_identities i JOIN users')) return {rows:mapped?[{id:'00000000-0000-0000-0000-000000000001',email:'existing@example.invalid',role:'clinician',disabled}]:[]}
    if(sql.startsWith('SELECT 1 FROM oidc_identities')) return {rows:mapped?[{}]:[],rowCount:mapped?1:0}
    return {rows:[],rowCount:0}
  },async connect(){return {...this,release(){}}}}
  const send=(res,status,data,headers={})=>{res.writeHead(status,headers);res.end(JSON.stringify(data))}
  const adapter=createOidcRoutes({pool,publicOrigin:'http://localhost:8088',secureCookies:false,userFor:async()=>null,body:async()=>({}),send,issueSession:async()=>{issued++;return 'skanda_session=fixture'},env:{OIDC_ENABLED:'true',OIDC_ISSUER:issuer,OIDC_CLIENT_ID:'skanda-test',OIDC_CLIENT_SECRET:'fixture-secret',OIDC_ALLOW_INSECURE_LOCALHOST:'true'}})
  const response=()=>({writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=body}})
  async function begin() {
    const res=response(); await adapter.route({url:'/api/oidc/login',method:'GET',headers:{}},res)
    assert.equal(res.status,303)
    const url=new URL(res.headers.Location),state=url.searchParams.get('state'),code=crypto.randomUUID()
    assert.equal(url.searchParams.get('code_challenge_method'),'S256')
    codes.set(code,{nonce:url.searchParams.get('nonce'),challenge:url.searchParams.get('code_challenge')})
    return {state,code,cookie:res.headers['Set-Cookie'].split(';')[0]}
  }
  async function finish(flow, overrides={}) {
    const res=response(); await adapter.route({url:`/api/oidc/callback?state=${overrides.state||flow.state}&code=${flow.code}`,method:'GET',headers:{cookie:overrides.cookie??flow.cookie}},res); return res
  }
  let flow=await begin(), result=await finish(flow)
  assert.equal(result.status,303); assert.equal(issued,1); assert.equal((await finish(flow)).status,400)
  flow=await begin(); const before=exchanges; assert.equal((await finish(flow,{state:'b'.repeat(43)})).status,400); assert.equal(exchanges,before)
  assert.equal((await finish(flow,{cookie:''})).status,400); assert.equal(exchanges,before)
  assert.equal((await finish(flow)).status,303)
  flow=await begin(); states.get(hashToken(flow.state)).expired=true; assert.equal((await finish(flow)).status,400)
  for(const failure of ['nonce','issuer','audience','signature']) { mode=failure; flow=await begin(); assert.equal((await finish(flow)).status,400,failure) }
  mode='valid'; flow=await begin(); states.get(hashToken(flow.state)).code_verifier='wrong-verifier'; assert.equal((await finish(flow)).status,400)
  mapped=false; flow=await begin(); assert.equal((await finish(flow)).status,403)
  mapped=true; disabled=true; flow=await begin(); assert.equal((await finish(flow)).status,403)
  disabled=false; flow=await begin(); const pair=await Promise.all([finish(flow),finish(flow)]); assert.deepEqual(pair.map(value=>value.status).sort(),[303,400])
  assert.equal(issued,3)
})
