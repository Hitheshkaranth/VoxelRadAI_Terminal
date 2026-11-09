import test from 'node:test'
import assert from 'node:assert/strict'
import { pagination } from '../src/pagination.mjs'
test('pagination rejects invalid and unsafe values instead of silently defaulting', () => {
  assert.deepEqual(pagination(new URLSearchParams()),{limit:25,offset:0})
  assert.deepEqual(pagination(new URLSearchParams('limit=100&offset=50')),{limit:100,offset:50})
  for (const query of ['limit=NaN','limit=Infinity','limit=0','limit=-1','limit=101','limit=1.5','offset=-1','offset=','offset=9007199254740992','offset=1000001']) assert.throws(()=>pagination(new URLSearchParams(query)),query)
})
