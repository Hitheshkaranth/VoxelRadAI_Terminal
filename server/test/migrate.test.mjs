import test from 'node:test'
import assert from 'node:assert/strict'
import { migrate } from '../src/migrate.mjs'
function fakePool(mode) {
  const statements=[]; let released=false
  return {statements,get released(){return released},connect:async()=>({
    query:async(sql)=>{
      statements.push(sql)
      if(sql.startsWith('SELECT checksum')) return {rows:mode==='mismatch'?[{checksum:'wrong'}]:[]}
      if(mode==='sql-failure' && sql.includes('CREATE TABLE IF NOT EXISTS users')) throw new Error('simulated migration failure')
      return {rows:[]}
    },release(){released=true},
  })}
}
test('migration checksum mismatch rolls back and releases without executing changed SQL', async()=>{
  const pool=fakePool('mismatch')
  await assert.rejects(migrate(pool),/checksum mismatch/)
  assert.ok(pool.statements.includes('ROLLBACK'));assert.ok(!pool.statements.includes('COMMIT'));assert.ok(pool.released)
  assert.ok(!pool.statements.some(sql=>sql.includes('CREATE TABLE IF NOT EXISTS users')))
})
test('failed migration rolls back the transaction and releases connection', async()=>{
  const pool=fakePool('sql-failure')
  await assert.rejects(migrate(pool),/simulated migration failure/)
  assert.ok(pool.statements.includes('ROLLBACK'));assert.ok(!pool.statements.includes('COMMIT'));assert.ok(pool.released)
})
