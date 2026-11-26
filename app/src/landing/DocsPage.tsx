import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Copy } from 'lucide-react'
import { PageHead, Shell, usePageMeta } from './Pages'
import { Pill } from './ui'
import { MODEL_DISCLAIMER } from '../lib/openModels'
import { SKANDA_ANALYSIS_PROMPT, SKANDA_SYSTEM_PROMPT } from '../lib/prompts'
import { V1_CONFIRMATORY } from '../lib/skandaV1'
import './skanda-landing.css'
import './docs.css'

// Every fact on this page is read from the code that serves Skanda V1 today:
// server/src/publicApi.mjs, apiKeys.mjs and webhook.mjs (the /api/v1 contract, keys, limits, errors, async reads, webhooks),
// server/src/modelProxy.mjs (upstream errors, timeouts, body size), deploy/huggingface/space_app.py (queue, max_tokens),
// lib/prompts.ts (request), lib/parse.ts + types.ts (result) and lib/skandaSlice.ts (CT/MRI input).

const [secXray, secCt, secMri, secAll] = V1_CONFIRMATORY.secondsPerRead
const s = (n: number) => `${n.toFixed(1)} s`
const BASE = 'https://radgenie.com/api/v1'

const toc = [
  ['overview', 'Overview'],
  ['access', 'Access and keys'],
  ['endpoints', 'Endpoints'],
  ['request', 'Request body'],
  ['inputs', 'Supported inputs'],
  ['responses', 'JSON or streaming'],
  ['async', 'Async reads'],
  ['webhooks', 'Webhooks'],
  ['response', 'Report format'],
  ['errors', 'Errors'],
  ['limits', 'Limits and capacity'],
  ['examples', 'Code examples'],
  ['integration', 'Reporting integration'],
  ['privacy', 'Data handling'],
  ['limitations', 'Regulatory status'],
] as const

// ---------------------------------------------------------------- code blocks

/** A small tokenizer for strings, comments, numbers and keywords; enough to make examples scannable without a library. */
const TOKEN = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`|(?:^|(?<=\s))#[^\n]*|\/\/[^\n]*|\b\d+(?:\.\d+)?\b|\b(?:const|let|await|async|import|from|for|of|if|else|return|throw|new|while|break|continue|def|with|as|in|not|raise|true|false|null|None|True|False)\b|\$[A-Z_]+)/g
function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of code.matchAll(TOKEN)) {
    const t = m[0]
    const i = m.index ?? 0
    if (i > last) out.push(code.slice(last, i))
    const kind = /^["'`]/.test(t) ? (code[i + t.length] === ':' || /^\s*:/.test(code.slice(i + t.length, i + t.length + 2)) ? 'k' : 's')
      : /^(#|\/\/)/.test(t) ? 'c' : /^\d/.test(t) ? 'n' : t.startsWith('$') ? 'v' : 'w'
    out.push(<span key={i} className={`sk-tk-${kind}`}>{t}</span>)
    last = i + t.length
  }
  if (last < code.length) out.push(code.slice(last))
  return out
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return <button type="button" className="sk-code-copy" data-done={copied} aria-label={copied ? 'Copied' : `Copy ${label}`} onClick={async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* clipboard blocked: the code stays selectable */ }
  }}>{copied ? <Check size={14} /> : <Copy size={14} />}<span>{copied ? 'Copied' : 'Copy'}</span></button>
}

function Code({ code, label, title }: { code: string; label: string; title?: string }) {
  return <figure className="sk-code">
    <figcaption className="sk-code-bar"><span className="sk-code-title">{title ?? label}</span><CopyButton text={code} label={label} /></figcaption>
    <pre tabIndex={0} aria-label={label}><code>{highlight(code)}</code></pre>
  </figure>
}

function CodeTabs({ tabs, label }: { tabs: { name: string; code: string }[]; label: string }) {
  const [active, setActive] = useState(0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const id = label.replace(/\W+/g, '-').toLowerCase()
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (active + step + tabs.length) % tabs.length
    setActive(next)
    refs.current[next]?.focus()
  }
  return <figure className="sk-code">
    <div className="sk-code-bar">
      <div className="sk-code-tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
        {tabs.map((t, i) => <button key={t.name} ref={(el) => { refs.current[i] = el }} role="tab" id={`${id}-tab-${i}`} aria-controls={`${id}-panel`} aria-selected={i === active} tabIndex={i === active ? 0 : -1} onClick={() => setActive(i)}>{t.name}</button>)}
      </div>
      <CopyButton text={tabs[active].code} label={`${tabs[active].name} example`} />
    </div>
    <pre role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${active}`} tabIndex={0}><code>{highlight(tabs[active].code)}</code></pre>
  </figure>
}

/** One table row; a call keeps row cells out of a JSX array literal. */
const r = (...cells: ReactNode[]) => cells

function Table({ head, rows, caption }: { head: string[]; rows: ReactNode[][]; caption: string }) {
  return <div className="sk-docs-table" role="region" aria-label={caption} tabIndex={0}>
    <table><caption className="sk-sr">{caption}</caption>
      <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>)}</tr>)}</tbody>
    </table>
  </div>
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={id} className="sk-docs-section" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}><a href={`#${id}`}>{title}</a></h2>
    {children}
  </section>
}

// ---------------------------------------------------------------- examples

// Pretty JSON with short number arrays (boxes, spacing) kept on one line.
const json = (v: unknown) => JSON.stringify(v, null, 2).replace(/\[\s+(-?[\d.]+(?:,\s+-?[\d.]+)*)\s+\]/g, (_, nums: string) => `[${nums.split(/,\s+/).join(', ')}]`)

const requestBody = json({
  model: 'skanda-v1',
  temperature: 0,
  max_tokens: 1024,
  messages: [
    { role: 'system', content: 'You are Skanda, a radiology assistant that drafts findings for a radiologist to review. …' },
    { role: 'user', content: [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA…' } },
      { type: 'text', text: SKANDA_ANALYSIS_PROMPT },
    ] },
  ],
})

