// Unit tests for the pure model-I/O and intake helpers. Run with:
//   node --experimental-strip-types scripts/test-lib.ts
import { parseSseLines } from '../src/lib/sse.ts'
import { createSerialQueue } from '../src/lib/queue.ts'
import { dicomPixelsToGray, type DicomPixelMeta } from '../src/lib/dicomPixels.ts'
import { deriveUrgency, sortBySeverity, toBBox } from '../src/lib/parse.ts'
import type { Finding } from '../src/types.ts'

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) passed++
  else {
    failed++
    console.error(`  ✗ ${name}${detail ? ` → ${detail}` : ''}`)
  }
}
function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

const chunk = (content: string, finish: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}`

// ---- parseSseLines -----------------------------------------------------------
{
  const p = parseSseLines(`${chunk('Hel')}\r\n\r\n${chunk('lo')}\r\n\r\n`)
  eq('CRLF text', p.text, 'Hello')
  eq('CRLF events', p.events.length, 2)
  eq('CRLF rest empty', p.rest, '')
  eq('CRLF not done', p.done, false)
}
{
  const whole = `${chunk('{"a":')}\n\n${chunk('1}')}\n\ndata: [DONE]\n\n`
  const cutAt = whole.indexOf('1}') - 3 // split inside the second JSON line
  const a = parseSseLines(whole.slice(0, cutAt))
  eq('split: first part text', a.text, '{"a":')
  check('split: partial line kept in rest', a.rest.startsWith('data: {'))
  eq('split: no bad lines', a.bad, [])
  const b = parseSseLines(a.rest + whole.slice(cutAt))
  eq('split: second part text', b.text, '1}')
  eq('split: done', b.done, true)
}
{
  const p = parseSseLines(`${chunk('x')}\n\ndata: [DONE]\n\n${chunk('ignored')}\n\n`)
  eq('[DONE] stops', [p.text, p.done], ['x', true])
}
{
  const p = parseSseLines(`: keep-alive\n\nevent: message\n${chunk('a')}\n\n`)
  eq('comments and fields ignored', [p.text, p.bad.length], ['a', 0])
}
{
  const p = parseSseLines(`data: {"error":{"message":"Model unloaded"}}\n\n`)
  eq('error object', p.error, 'Model unloaded')
  eq('error string', parseSseLines(`data: {"error":"boom"}\n`).error, 'boom')
}
{
  const p = parseSseLines(`${chunk('abc')}\n\n${chunk('', 'length')}\n\n`)
  eq('finish_reason length', p.finish, 'length')
  eq('finish null not recorded', parseSseLines(`${chunk('a')}\n`).finish, undefined)
}
{
  const p = parseSseLines(`data: {not json\n\n${chunk('ok')}\n\n`)
  eq('bad complete line reported', p.bad, ['{not json'])
  eq('good line still read', p.text, 'ok')
  eq('no trailing newline → rest', parseSseLines(chunk('tail')).rest, chunk('tail'))
}

// ---- serial queue --------------------------------------------------------------
const tick = () => new Promise<void>((r) => setTimeout(r, 0))
{
  const q = createSerialQueue()
  const order: string[] = []
  const job = (name: string, ms: number) => () =>
    new Promise<string>((r) =>
      setTimeout(() => {
        order.push(name)
        r(name)
      }, ms),
    )
  const all = Promise.all([q.enqueue(job('a', 20)), q.enqueue(job('b', 1)), q.enqueue(job('c', 5))])
  eq('queue size while busy', q.size(), 3)
  eq('queue results', await all, ['a', 'b', 'c'])
  eq('queue order serial', order, ['a', 'b', 'c'])
  eq('queue size idle', q.size(), 0)

  // A failing task does not block the next one.
  const failing = q.enqueue(async () => {
    throw new Error('x')
  })
  const after = q.enqueue(async () => 'after')
  check('failed task rejects', await failing.then(() => false, () => true))
  eq('next task still runs', await after, 'after')
}
{
  const q = createSerialQueue()
  let release!: () => void
  const blocker = q.enqueue(() => new Promise<void>((r) => (release = r)))
  const ac = new AbortController()
  let ran = false
  let state = 'pending'
  let errName = ''
  const waiting = q.enqueue(async () => {
    ran = true
  }, ac.signal)
  waiting.then(
    () => (state = 'resolved'),
    (e: Error) => {
      state = 'rejected'
      errName = e.name
    },
  )
  const later = q.enqueue(async () => 'later')
  await tick()
  ac.abort()
  await Promise.resolve() // one microtask
  await Promise.resolve()
  eq('abort while waiting rejects within a tick', state, 'rejected')
  eq('abort error name', errName, 'AbortError')
  eq('aborted waiter not counted', q.size(), 2)
  release()
  await blocker
  eq('job after aborted one still runs', await later, 'later')
  eq('aborted task never ran', ran, false)

  const pre = new AbortController()
  pre.abort()
  let preRan = false
  check('already-aborted signal rejects', await q.enqueue(async () => (preRan = true), pre.signal).then(() => false, () => true))
  eq('already-aborted task skipped', preRan, false)
}

// ---- dicomPixelsToGray -----------------------------------------------------------
const base: DicomPixelMeta = {
  rows: 1,
  cols: 4,
  bitsAllocated: 8,
  bitsStored: 8,
  pixelRepresentation: 0,
  bigEndian: false,
  slope: 1,
  intercept: 0,
  mono1: false,
}
function u16(values: number[], bigEndian = false): Uint8Array {
  const out = new Uint8Array(values.length * 2)
  const dv = new DataView(out.buffer)
  values.forEach((v, i) => dv.setUint16(i * 2, v & 0xffff, !bigEndian))
  return out
}
eq('8-bit min/max stretch', Array.from(dicomPixelsToGray(new Uint8Array([10, 20, 30, 40]), base)), [0, 85, 170, 255])
eq('8-bit MONOCHROME1 inverted', Array.from(dicomPixelsToGray(new Uint8Array([10, 20, 30, 40]), { ...base, mono1: true })), [255, 170, 85, 0])
{
  // Synthetic 16-bit film: horizontal gradient 0..4095, slope 1, intercept 0, WC 2048, WW 4096.
  const cols = 256
  const rows = 4
  const vals: number[] = []
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) vals.push(Math.round((x / (cols - 1)) * 4095))
  const g = dicomPixelsToGray(u16(vals), { ...base, rows, cols, bitsAllocated: 16, bitsStored: 12, windowCenter: 2048, windowWidth: 4096 })
  const row = Array.from(g.slice(0, cols))
  check('16-bit WC2048/WW4096 renders a gradient', new Set(row).size > 200, `distinct levels ${new Set(row).size}`)
  check('16-bit gradient increases', row.every((v, i) => i === 0 || v >= row[i - 1]))
  eq('16-bit gradient ends', [row[0], row[cols - 1]], [0, 255])
  const be = dicomPixelsToGray(u16(vals, true), { ...base, rows, cols, bitsAllocated: 16, bitsStored: 12, bigEndian: true, windowCenter: 2048, windowWidth: 4096 })
  eq('16-bit big-endian matches', Array.from(be), Array.from(g))
}
eq('16-bit unsigned min/max', Array.from(dicomPixelsToGray(u16([0, 1000, 2000, 3000]), { ...base, bitsAllocated: 16, bitsStored: 16 })), [0, 85, 170, 255])
{
  // 12-bit signed in 16: -2048 is 0x800, -1 is 0xFFF; garbage in the 4 high bits must be masked off.
  const raw = u16([0xf800, 0x0fff | 0xa000, 0x0000, 0x07ff])
  const g = dicomPixelsToGray(raw, { ...base, bitsAllocated: 16, bitsStored: 12, pixelRepresentation: 1 })
  eq('12-bit signed sign-extended and masked', Array.from(g), [0, 127, 128, 255])
}
eq('explicit window clips', Array.from(dicomPixelsToGray(new Uint8Array([0, 100, 150, 255]), { ...base, windowCenter: 150, windowWidth: 100 })), [0, 0, 128, 255])
{
  // Rescale before windowing: stored 0..3 → HU -1000..-700 with slope 100, intercept -1000.
  const g = dicomPixelsToGray(new Uint8Array([0, 1, 2, 3]), { ...base, slope: 100, intercept: -1000, windowCenter: -850, windowWidth: 300 })
  eq('slope/intercept applied before window', Array.from(g), [0, 85, 170, 255])
}
eq('uniform image does not divide by zero', Array.from(dicomPixelsToGray(new Uint8Array([7, 7, 7, 7]), base)), [0, 0, 0, 0])
check('truncated pixel data throws', (() => { try { dicomPixelsToGray(new Uint8Array(3), base); return false } catch { return true } })())

// ---- toBBox ----------------------------------------------------------------------
eq('toBBox 0-1000 box_2d array', toBBox([100, 200, 300, 400]), { x: 0.2, y: 0.1, w: 0.2, h: 0.2 })
eq('toBBox 0-1 array', toBBox([0.1, 0.2, 0.3, 0.4]), { x: 0.2, y: 0.1, w: 0.2, h: 0.2 })
eq('toBBox {box_2d}', toBBox({ box_2d: [500, 250, 750, 500] }), { x: 0.25, y: 0.5, w: 0.25, h: 0.25 })
eq('toBBox {bbox:[x,y,w,h]} 0-1', toBBox({ bbox: [0.1, 0.2, 0.3, 0.4] }), { x: 0.1, y: 0.2, w: 0.3, h: 0.4 })
eq('toBBox {ymin..} keys', toBBox({ ymin: 0.1, xmin: 0.2, ymax: 0.3, xmax: 0.4 }), { x: 0.2, y: 0.1, w: 0.2, h: 0.2 })
eq('toBBox clips overflow', toBBox([900, 900, 1200, 1100]), { x: 0.9, y: 0.9, w: 0.1, h: 0.1 })
eq('toBBox degenerate → undefined', toBBox([500, 500, 500, 500]), undefined)
eq('toBBox null → undefined', toBBox(null), undefined)

// ---- sortBySeverity / deriveUrgency ----------------------------------------------
const f = (title: string, severity: Finding['severity'], confidence = 0.5): Finding => ({ id: title, title, description: '', severity, confidence, location: '' })
eq('sortBySeverity order', sortBySeverity([f('n', 'normal'), f('m', 'minor'), f('c', 'critical'), f('s', 'significant'), f('o', 'moderate')]).map((x) => x.title), ['c', 's', 'o', 'm', 'n'])
eq('sortBySeverity ties by confidence', sortBySeverity([f('lo', 'moderate', 0.3), f('hi', 'moderate', 0.9)]).map((x) => x.title), ['hi', 'lo'])
eq('deriveUrgency critical', deriveUrgency([f('a', 'minor'), f('b', 'critical')]), 'urgent')
eq('deriveUrgency significant', deriveUrgency([f('a', 'significant')]), 'priority')
eq('deriveUrgency moderate', deriveUrgency([f('a', 'moderate')]), 'routine')
eq('deriveUrgency empty', deriveUrgency([]), 'routine')

console.log(`\nlib tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
