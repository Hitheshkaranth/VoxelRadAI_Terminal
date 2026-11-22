// End-to-end hands-free dictation test (macOS): real Chrome (headless), a fake microphone playing speech synthesised
// with `say`, and the app's real pause detection, clip upload, command parsing, editor and guideline helper.
//
//   npm run e2e:dictation            Sarvam stubbed: each clip is answered with the words spoken in it.
//   SARVAM_API_KEY=… npm run e2e:dictation
//                                    Real Sarvam: clips go through the server's own transcribe() (server/src/speech.mjs).
//                                    The key may also sit in a git-ignored .env at the repo root. It is never printed.
//
// Needs Google Chrome, `say` and `afconvert` (macOS). Starts its own Vite dev server on a spare port.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const APP = new URL('..', import.meta.url).pathname
const ROOT = new URL('../..', import.meta.url).pathname
const PORT = 5199
const BASE = `http://localhost:${PORT}`
const IMAGE = join(ROOT, 'sample-xrays/Pneumonia_x-ray.jpg')

function sarvamKey() {
  if (process.env.SARVAM_API_KEY) return process.env.SARVAM_API_KEY
  const env = join(ROOT, '.env')
  if (!existsSync(env)) return ''
  const line = readFileSync(env, 'utf8').split('\n').find((l) => /^\s*SARVAM_API_KEY\s*=/.test(l))
  return line ? line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') : ''
}
const KEY = sarvamKey()
const REAL = Boolean(KEY)

// ---- Audio: each phrase spoken by `say`, separated by pauses longer than the app's 900 ms end-of-phrase gap ----
const work = mkdtempSync(join(tmpdir(), 'voxelrad-e2e-'))
const RATE = 48000
function pcm(text, name) {
  execFileSync('say', ['-v', 'Samantha', '-r', '170', '-o', join(work, `${name}.aiff`), text])
  execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${RATE}`, '-c', '1', join(work, `${name}.aiff`), join(work, `${name}.wav`)])
  const wav = readFileSync(join(work, `${name}.wav`))
  for (let i = 12; i < wav.length - 8;) { // walk the RIFF chunks to the samples
    const size = wav.readUInt32LE(i + 4)
    if (wav.toString('ascii', i, i + 4) === 'data') return wav.subarray(i + 8, i + 8 + size)
    i += 8 + size + (size % 2)
  }
  throw new Error('No audio data from afconvert.')
}
function track(file, phrases) {
  const silence = (s) => Buffer.alloc(Math.round(RATE * s) * 2)
  const data = Buffer.concat([silence(2), ...phrases.flatMap((text, i) => [pcm(text, `${file}-${i}`), silence(3.5)])])
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40)
  const path = join(work, `${file}.wav`)
  writeFileSync(path, Buffer.concat([header, data]))
  return path
}

// What is spoken, and what the stub answers for each clip.
const MAIN = [
  ['There is an eight by six millimetre solid nodule in the right upper lobe. Full stop.', 'There is an 8 by 6 mm solid nodule in the right upper lobe full stop.'],
  ['Open guideline.', 'Open guideline.'],
  ['Insert guideline.', 'Insert guideline.'],
  ['No pleural effusion. Full stop.', 'No pleural effusion full stop.'],
  ['Stop dictation.', 'Stop dictation.'],
]
const NEGATIVE = [['Insert guideline.', 'Insert guideline.'], ['Stop dictation.', 'Stop dictation.']]

// ---- Vite ---------------------------------------------------------------------------------------------------------
const vite = spawn(process.execPath, [join(APP, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'] })
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Vite did not start.')), 30000)
  vite.stdout.on('data', (d) => { if (String(d).includes('Local:')) { clearTimeout(timer); resolve() } })
  if (process.env.E2E_DEBUG) { vite.stdout.on('data', (d) => process.stdout.write(`[vite] ${d}`)); vite.stderr.on('data', (d) => process.stdout.write(`[vite!] ${d}`)) }
  vite.on('exit', (code) => reject(new Error(`Vite exited (${code}). Is port ${PORT} in use?`)))
})

// Warm-up: on a cold start Vite pre-bundles dependencies and reloads, which breaks the first page's lazy imports.
{
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage()
  for (const path of ['/workspace', '/demo', '/workspace']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }).catch(() => {})
    await page.waitForTimeout(1500)
  }
  await browser.close()
}

const t0 = Date.now()
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`
let transcribeReal
if (REAL) {
  const speech = await import(join(ROOT, 'server/src/speech.mjs'))
  transcribeReal = async (data) => (await speech.transcribe(speech.parseSpeechRequest(data), { apiKey: KEY })).transcript
}

/** A browser whose microphone plays `wav`; /api/speech answers from `answers` (stub) or Sarvam (real). */
async function session(wav, answers) {
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
  })
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, permissions: ['microphone'] })).newPage()
  page.on('pageerror', (e) => console.log(ts(), 'PAGE ERROR', e.message))
  if (process.env.E2E_DEBUG) page.on('requestfailed', (r) => console.log(ts(), 'REQUEST FAILED', r.url(), r.failure()?.errorText))
  if (process.env.E2E_DEBUG) page.on('response', (r) => { if (r.status() >= 400) console.log(ts(), 'HTTP', r.status(), r.url()) })
  const clips = []
  await page.route('**/api/speech/status', (r) => r.fulfill({ json: { configured: true } }))
  await page.route('**/api/speech/transcribe', async (r) => {
    const data = r.request().postDataJSON()
    let transcript
    try { transcript = REAL ? await transcribeReal(data) : answers[clips.length] ?? '' }
    catch (error) { console.log(ts(), 'SARVAM ERROR', error.message); return r.fulfill({ status: error.status ?? 502, json: { error: error.message } }) }
    clips.push(transcript)
    console.log(ts(), `clip ${clips.length} (${Math.round(data.audio.length * 0.75 / 1024)} KB ${data.mime}) -> "${transcript}"`)
    if (!REAL) await new Promise((res) => setTimeout(res, 400))
    await r.fulfill({ json: { transcript } })
  })
  return { browser, page, clips }
}