const ctBody = json({
  model: 'skanda-v1',
  messages: [
    { role: 'system', content: 'You are Skanda, …' },
    { role: 'user', content: [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,…  (R/G/B = lung / soft-tissue / bone window)' } },
      { type: 'text', text: 'Read this axial slice of an abdomen CT. Reply as JSON: normal, findings (title, evidence, location, severity, mask), impression.' },
    ] },
  ],
  skanda: { modality: 'ct', body: 'Liver', pixel_spacing: [0.78, 0.78], composite: true, hu: { b64: 'AAD+/wEA…  (int16 little-endian, row-major)', width: 512, height: 512 } },
})

const modelsExample = json({ object: 'list', data: [{ id: 'skanda-v1', object: 'model', owned_by: 'voxelrad' }] })

const completionExample = json({
  id: 'chatcmpl-3f9c…',
  object: 'chat.completion',
  created: 1763548800,
  model: 'skanda-v1',
  choices: [{ index: 0, message: { role: 'assistant', content: '{"modality": "X-ray", "bodyPart": "Chest", "findings": [ … ], "impression": "…"}' }, finish_reason: 'stop' }],
})

const sseExample = `: queued

: queued

data: {"id":"chatcmpl-3f9c…","object":"chat.completion.chunk","model":"skanda-v1","choices":[{"index":0,"delta":{"content":"{\\"modality\\": \\"X-ray\\", \\"findings\\": [ … ]}"},"finish_reason":"stop"}]}

data: [DONE]`

const sseError = `data: {"error":{"message":"ZeroGPU read failed or quota exhausted. ZeroGPU read timed out after 180 seconds without a completed result. The pending request was cancelled. No findings were generated."}}

data: [DONE]`

const streamPython = `with requests.post(f"{API}/chat/completions", json={**body, "stream": True}, stream=True,
                   timeout=(30, 300), headers={"Authorization": f"Bearer {KEY}"}) as r:
    r.raise_for_status()
    text, finish = "", None
    for line in r.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data:"):
            continue                          # blank separators and ": queued" heartbeats
        data = line[5:].strip()
        if data == "[DONE]":
            break
        event = json.loads(data)
        if "error" in event:                  # errors after the 200 arrive inside the stream
            raise RuntimeError(event["error"]["message"])
        choice = event["choices"][0]
        text += choice["delta"].get("content") or ""
        finish = choice.get("finish_reason") or finish`

const readQueued = json({
  id: '5b0e8c1a-…',
  object: 'read',
  status: 'queued',
  model: 'skanda-v1',
  created_at: '2026-11-19T09:30:00.000Z',
  started_at: null,
  finished_at: null,
  expires_at: '2026-11-20T09:30:00.000Z',
  poll_url: `${BASE}/reads/5b0e8c1a-…`,
  result: null,
  error: null,
})

const readDone = json({
  id: '5b0e8c1a-…',
  object: 'read',
  status: 'succeeded',
  model: 'skanda-v1',
  created_at: '2026-11-19T09:30:00.000Z',
  started_at: '2026-11-19T09:30:00.412Z',
  finished_at: '2026-11-19T09:30:41.906Z',
  expires_at: '2026-11-20T09:30:00.000Z',
  poll_url: `${BASE}/reads/5b0e8c1a-…`,
  result: { content: '{"modality": "X-ray", "findings": [ … ], "impression": "…"}', report: { modality: 'X-ray', findings: ['…'], impression: '…' }, finish_reason: 'stop', model: 'skanda-v1' },
  error: null,
})

const asyncCurl = `# Submit: the same body as /chat/completions ("stream" is ignored), plus an optional webhook_url.
curl -si ${BASE}/reads \\
  -H "Authorization: Bearer $RADGENIE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: batch-0007-image-042" \\
  --data-binary @read.json
# → 202 Accepted, Location: ${BASE}/reads/{id}

# Poll until status is succeeded, failed or cancelled
curl -s ${BASE}/reads/$READ_ID -H "Authorization: Bearer $RADGENIE_API_KEY"

# Cancel a queued or running read
curl -s -X DELETE ${BASE}/reads/$READ_ID -H "Authorization: Bearer $RADGENIE_API_KEY"`

const asyncPython = `import os, time, requests

API = "${BASE}"
HEADERS = {"Authorization": f"Bearer {os.environ['RADGENIE_API_KEY']}"}

def submit_and_wait(body: dict, idempotency_key: str) -> dict:
    r = requests.post(f"{API}/reads", json=body, timeout=30,
                      headers={**HEADERS, "Idempotency-Key": idempotency_key})
    r.raise_for_status()                      # 202 for a new read, 200 for a replay of the same request
    read = r.json()
    while read["status"] in ("queued", "running"):
        time.sleep(5)
        read = requests.get(read["poll_url"], headers=HEADERS, timeout=30).json()
    if read["status"] != "succeeded":
        raise RuntimeError(read["error"] or read["status"])
    return read["result"]["report"]           # None when the content was not valid JSON`

const webhookBody = json({ id: '5b0e8c1a-…', status: 'succeeded', result: { content: '…', report: { findings: ['…'] }, finish_reason: 'stop', model: 'skanda-v1' } })

const verifyPython = `import hashlib, hmac, os, time

SECRET = os.environ["RADGENIE_WEBHOOK_SECRET"]   # whsec_…, shown once when your key was issued
TOLERANCE = 300                                   # seconds: refuse deliveries signed more than 5 minutes ago

def verify(raw_body: bytes, timestamp: str, signature: str) -> bool:
    """Check X-VoxelRad-Timestamp and X-VoxelRad-Signature against the raw body, before parsing it."""
    if not (timestamp or "").isdigit() or abs(time.time() - int(timestamp)) > TOLERANCE:
        return False
    signed = timestamp.encode("ascii") + b"." + raw_body
    expected = "sha256=" + hmac.new(SECRET.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")

# Flask: verify(request.get_data(), request.headers.get("X-VoxelRad-Timestamp"),
#               request.headers.get("X-VoxelRad-Signature"))`

