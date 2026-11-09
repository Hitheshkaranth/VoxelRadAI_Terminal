import assert from 'node:assert/strict'
import { chatStream, checkConnection } from '../src/lib/modelTransport.ts'
import type { Settings } from '../src/types.ts'

const settings = { baseUrl: '/lmstudio/v1', model: 'skanda-test', temperature: 0, maxTokens: 100 } as Settings
const originalFetch = globalThis.fetch
const encoder = new TextEncoder()
const event = (text: string, finish: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: finish }] })}\n\n`
const response = (chunks: string[]) => new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close() } }), { headers: { 'Content-Type': 'text/event-stream' } })
const run = (signal?: AbortSignal, onDelta?: (text: string) => void) => chatStream({ settings, messages: [{ role: 'user', content: 'Synthetic transport test; no clinical image.' }], signal, onDelta })

try {
  let deltas = ''
  const wire = event('first ') + event('second', 'stop') + 'data: [DONE]\n\n'
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    assert.equal(body.stream, true)
    assert.equal(body.model, settings.model)
    return response([wire.slice(0, 13), wire.slice(13, 67), wire.slice(67)])
  }
  assert.deepEqual(await run(undefined, text => { deltas += text }), { text: 'first second', finish: 'stop' })
  assert.equal(deltas, 'first second')
  globalThis.fetch = async () => response([event('partial')])
  await assert.rejects(run(), /before the response completed/)
  globalThis.fetch = async () => response([event('partial'), 'data: invalid-json\n', 'data: [DONE]\n'])
  await assert.rejects(run(), /damaged stream/)
  globalThis.fetch = async () => response(['data: [DONE]\n'])
  await assert.rejects(run(), /no readable output/)
  globalThis.fetch = async () => response([event('limited', 'length')])
  assert.equal((await run()).finish, 'length')
  globalThis.fetch = async () => response(['data: {"error":{"message":"test failure"}}\n'])
  await assert.rejects(run(), /test failure/)
  globalThis.fetch = async () => new Response('{"error":{"message":"overloaded"}}', { status: 503 })
  await assert.rejects(run(), /503.*overloaded/)
  const cancelled = new AbortController(); cancelled.abort()
  await assert.rejects(run(cancelled.signal), { name: 'AbortError' })
  const midstream = new AbortController()
  globalThis.fetch = async (_url, init) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(event('start')))
      init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true })
    },
  }))
  await assert.rejects(run(midstream.signal, () => midstream.abort()), { name: 'AbortError' })
  // A cancelled request must not poison the next request.
  globalThis.fetch = async () => response([event('recovered', 'stop')])
  assert.equal((await run()).text, 'recovered')

  const urls: string[] = []
  globalThis.fetch = async url => {
    urls.push(String(url))
    return String(url).includes('/api/v0/') ? new Response('', { status: 404 }) : Response.json({ data: [{ id: 'skanda-test' }] })
  }
  assert.equal(await checkConnection(settings), 'online')
  assert.equal(urls.length, 2)
  globalThis.fetch = async () => Response.json({ data: [{ id: 'skanda-test', state: 'not-loaded' }] })
  assert.equal(await checkConnection(settings), 'model-missing')
  globalThis.fetch = async () => Response.json({ data: [{ id: 'skanda-test-other', state: 'loaded' }] })
  assert.equal(await checkConnection(settings), 'model-missing')
  let calls = 0
  globalThis.fetch = async () => { calls++; return new Response('', { status: 401 }) }
  assert.equal(await checkConnection(settings), 'offline')
  assert.equal(calls, 1)
  console.log('Model transport: chunked streaming, termination, damaged/empty streams, HTTP errors, cancellation, recovery and compatible-server detection passed (controlled responses, not live inference).')
} finally { globalThis.fetch = originalFetch }
