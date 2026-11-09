import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createOperations } from '../src/operations.mjs'

test('operations counts finish and aborted requests once without request content', () => {
  let clock = 1000
  const logs = []
  const operations = createOperations({ now: () => clock, log: line => logs.push(JSON.parse(line)) })
  const res = new EventEmitter(); res.setHeader = (name, value) => { assert.equal(name, 'X-Request-ID'); assert.match(value, /^[a-f0-9-]{36}$/) }
  operations.begin(res)
  assert.equal(operations.snapshot().requests.inFlight, 1)
  clock += 75; res.statusCode = 503; res.writableFinished = true; res.emit('finish'); res.emit('close')
  assert.equal(operations.snapshot().requests.completed, 1)
  assert.equal(operations.snapshot().requests.failed, 1)
  assert.equal(operations.snapshot().requests.meanDurationMs, 75)
  assert.deepEqual(Object.keys(logs[0]).sort(), ['durationMs', 'event', 'requestId', 'status'])
  const aborted = new EventEmitter(); aborted.setHeader = () => {}; operations.begin(aborted); aborted.emit('close')
  assert.equal(operations.snapshot().statuses['4xx'], 1)
  assert.equal(operations.snapshot().requests.inFlight, 0)
})