const verifyNode = `import { createHmac, timingSafeEqual } from 'node:crypto'

const SECRET = process.env.RADGENIE_WEBHOOK_SECRET   // whsec_…, shown once when your key was issued
const TOLERANCE_S = 300                               // refuse deliveries signed more than 5 minutes ago

/** Check X-VoxelRad-Timestamp and X-VoxelRad-Signature against the raw body (a Buffer), before parsing it. */
export function verify(rawBody, timestamp, signature) {
  if (!/^\\d+$/.test(timestamp ?? '') || Math.abs(Date.now() / 1000 - Number(timestamp)) > TOLERANCE_S) return false
  const expected = Buffer.from('sha256=' + createHmac('sha256', SECRET).update(\`\${timestamp}.\`).update(rawBody).digest('hex'))
  const received = Buffer.from(signature ?? '')
  return received.length === expected.length && timingSafeEqual(received, expected)
}

// Express: app.post('/radgenie-webhook', express.raw({ type: 'application/json' }), (req, res) => {
//   if (!verify(req.body, req.get('X-VoxelRad-Timestamp'), req.get('X-VoxelRad-Signature'))) return res.sendStatus(401)
//   res.sendStatus(204)   // answer fast with a 2xx; do the work after
// })`

const errorExample = json({ error: { message: 'Daily limit reached: 20 reads per day for this test key. The limit resets at 00:00 UTC.', type: 'rate_limit_error', code: 'daily_limit_reached' } })

const responseExample = json({
  modality: 'X-ray',
  bodyPart: 'Chest',
  view: '',
  imageQuality: 'adequate',
  findings: [
    {
      title: 'Left lower zone pleural effusion',
      description: "Dependent opacity with a meniscus, blunting the left costophrenic angle, in the patient's left lower zone.",
      severity: 'significant',
      confidence: 0.97,
      location: 'left lower zone',
      category: '',
      recommendation: '',
      box_2d: [395, 691, 707, 820],
      mask_png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA…',
    },
  ],
  pertinentNegatives: [],
  impression: 'Left lower zone pleural effusion.',
  recommendations: [],
  differential: [],
  model: 'skanda',
})

const measuredExample = json({
  title: 'Right liver lesion',
  description: 'Hypoattenuating lesion in the right lobe of the liver. Measured from the outline: about 41 mm across on this slice (area 766 mm²).',
  severity: 'significant',
  location: 'right liver',
  box_2d: [402, 188, 486, 266],
  mask_png: 'data:image/png;base64,…',
  measurements: { source: 'outline', diameter_mm: 41, area_mm2: 766, mean_hu: 38, surround_hu: 61, parts: 1 },
})

const sysPy = SKANDA_SYSTEM_PROMPT.replace(/"/g, '\\"')
const sysSh = SKANDA_SYSTEM_PROMPT.replace(/"/g, '\\"')

const curlExample = `export RADGENIE_API_KEY="vr_test_…"   # issued to your organisation; keep it server-side

# 1. Check the key and the model (does not count as a read)
curl -s ${BASE}/models -H "Authorization: Bearer $RADGENIE_API_KEY"

# 2. Read one de-identified chest X-ray (PNG or JPEG) and print the report JSON
IMG=$(base64 < chest.png | tr -d '\\n')
curl -s --max-time 300 ${BASE}/chat/completions \\
  -H "Authorization: Bearer $RADGENIE_API_KEY" \\
  -H "Content-Type: application/json" \\
  --data-binary @- <<EOF | jq -r '.choices[0].message.content' | jq .
{
  "model": "skanda-v1",
  "temperature": 0,
  "max_tokens": 1024,
  "messages": [
    {"role": "system", "content": "${sysSh}"},
    {"role": "user", "content": [
      {"type": "image_url", "image_url": {"url": "data:image/png;base64,$IMG"}},
      {"type": "text", "text": "${SKANDA_ANALYSIS_PROMPT}"}
    ]}
  ]
}
EOF`

const pythonExample = `import base64, json, os, requests

API = "${BASE}"
KEY = os.environ["RADGENIE_API_KEY"]   # vr_live_… or vr_test_…

SYSTEM = "${sysPy}"
PROMPT = "${SKANDA_ANALYSIS_PROMPT}"

def read_chest_xray(path: str) -> dict:
    image = base64.b64encode(open(path, "rb").read()).decode()
    body = {
        "model": "skanda-v1", "temperature": 0, "max_tokens": 1024,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image}"}},
                {"type": "text", "text": PROMPT},
            ]},
        ],
    }
    r = requests.post(f"{API}/chat/completions", json=body, timeout=(30, 300),
                      headers={"Authorization": f"Bearer {KEY}"})
    if r.status_code != 200:
        try: error = r.json()["error"]
        except Exception: error = {"code": None, "message": r.text[:300]}
        raise RuntimeError(f"HTTP {r.status_code} {error['code']}: {error['message']}")
    choice = r.json()["choices"][0]
    if choice["finish_reason"] == "length":
        raise RuntimeError("Output hit max_tokens; the findings may be incomplete.")
    return json.loads(choice["message"]["content"])   # candidate findings for a radiologist to review`

const openaiExample = `import base64, json, os
from openai import OpenAI

client = OpenAI(base_url="${BASE}",
                api_key=os.environ["RADGENIE_API_KEY"],   # vr_live_… or vr_test_…
                timeout=300,
                max_retries=0)    # a retried read can count again; handle 429 and Retry-After yourself

image = base64.b64encode(open("chest.png", "rb").read()).decode()
completion = client.chat.completions.create(
    model="skanda-v1",
    temperature=0,
    max_tokens=1024,
    messages=[
        {"role": "system", "content": "${sysPy}"},
        {"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image}"}},
            {"type": "text", "text": "${SKANDA_ANALYSIS_PROMPT}"},
        ]},
    ],
    # CT or MRI: extra_body={"skanda": {"modality": "ct", ...}}
)
choice = completion.choices[0]
if choice.finish_reason == "length":
    raise RuntimeError("Output hit max_tokens; the findings may be incomplete.")
report = json.loads(choice.message.content)`

const jsExample = `// Server-side only (Node 18+): the API sends no CORS headers, and the key must never reach a browser.
const API = '${BASE}'
const KEY = process.env.RADGENIE_API_KEY   // vr_live_… or vr_test_…

const SYSTEM = ${JSON.stringify(SKANDA_SYSTEM_PROMPT)}
const PROMPT = ${JSON.stringify(SKANDA_ANALYSIS_PROMPT)}

export async function readChestXray(pngBase64, signal) {
  const res = await fetch(\`\${API}/chat/completions\`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${KEY}\` },
    body: JSON.stringify({
      model: 'skanda-v1', temperature: 0, max_tokens: 1024,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: \`data:image/png;base64,\${pngBase64}\` } },
          { type: 'text', text: PROMPT },
        ] },
      ],
    }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(\`HTTP \${res.status} \${body?.error?.code ?? ''}: \${body?.error?.message ?? res.statusText}\`)
  const choice = body.choices[0]
  if (choice.finish_reason === 'length') throw new Error('Output hit max_tokens; findings may be incomplete.')
  return JSON.parse(choice.message.content)   // candidate findings for a radiologist to review
}`

const bboxExample = `// box_2d is [ymin, xmin, ymax, xmax] on a 0–1000 grid, origin top-left.
// The RadGenie workspace stores it as a box normalised to 0..1:
const [ymin, xmin, ymax, xmax] = finding.box_2d.map((v) => v / 1000)
const bbox = { x: xmin, y: ymin, w: xmax - xmin, h: ymax - ymin }

// Urgency is not returned; the workspace derives it from the worst severity:
const urgency = findings.some((f) => f.severity === 'critical') ? 'urgent'
  : findings.some((f) => f.severity === 'significant') ? 'priority' : 'routine'`

// ---------------------------------------------------------------- page

function Toc() {
  const [active, setActive] = useState<string>(toc[0][0])
  const details = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    // Open on wide screens, collapsed into a disclosure on narrow ones.
    const mq = matchMedia('(min-width: 1025px)')
    const sync = () => { if (details.current) details.current.open = mq.matches }
    sync()
    mq.addEventListener('change', sync)
    let frame = 0
    const update = () => {
      frame = 0
      let current: string = toc[0][0]
      for (const [id] of toc) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= innerHeight * 0.3) current = id
      }
      setActive(current)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    addEventListener('scroll', onScroll, { passive: true })
    return () => { mq.removeEventListener('change', sync); removeEventListener('scroll', onScroll); cancelAnimationFrame(frame) }
  }, [])
  const close = () => { if (details.current && !matchMedia('(min-width: 1025px)').matches) details.current.open = false }
  return <aside className="sk-docs-aside">
    <details ref={details} className="sk-docs-toc">
      <summary>On this page<ChevronDown size={16} aria-hidden="true" /></summary>
      <nav aria-label="On this page"><ol>{toc.map(([id, label]) => <li key={id}><a href={`#${id}`} aria-current={id === active ? 'location' : undefined} onClick={close}>{label}</a></li>)}</ol></nav>
    </details>
    <a className="sk-docs-aside-cta" href="/#access">Request API access <ArrowRight size={14} /></a>
  </aside>
}