async function ctStudyWithChestTemplate(page) {
  await page.goto(`${BASE}/workspace`, { waitUntil: 'networkidle' })
  const create = page.locator('button:visible', { hasText: 'Create study' }).first()
  if (!await create.isVisible({ timeout: 8000 }).catch(() => false)) await page.reload({ waitUntil: 'networkidle' })
  await create.click()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('button:visible, label:visible', { hasText: 'Choose Files' }).first().click()])
  await chooser.setFiles(IMAGE)
  await page.getByLabel('Image type').selectOption('CT')
  await page.getByLabel('Show findings and report').click()
  await page.getByRole('tab', { name: /^Report/ }).first().click()
  await page.locator('button:visible', { hasText: 'Start from exam template' }).click()
  await page.locator('button:visible', { hasText: /^CT chest/ }).first().click()
}
const editor = (page, key) => page.locator(`#report-${key} [contenteditable]`).first()
const sectionText = async (page, key) => (await editor(page, key).innerText()).replace(/\s+/g, ' ').trim()
const chips = (page) => page.locator('.gh-suggest .gh-chip').allInnerTexts()
const micOff = async (page) => /Hands-free dictation/.test(await page.locator('.dict-actions button').first().innerText())

/** Wait until "stop dictation" turned the microphone off, calling `each` while waiting. */
async function untilStopped(page, clips, expected, each = async () => {}) {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    await each()
    if (clips.length >= expected && await micOff(page)) return
    await page.waitForTimeout(250)
  }
  throw new Error(`Dictation did not finish: ${clips.length}/${expected} clips.`)
}