const M = ({ children }: { children: ReactNode }) => <code className="sk-ic">{children}</code>

export function DocsPage() {
  usePageMeta('Developer docs · Connect Skanda V1 to your software · RadGenie', 'How to call Skanda V1 at radgenie.com/api/v1 with an organisation API key: OpenAI-compatible chat completions as plain JSON or a stream, async reads with signed webhooks, errors, limits, data handling and regulatory status.')
  return <Shell>
    <PageHead eyebrow="Docs" title={<>Connect <em>Skanda V1</em></>} lead="Send a de-identified X-ray, CT or MRI image to Skanda V1 from your own application or reporting software, and get back a structured draft: candidate findings with outlines, measurements and an impression, for a radiologist to review. For research, evaluation and supervised pilots.">
      <div className="sk-docs-access">
        <div>
          <h2>API keys are issued by request</h2>
          <p>There is no self-serve signup. RadGenie issues keys per organisation after reviewing each request by hand, starting with a sandbox test key. Examples on this page read the key from <M>$RADGENIE_API_KEY</M>.</p>
        </div>
        <div className="sk-actions sk-actions-left"><Pill href="/#access">Request API access</Pill><Pill href="/demo" tone="ghost">Try the demo</Pill></div>
      </div>
    </PageHead>

    <div className="sk-wrap sk-docs">
      <Toc />
      <article className="sk-docs-body">
        <Section id="overview" title="Overview">
          <p>Skanda V1 is the model the hosted RadGenie workspace serves. The API at <M>{BASE}</M> speaks the OpenAI-compatible chat completions format: you send one image and a short prompt, and it answers with a single JSON report describing what it sees, where, and how large it is.</p>
          <p>Treat every finding it returns as a <strong>candidate</strong>. In the workspace a radiologist accepts or dismisses each one, and only reviewed findings are drafted into the report. Your integration should keep the same order of events:</p>
          <ol className="sk-steps sk-docs-flow">
            <li><b>A study arrives.</b> Your system de-identifies the image and renders it to PNG or JPEG.</li>
            <li><b>Skanda reads it.</b> One request per image, or per axial slice for CT and MRI.</li>
            <li><b>A radiologist reviews.</b> Candidates appear with their outlines over the source image, clearly marked as AI output.</li>
            <li><b>Only reviewed text is kept.</b> Accepted findings become draft wording the radiologist edits and signs off within your research or pilot protocol.</li>
          </ol>
          <div className="sk-docs-note"><b>Not a cleared medical device.</b> Skanda has no regulatory clearance (for example from CDSCO in India), so integrations today are for research, evaluation and supervised pilots under a research agreement. See <a className="sk-inline-link" href="#limitations">regulatory status</a>.</div>
        </Section>

        <Section id="access" title="Access and keys">
          <p>Keys are issued per organisation, on request. Tell us who you are and what you would integrate in the <a className="sk-inline-link" href="/#access">request form</a> and mention API access. Every request is reviewed by hand; there is no self-serve signup.</p>
          <Table caption="Key types" head={['Key', 'What it is for']} rows={[
            r(<M>vr_test_…</M>, <><b>Sandbox.</b> The same Skanda V1 model with a lower cap, by default 20 reads per UTC day. De-identified images only, for building and testing your integration. Not for clinical use.</>),
            r(<M>vr_live_…</M>, <><b>Evaluation and pilots.</b> By default 200 reads per UTC day, or the limit agreed for your organisation. Still research use: every finding is reviewed by a radiologist.</>),
          ]} />
          <p>Send the key as a bearer token on every request. The API reads nothing else: it ignores cookies, checks no <M>Origin</M>, and sends no CORS headers, so call it from your server, never from a browser.</p>
          <Code label="authorization header" title="Every request" code={`Authorization: Bearer vr_live_…      # or vr_test_…`} />
          <ul className="sk-docs-list">
            <li><b>Keys are shown once.</b> RadGenie stores only a hash. If a key is lost or exposed, ask us to revoke it and issue a new one; a revoked key gets <M>401 key_revoked</M>.</li>
            <li><b>A key opens only this API.</b> It cannot reach studies, sharing, administration or any other part of the RadGenie app.</li>
            <li><b>Async reads are shared within an organisation.</b> Any key of the same organisation can fetch or cancel them.</li>
          </ul>
          <p>Header names keep the <M>X-VoxelRad-</M> prefix from before the product was renamed RadGenie, so existing integrations keep working.</p>
          <Table caption="Response headers" head={['Header', 'Meaning']} rows={[
            r(<M>X-VoxelRad-Key-Kind</M>, <><M>live</M> or <M>test</M>, on every authenticated response.</>),
            r(<M>X-VoxelRad-Reads-Left</M>, 'Reads left today for this key, on responses that counted a read.'),
            r(<M>X-Request-ID</M>, 'Quote it when you contact us about a request.'),
            r(<M>Cache-Control</M>, <><M>no-store</M>.</>),
            r(<M>Retry-After</M>, <>On <M>429 daily_limit_reached</M>: seconds until 00:00 UTC, at least 60.</>),
          ]} />
        </Section>

        <Section id="endpoints" title="Endpoints">
          <p>Base URL <M>{BASE}</M>.</p>
          <div className="sk-docs-endpoints">
            <div><span className="sk-method">GET</span><M>/models</M><p>Lists the served model, live from the GPU service. A health check; it does not count as a read.</p></div>
            <div><span className="sk-method sk-method-post">POST</span><M>/chat/completions</M><p>Reads one image and returns the report as a <M>chat.completion</M>, or as a stream with <M>stream: true</M>.</p></div>
            <div><span className="sk-method sk-method-post">POST</span><M>/reads</M><p>Queues the same read and returns <M>202</M> at once. Poll it, or get a signed webhook.</p></div>
            <div><span className="sk-method">GET</span><M>/reads/{'{id}'}</M><p>Status and result of an async read, for 24 hours after it was submitted.</p></div>
            <div><span className="sk-method sk-method-delete">DELETE</span><M>/reads/{'{id}'}</M><p>Cancels a queued or running read.</p></div>
          </div>
          <Code label="GET /models response" title="GET /models · 200" code={modelsExample} />
        </Section>

        <Section id="request" title="Request body">
          <p>A read is one system message and one user message holding the image and the instruction. These are the exact prompts the RadGenie workspace sends for a chest X-ray; Skanda was trained on them, so keep them unchanged.</p>
          <Code label="chest X-ray request body" title="POST /chat/completions · chest X-ray" code={requestBody} />
          <Table caption="Request fields" head={['Field', 'Value']} rows={[
            r(<M>model</M>, <>Required: <M>"skanda-v1"</M>. A missing model is <M>400 missing_model</M>; any other name is <M>404 model_not_found</M>.</>),
            r(<M>messages</M>, <>1 to 64 messages with role <M>system</M>, <M>user</M> or <M>assistant</M>. Content is a string or a list of <M>text</M> and <M>image_url</M> parts; send the image as a base64 <M>data:image/…</M> URL.</>),
            r(<M>stream</M>, <>Optional, default <M>false</M>: one JSON response. <M>true</M> returns server-sent events (see <a className="sk-inline-link" href="#responses">JSON or streaming</a>).</>),
            r(<M>temperature</M>, <>Optional, 0 to 2. Use 0 for repeatable reads.</>),
            r(<M>max_tokens</M>, <>Optional whole number from 1 to 1536, the model service’s cap; a larger value is <M>400 invalid_max_tokens</M>. The default is 1024. A read that hits it ends with <M>finish_reason: "length"</M>.</>),
            r(<M>skanda</M>, <>CT and MRI only: modality, body part, pixel spacing and, for CT, raw HU. See <a className="sk-inline-link" href="#inputs">supported inputs</a>. Other fields are passed to the model service as they are.</>),
          ]} />
          <details className="sk-docs-more">
            <summary>Full system prompt<ChevronDown size={15} aria-hidden="true" /></summary>
            <p className="sk-docs-quote">{SKANDA_SYSTEM_PROMPT}</p>
          </details>
        </Section>

        <Section id="inputs" title="Supported inputs">
          <Table caption="Supported inputs" head={['Input', 'How to send it']} rows={[
            r('Chest X-ray', <>PNG or JPEG, one film per request. DICOM must be rendered to 8-bit pixels first. The workspace re-encodes to JPEG with the long edge at most 1024 px.</>),
            r('CT slice', <>One <b>axial</b> slice at its native pixel grid, as a PNG whose red, green and blue channels are the lung (−1350 to 150 HU), soft-tissue (−160 to 240 HU) and bone (−500 to 1300 HU) windows. Add the <M>skanda</M> field with the raw HU so sizes and densities can be measured.</>),
            r('MRI slice', <>One <b>axial</b> slice as a greyscale PNG, scaled between the 1st and 99th percentile of the volume’s positive voxels. Name the sequence. Skanda was trained on FLAIR, T1 post-contrast and T2 together; single-sequence reads are outside its training data.</>),
            r('Whole volumes', <>Sent slice by slice: one request per axial slice. There is no single-request volume upload.</>),
          ]} />
          <p>For CT and MRI the text prompt names the body region and modality, for example <M>Read this axial slice of an abdomen CT.</M>, followed by the same reply instruction as the X-ray prompt.</p>
          <Code label="CT slice request body" title="POST /chat/completions · CT slice (abridged)" code={ctBody} />
          <Table caption="The skanda field" head={['Key', 'Meaning']} rows={[
            r(<M>modality</M>, <><M>"ct"</M> or <M>"mri"</M>.</>),
            r(<M>body</M>, <>Body part, such as <M>"Liver"</M> or <M>"Brain"</M>. Never a file or patient name.</>),
            r(<M>pixel_spacing</M>, 'In-plane pixel spacing in millimetres, two numbers.'),
            r(<M>hu</M>, <>CT only: <M>{'{ b64, width, height }'}</M>, the slice’s raw Hounsfield units as little-endian int16, row-major, base64-encoded. Only send HU you know are calibrated.</>),
            r(<M>sequence</M>, 'MRI only: the sequence name, such as FLAIR or T2.'),
            r(<M>composite</M>, <><M>true</M> for the three-window CT image, <M>false</M> for greyscale MRI.</>),
          ]} />
        </Section>

        <Section id="responses" title="JSON or streaming">
          <h3>Plain JSON (<M>stream: false</M>, the default)</h3>
          <p>Recommended for most reporting software. The connection stays open while the read queues for a GPU and runs, then you get one ordinary <M>chat.completion</M>. The report is the JSON string in <M>choices[0].message.content</M>. There is no <M>usage</M> field, because the model service does not report token counts.</p>
          <Code label="chat.completion response" title="200 · application/json" code={completionExample} />
          <h3>Streaming (<M>stream: true</M>)</h3>
          <p>Returns <M>text/event-stream</M>. While the read waits, the stream carries <M>: queued</M> comment lines that keep the connection alive; ignore them. The whole report then arrives in a single <M>delta.content</M> chunk with its <M>finish_reason</M>, followed by <M>data: [DONE]</M>.</p>
          <Code label="successful event stream" title="200 · text/event-stream" code={sseExample} />
          <div className="sk-docs-note"><b>Errors can arrive after the 200.</b> Once a stream has started, a failure is sent as a <M>data: {'{"error":{"message":…}}'}</M> event and then <M>[DONE]</M>. Check every event for <M>error</M>, and treat a stream that ends without <M>[DONE]</M> or a finish reason as failed. With <M>stream: false</M> the same failures come back as normal HTTP errors.</div>
          <Code label="error inside the stream" title="200 · error event" code={sseError} />
          <Code label="reading the stream in Python" title="Python · reading the stream" code={streamPython} />
        </Section>

        <Section id="async" title="Async reads">
          <p>For batch work, or when your client cannot hold a connection for minutes, submit the read and collect it later. <M>POST /reads</M> takes the same body as chat completions (<M>stream</M> is ignored) plus an optional <M>webhook_url</M>, counts the read, and returns <M>202</M> with a Read object and a <M>Location</M> header pointing at its <M>poll_url</M>.</p>
          <Code label="202 Read object" title="POST /reads · 202" code={readQueued} />
          <p>Poll <M>GET /reads/{'{id}'}</M> every few seconds until <M>status</M> is <M>succeeded</M>, <M>failed</M> or <M>cancelled</M>. A finished read carries <M>result.content</M> (the report string) and <M>result.report</M> (the same report parsed, or <M>null</M> if it was not valid JSON). A failed read carries an <M>error</M> in the same shape as HTTP errors.</p>
          <Code label="succeeded Read object" title="GET /reads/{id} · 200 · illustrative" code={readDone} />
          <ul className="sk-docs-list">
            <li><b>Statuses.</b> <M>queued</M> → <M>running</M> → <M>succeeded</M> or <M>failed</M>; <M>cancelled</M> if you cancel it.</li>
            <li><b>Time limit.</b> The read itself is cut off at 230 seconds. A read that stays queued or running for more than 10 minutes is marked <M>failed</M> with code <M>interrupted</M> and its images are deleted; submit it again.</li>
            <li><b>Cancelling.</b> <M>DELETE /reads/{'{id}'}</M> cancels a queued or running read and returns it with <M>status: "cancelled"</M>. A finished read returns <M>409 read_not_cancellable</M>.</li>
            <li><b>Expiry.</b> A read is available for 24 hours after submission (<M>expires_at</M>), then returns <M>404</M>.</li>
          </ul>
          <h3>Idempotency</h3>
          <p>Send an <M>Idempotency-Key</M> header (1 to 255 visible ASCII characters, your own reference, never a patient identifier) so a retried submit does not queue a second read. Keys are scoped to your API key for 24 hours. The same key with the same body returns the original read with <M>200</M> and <M>Idempotent-Replayed: true</M>; the same key with a different body is <M>422 idempotency_conflict</M>. When two submits race on one key, the second gets the first one’s read back the same way; in the rare case that read cannot be found yet it gets <M>409 idempotency_conflict</M>, so retry it.</p>
          <CodeTabs label="Async read examples" tabs={[
            { name: 'curl', code: asyncCurl },
            { name: 'Python', code: asyncPython },
          ]} />
        </Section>

        <Section id="webhooks" title="Webhooks">
          <p>Add <M>webhook_url</M> to <M>POST /reads</M> and RadGenie posts the outcome there when the read ends as <M>succeeded</M> or <M>failed</M>. A cancelled read sends no webhook. The URL must be <M>https</M>, at most 2048 characters, without credentials, and resolve only to public addresses. If webhooks are not enabled on the service, or your key was issued before they were and so came without a webhook secret, the request is refused with <M>400 webhooks_not_configured</M>; ask us for a new key to use webhooks.</p>
          <Code label="webhook body" title="POST {webhook_url} · illustrative" code={webhookBody} />
          <Table caption="Webhook request headers" head={['Header', 'Value']} rows={[
            r(<M>Content-Type</M>, <M>application/json</M>),
            r(<M>User-Agent</M>, <M>VoxelRad-Webhooks/1</M>),
            r(<M>X-VoxelRad-Timestamp</M>, 'When this attempt was signed, in Unix seconds. Each retry carries a new one.'),
            r(<M>X-VoxelRad-Signature</M>, <><M>sha256=</M> + the hex HMAC-SHA256 of <M>{'{timestamp}.{raw body}'}</M> (the timestamp header, a dot, then the raw body bytes), keyed with your webhook secret (the whole <M>whsec_…</M> string as UTF-8).</>),
          ]} />
          <p>Your webhook secret is shown once, with your key, when webhooks are enabled. Verify the timestamp and signature on the raw body before parsing it, and refuse a timestamp more than 5 minutes from your clock:</p>
          <CodeTabs label="Webhook signature verification" tabs={[
            { name: 'Python', code: verifyPython },
            { name: 'Node', code: verifyNode },
          ]} />
          <ul className="sk-docs-list">
            <li><b>Delivery.</b> Any 2xx counts as delivered. Otherwise it is retried up to three more times after 1, 2 and 4 seconds, with a 10-second timeout each, and no attempt starts later than about 290 seconds after you submitted the read. Redirects are not followed.</li>
            <li><b>Keep polling as a fallback.</b> Delivery results are not stored, so a webhook that never arrives cannot be replayed. If none arrives, fetch the read.</li>
            <li><b>Replays.</b> The timestamp is signed, so a captured delivery cannot be replayed once your 5-minute window has passed. Within it, de-duplicate by read <M>id</M>, and confirm with <M>GET /reads/{'{id}'}</M> before acting on a webhook.</li>
          </ul>
        </Section>

        <Section id="response" title="Report format">
          <p>The content of a read is one JSON object. The example below is <strong>illustrative</strong>: modelled on a recorded chest X-ray read, shortened, with the mask data cut.</p>
          <Code label="illustrative report JSON" title="Report JSON · illustrative" code={responseExample} />
          <Table caption="Report fields" head={['Field', 'Meaning']} rows={[
            r(<M>findings</M>, 'Candidate findings, described below. An empty list means nothing abnormal was drawn on this image, not that the whole study is normal.'),
            r(<M>impression</M>, 'One-line summary of the findings.'),
            r(<M>pertinentNegatives</M>, 'Structures stated as normal. Often empty: an absent negative is not a negative.'),
            r(<M>recommendations</M>, <><M>differential</M> is alongside it; both are usually empty for Skanda. Follow-up is the radiologist’s call.</>),
            r(<M>modality</M>, <><M>bodyPart</M>, <M>view</M> and <M>imageQuality</M> describe the input. <M>view</M> may be empty.</>),
          ]} />
          <h3>Each finding</h3>
          <Table caption="Finding fields" head={['Field', 'Meaning']} rows={[
            r(<M>title</M>, 'Short label with side and zone, such as “Left lower zone pleural effusion”.'),
            r(<M>description</M>, <>The visible evidence. On CT and MRI, measured numbers are appended as “Measured from the outline: …”.</>),
            r(<M>severity</M>, <><M>critical</M>, <M>significant</M>, <M>moderate</M>, <M>minor</M> or <M>normal</M>.</>),
            r(<M>location</M>, 'Anatomical location from the patient’s perspective: patient right is image left.'),
            r(<M>confidence</M>, '0 to 1, the model’s own estimate. It is not a calibrated probability.'),
            r(<M>box_2d</M>, <><M>[ymin, xmin, ymax, xmax]</M> on a 0–1000 grid, origin top-left. Absent for diffuse findings.</>),
            r(<M>mask_png</M>, <>The outline: a PNG data URL the size of the input image, white where the finding is. Absent when no outline was drawn or the server withheld one that contradicted the text.</>),
            r(<M>measurements</M>, <>CT and MRI only, computed by the server from the outline with your pixel spacing and HU, not written by the model: <M>diameter_mm</M>, <M>area_mm2</M>, <M>mean_hu</M>, <M>surround_hu</M>, <M>parts</M>, with <M>source: "outline"</M>.</>),
          ]} />
          <Code label="CT finding with measurements" title="CT finding with measurements · illustrative" code={measuredExample} />
          <p>The workspace converts boxes to coordinates normalised to 0..1, and derives the study’s urgency from the worst severity; the API returns neither. If you want the same behaviour:</p>
          <Code label="box and urgency conversion" title="JavaScript" code={bboxExample} />
        </Section>

        <Section id="errors" title="Errors">
          <p>Every error, at every status, has the OpenAI-style shape <M>{'{"error":{"message","type","code"}}'}</M>. Branch on <M>code</M>; show <M>message</M> to people.</p>
          <Code label="error body" title="429 · application/json" code={errorExample} />
          <Table caption="HTTP errors" head={['Status', 'Codes', 'What to do']} rows={[
            r('400', <><M>missing_model</M> <M>invalid_messages</M> <M>invalid_stream</M> <M>invalid_max_tokens</M> <M>invalid_temperature</M> <M>unsupported_parameter</M> <M>invalid_json</M> <M>invalid_webhook_url</M> <M>webhooks_not_configured</M> <M>invalid_idempotency_key</M></>, 'Fix the request; the message names the field.'),
            r('401', <><M>missing_api_key</M> <M>invalid_api_key</M> <M>key_revoked</M>, sent with <M>WWW-Authenticate: Bearer</M>.</>, 'Check the key. Do not retry.'),
            r('404', <><M>model_not_found</M> <M>not_found</M></>, <>Use <M>skanda-v1</M>; check the path or read id. Expired reads are <M>not_found</M>.</>),
            r('405', <><M>method_not_allowed</M>, with an <M>Allow</M> header.</>, 'Fix the method.'),
            r('409', <><M>read_not_cancellable</M> <M>idempotency_conflict</M></>, 'The read already finished; or retry a racing submit.'),
            r('413', <M>request_too_large</M>, 'The hosted API accepts up to 4 MB per request. Downscale or re-encode the image.'),
            r('422', <M>idempotency_conflict</M>, 'This Idempotency-Key was used with a different body. Use a new key.'),
            r('429', <><M>daily_limit_reached</M> (with <M>Retry-After</M>), <M>upstream_quota_exceeded</M>, <M>upstream_busy</M></>, <>Wait for <M>Retry-After</M>; for the shared GPU quota or “busy”, retry after a minute with backoff.</>),
            r('502', <><M>upstream_error</M> <M>stream_error</M> <M>upstream_misconfigured</M></>, 'The read failed or the connection dropped; no findings were generated. Misconfigured is ours: contact us.'),
            r('503', <><M>model_unavailable</M> <M>reads_disabled</M> <M>internal_error</M></>, 'The model service is starting or unavailable. Retry after a minute.'),
            r('504', <><M>upstream_timeout</M> <M>read_timeout</M></>, 'The read did not start within 60 seconds, or ran past the time limit. Retry after a minute.'),
          ]} />
          <p>If the model service refuses a request for its own reasons, its 4xx status is passed on with code <M>upstream_rejected</M>. Inside a started stream the same failures arrive as an <M>error</M> event: the GPU-queue timeout at 180 seconds, the 280-second hosting limit, a quota failure, or a dropped connection.</p>
          <p>If a read returns text that does not parse as JSON, the workspace asks once more with the first reply in context, at temperature 0, for the same read as one valid JSON object. Closing the connection cancels a synchronous read that is still queued, so cancel reads you no longer need.</p>
        </Section>

        <Section id="limits" title="Limits and capacity">
          <div className="sk-docs-stats" aria-label="Seconds per read on the confirmatory set">
            <div><b>{s(secAll)}</b><span>per read, all 2,584 confirmatory cases</span></div>
            <div><b>{s(secXray)}</b><span>chest X-ray</span></div>
            <div><b>{s(secCt)}</b><span>CT slice</span></div>
            <div><b>{s(secMri)}</b><span>MRI slice</span></div>
          </div>
          <Table caption="Limits" head={['Limit', 'Value']} rows={[
            r('Reads per key', <>By default 200 per UTC day for a live key and 20 for a test key, or the limit set for your key. The count resets at 00:00 UTC; over it you get <M>429 daily_limit_reached</M> with <M>Retry-After</M>.</>),
            r('What counts', <>A read counts when <M>/chat/completions</M> starts it or <M>/reads</M> accepts it. It is given back if the model service never started it, refused it for GPU quota (reported as an HTTP error, with <M>stream: false</M> or on an async read; a quota error inside a <M>stream: true</M> response still counts), or you cancelled it while still queued. Failures during a read, timeouts, dropped connections and cancelling a running read still count. <M>GET /models</M> never counts.</>),
            r('Request size', '4 MB per request on the hosted API.'),
            r('Messages', '1 to 64 per request.'),
            r('Time', 'A synchronous read is cut off at 280 seconds, an async read at 230 seconds. A read that has not started within 60 seconds fails with 504.'),
          ]} />
          <ul className="sk-docs-list">
            <li><b>Read time</b> above is model time per image on the pre-registered confirmatory set. Queue wait and GPU start-up come on top; a cold start can take a minute.</li>
            <li><b>Shared GPU queue.</b> Hosted reads share one GPU queue: one read at a time per GPU worker, with up to eight waiting. Send reads in sequence; parallel requests only queue. There is no per-key concurrency limit, so pace your own batches.</li>
            <li><b>Volumes add up.</b> A 100-slice CT sent slice by slice is roughly 100 × {s(secCt)} of model time, before queueing.</li>
            <li><b>Dedicated capacity</b> is available on the Enterprise and on-premise plan; see <a className="sk-inline-link" href="/#pricing">pricing</a>.</li>
            <li><b>No uptime commitment.</b> The hosted API is a research service on shared GPU capacity, with no service-level agreement.</li>
          </ul>
        </Section>

        <Section id="examples" title="Code examples">
          <p>The same chest X-ray read in each language, with <M>stream: false</M>. The Python and JavaScript examples check the HTTP status, read the error code, and refuse a truncated answer; the curl example only prints the report.</p>
          <CodeTabs label="Code examples" tabs={[
            { name: 'curl', code: curlExample },
            { name: 'Python', code: pythonExample },
            { name: 'Python · OpenAI SDK', code: openaiExample },
            { name: 'JavaScript', code: jsExample },
          ]} />
        </Section>

        <Section id="integration" title="Reporting integration">
          <div className="sk-docs-patterns">
            <div><h3>Call on study arrival</h3><p>When a study lands in your worklist, submit an async read per image or axial slice, so candidates are ready when the radiologist opens it. Keep a reference from each read to its image and slice index, and store the model name with the result.</p></div>
            <div><h3>Show candidates with outlines</h3><p>Draw <M>mask_png</M> over the source image at the same size, and let the reader toggle it off to see the pixels underneath. Label it as AI output with its severity, and show the measured numbers next to the finding they came from.</p></div>
            <div><h3>Insert reviewed text only</h3><p>Let the radiologist accept, edit or dismiss each candidate. Draft wording from accepted findings only, and keep it editable until they sign off. Never file model text as a finished report.</p></div>
          </div>
        </Section>

        <Section id="privacy" title="Data handling and privacy">
          <ul className="sk-docs-list">
            <li><b>API reads are not used for model training.</b> The API does not capture images or reports for training. Any model-improvement use would need a separate, signed data agreement with your organisation.</li>
            <li><b>De-identify before sending.</b> Send pixels only: render DICOM to PNG or JPEG so header fields stay behind, and check for names or IDs burned into the image.</li>
            <li><b>No PHI in prompts or headers.</b> Use the fixed prompts on this page. Do not put names, MRNs, dates of birth or accession numbers in any text field, <M>Idempotency-Key</M> or webhook URL, and do not name images after patients.</li>
            <li><b>What is kept.</b> A synchronous read is not stored by the API. An async read keeps its request until it finishes, or for at most 10 minutes if it never does; then the image data is removed and only the model, text prompt, <M>max_tokens</M> and <M>temperature</M> stay with the result, which is no longer available 24 hours after submission and is then deleted by routine cleanup.</li>
            <li><b>Where it runs.</b> The service runs on Vercel and a Hugging Face GPU Space. Agree retention and logging terms for your organisation when your key is issued, and see the <a className="sk-inline-link" href="/privacy">privacy notice</a>. Don’t send anything you could not share for research use.</li>
          </ul>
        </Section>

        <Section id="limitations" title="Regulatory status and limitations">
          <div className="sk-docs-note sk-docs-warn">
            <p><b>{MODEL_DISCLAIMER}</b></p>
            <p>Skanda is not a cleared medical device. Clinical use requires regulatory clearance, such as from CDSCO in India, and that clearance has not been obtained. Until it is, integrations are for research, evaluation and supervised pilots under a research agreement, and a radiologist reviews every finding.</p>
          </div>
          <ul className="sk-docs-list">
            <li>Chest X-ray outlines: on the confirmatory set, Skanda V1 outlined 23.5% of findings at mask IoU ≥ 0.3.</li>
            <li>Missed findings happen. An empty findings list is not a normal study.</li>
            <li>CT and MRI are read one axial slice at a time, with no context from neighbouring slices.</li>
            <li>Confidence values are not calibrated probabilities.</li>
          </ul>
          <a className="sk-inline-link sk-docs-link" href="/benchmarks">See the benchmarks and known failures <ArrowUpRight size={13} /></a>
        </Section>

        <div className="sk-docs-end">
          <h2>Ready to <em>connect</em>?</h2>
          <p>Tell us what you would integrate. We reply to every request by email, and start approved organisations on a sandbox test key.</p>
          <div className="sk-actions sk-actions-left"><Pill href="/#access">Request API access</Pill><Pill href="/benchmarks" tone="ghost">See benchmarks</Pill></div>
        </div>
      </article>
    </div>
  </Shell>
}