let failed = false
try {
  console.log(`Sarvam: ${REAL ? 'REAL (server transcribe())' : 'stubbed'}\n`)

  // 1. Hands-free: dictate a nodule, open the pre-filled Fleischner helper, insert it, keep dictating, stop.
  console.log('== Hands-free: nodule -> open guideline -> insert guideline -> more text -> stop')
  {
    const { browser, page, clips } = await session(track('main', MAIN.map(([said]) => said)), MAIN.map(([, heard]) => heard))
    await ctStudyWithChestTemplate(page)
    assert.deepEqual(await chips(page), [], 'the normal CT chest template ("no suspicious pulmonary nodule") suggests nothing')
    await editor(page, 'findings').click()
    await page.keyboard.press('Meta+ArrowDown')
    const before = await sectionText(page, 'findings')
    await page.locator('button:visible', { hasText: 'Hands-free dictation' }).click()
    let chipSeen = null, helper = null
    await untilStopped(page, clips, MAIN.length, async () => {
      const c = await chips(page)
      if (c.length && !chipSeen) { chipSeen = c[0]; console.log(ts(), 'chip:', chipSeen) }
      if (!helper && await page.locator('.gh-popover').isVisible().catch(() => false)) {
        await page.waitForTimeout(150)
        const box = await page.locator('.gh-popover').boundingBox()
        const insert = await page.locator('.gh-popover button', { hasText: 'Insert into Recommendations' }).boundingBox()
        helper = {
          size: await page.locator('.gh-popover input[inputmode=decimal]').first().inputValue(),
          type: await page.locator('.gh-popover select').nth(1).inputValue(),
          from: (await page.locator('.gh-from').innerText()).replace(/\s+/g, ' '),
          onScreen: !!box && box.y >= 0 && !!insert && insert.y + insert.height <= 1000,
        }
        console.log(ts(), 'helper open:', JSON.stringify(helper))
      }
    })
    const added = (await sectionText(page, 'findings')).slice(before.length).trim()
    const recommendations = await sectionText(page, 'recommendations')
    console.log(ts(), 'findings added:', JSON.stringify(added))
    console.log(ts(), 'recommendations:', JSON.stringify(recommendations))
    assert.equal(clips.length, MAIN.length, 'one clip per spoken phrase')
    assert.match(added, /^There is an 8 x 6 mm solid nodule in the right upper lobe\./i)
    assert.match(added, /No pleural effusion\.?$/i, 'text dictated after the guideline commands lands at the end of Findings')
    assert.doesNotMatch(added, /guideline|stop dictation/i, 'commands are not typed as text')
    assert.equal(chipSeen, 'Fleischner · solid nodule, 7 mm')
    assert.ok(helper, '"open guideline" opened the helper')
    assert.deepEqual([helper.size, helper.type], ['7', 'solid'], 'pre-filled from the dictated sentence (mean of 8 and 6 mm)')
    assert.match(helper.from, /8 x 6 mm solid nodule in the right upper lobe/)
    assert.equal(helper.onScreen, true, 'the pre-filled helper is visible when opened by voice')
    assert.match(recommendations, /^Single solid nodule 6-8 mm, low-risk patient: CT at 6-12 months, then consider CT at 18-24 months \(Fleischner Society 2017\)\.$/)
    assert.deepEqual(await chips(page), [], 'the applied suggestion disappears')
    assert.equal(await page.evaluate(() => document.activeElement?.closest('[id^=report-]')?.id), 'report-findings', 'focus is back in Findings')
    console.log('PASS\n')
    await browser.close()
  }

  // 2. "insert guideline" without opening the helper first inserts nothing.
  console.log('== Hands-free: "insert guideline" with the helper closed')
  {
    const { browser, page, clips } = await session(track('negative', NEGATIVE.map(([said]) => said)), NEGATIVE.map(([, heard]) => heard))
    await ctStudyWithChestTemplate(page)
    await editor(page, 'findings').click()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type(' Left adrenal nodule 2.1 cm, 8 HU on unenhanced images.')
    assert.deepEqual(await chips(page), ['Adrenal · 2.1 cm, 8 HU unenhanced'], 'typed findings are suggested too')
    await page.locator('button:visible', { hasText: 'Hands-free dictation' }).click()
    const messages = new Set()
    await untilStopped(page, clips, NEGATIVE.length, async () => {
      for (const t of await page.locator('[role=status], [role=alert]').allInnerTexts()) if (/open guideline” first/.test(t)) messages.add(t.trim())
    })
    console.log(ts(), 'told:', [...messages])
    assert.equal(await sectionText(page, 'recommendations'), '', 'nothing inserted before the reader has seen the values')
    assert.ok(messages.size, 'the reader is told to open the guideline first')
    assert.deepEqual(await chips(page), ['Adrenal · 2.1 cm, 8 HU unenhanced'], 'the suggestion is still offered')
    console.log('PASS\n')

    // 3. Chest radiograph: Fleischner is for CT nodules, so nothing is suggested.
    console.log('== Chest X-ray demo: a lung nodule on a radiograph')
    await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /Diffuse nodules/ }).first().click()
    await page.getByRole('tab', { name: /^Report/ }).first().click()
    await page.locator('.rp-panel button:visible', { hasText: 'Exam template' }).click()
    await page.locator('button:visible', { hasText: /^X-ray chest PA/ }).first().click()
    await editor(page, 'findings').click()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type(' There is an 8 mm solid nodule in the right upper lobe.')
    assert.match(await sectionText(page, 'findings'), /8 mm solid nodule in the right upper lobe\.$/)
    assert.deepEqual(await chips(page), [], 'no Fleischner suggestion on a chest radiograph')
    console.log('PASS\n')
    await browser.close()
  }
  console.log(`All dictation e2e checks passed (Sarvam ${REAL ? 'real' : 'stubbed'}).`)
} catch (error) {
  failed = true
  console.error('\nFAILED:', error.message)
} finally {
  vite.kill()
  rmSync(work, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
