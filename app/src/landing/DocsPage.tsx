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
// lib/medgemma.ts + lib/prompts.ts (request), lib/modelTransport.ts + lib/sse.ts (stream), lib/parse.ts + types.ts (result),
// lib/skandaSlice.ts (CT/MRI input), deploy/huggingface/space_app.py and server/src/modelProxy.mjs (limits and errors).

const [secXray, secCt, secMri, secAll] = V1_CONFIRMATORY.secondsPerRead
const s = (n: number) => `${n.toFixed(1)} s`

const toc = [
  ['overview', 'Overview'],
  ['access', 'Access and keys'],
  ['endpoints', 'Endpoints'],
  ['request', 'Request body'],
  ['inputs', 'Supported inputs'],
  ['streaming', 'Streaming'],
  ['response', 'Response format'],
  ['errors', 'Errors'],
  ['limits', 'Limits and latency'],
  ['examples', 'Code examples'],
  ['integration', 'Reporting integration'],
  ['privacy', 'Data handling'],
  ['limitations', 'Limitations'],
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
  stream: true,
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
  stream: true,
  messages: [
    { role: 'system', content: 'You are Skanda, …' },
    { role: 'user', content: [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,…  (R/G/B = lung / soft-tissue / bone window)' } },
      { type: 'text', text: 'Read this axial slice of an abdomen CT. Reply as JSON: normal, findings (title, evidence, location, severity, mask), impression.' },
    ] },
  ],
  skanda: { modality: 'ct', body: 'Liver', pixel_spacing: [0.78, 0.78], composite: true, hu: { b64: 'AAD+/wEA…  (int16 little-endian, row-major)', width: 512, height: 512 } },
})

const sseExample = `: queued

: queued

data: {"id":"chatcmpl-3f9c…","object":"chat.completion.chunk","model":"skanda-v1","choices":[{"index":0,"delta":{"content":"{\\"modality\\": \\"X-ray\\", \\"findings\\": [ … ]}"},"finish_reason":"stop"}]}

data: [DONE]`

const sseError = `data: {"error":{"message":"ZeroGPU read timed out after 180 seconds without a completed result. The pending request was cancelled. No findings were generated."}}

data: [DONE]`

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

const curlExample = `# Endpoint and key are issued to your organisation on approval.
export VOXELRAD_API_URL="https://…/v1"     # provided on approval
export VOXELRAD_API_KEY="…"                # provided on approval

# 1. Check the model is available
curl -s "$VOXELRAD_API_URL/models" -H "Authorization: Bearer $VOXELRAD_API_KEY"

# 2. Read one de-identified chest X-ray (PNG or JPEG)
IMG=$(base64 < chest.png | tr -d '\\n')
curl -N "$VOXELRAD_API_URL/chat/completions" \\
  -H "Authorization: Bearer $VOXELRAD_API_KEY" \\
  -H "Content-Type: application/json" \\
  --data-binary @- <<EOF
{
  "model": "skanda-v1",
  "stream": true,
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

URL = os.environ["VOXELRAD_API_URL"]   # provided on approval
KEY = os.environ["VOXELRAD_API_KEY"]   # provided on approval

SYSTEM = "${sysPy}"
PROMPT = "${SKANDA_ANALYSIS_PROMPT}"

def read_chest_xray(path: str) -> dict:
    image = base64.b64encode(open(path, "rb").read()).decode()
    body = {
        "model": "skanda-v1", "stream": True, "temperature": 0, "max_tokens": 1024,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image}"}},
                {"type": "text", "text": PROMPT},
            ]},
        ],
    }
    text, finish = "", None
    with requests.post(f"{URL}/chat/completions", json=body, stream=True, timeout=(30, 300),
                       headers={"Authorization": f"Bearer {KEY}"}) as r:
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
        for line in r.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data:"):
                continue                      # blank separators and ": queued" heartbeats
            data = line[5:].strip()
            if data == "[DONE]":
                break
            event = json.loads(data)
            if "error" in event:              # errors after the 200 arrive inside the stream
                raise RuntimeError(event["error"]["message"])
            choice = event["choices"][0]
            text += choice["delta"].get("content") or ""
            finish = choice.get("finish_reason") or finish
    if finish == "length":
        raise RuntimeError("Output hit max_tokens; the findings may be incomplete.")
    return json.loads(text)                   # candidate findings for a radiologist to review`

const openaiExample = `import base64, json, os
from openai import OpenAI

client = OpenAI(base_url=os.environ["VOXELRAD_API_URL"],   # provided on approval
                api_key=os.environ["VOXELRAD_API_KEY"])

image = base64.b64encode(open("chest.png", "rb").read()).decode()
stream = client.chat.completions.create(
    model="skanda-v1",
    stream=True,                       # the hosted endpoint always answers with events
    temperature=0,
    max_tokens=1024,
    messages=[
        {"role": "system", "content": "${sysPy}"},
        {"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image}"}},
            {"type": "text", "text": "${SKANDA_ANALYSIS_PROMPT}"},
        ]},
    ],
)
text = "".join(chunk.choices[0].delta.content or "" for chunk in stream if chunk.choices)
report = json.loads(text)`

const jsExample = `const URL = process.env.VOXELRAD_API_URL   // provided on approval
const KEY = process.env.VOXELRAD_API_KEY   // provided on approval

const SYSTEM = ${JSON.stringify(SKANDA_SYSTEM_PROMPT)}
const PROMPT = ${JSON.stringify(SKANDA_ANALYSIS_PROMPT)}

export async function readChestXray(pngBase64, signal) {
  const res = await fetch(\`\${URL}/chat/completions\`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${KEY}\` },
    body: JSON.stringify({
      model: 'skanda-v1', stream: true, temperature: 0, max_tokens: 1024,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: \`data:image/png;base64,\${pngBase64}\` } },
          { type: 'text', text: PROMPT },
        ] },
      ],
    }),
  })
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}))
    throw new Error(\`HTTP \${res.status}: \${error ?? res.statusText}\`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '', text = '', finish
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\\n')
    buffer = lines.pop()                      // keep the unfinished line
    for (const line of lines) {
      if (!line.startsWith('data:')) continue // ": queued" heartbeats, blank lines
      const data = line.slice(5).trim()
      if (data === '[DONE]') return finishRead(text, finish)
      const event = JSON.parse(data)
      if (event.error) throw new Error(event.error.message ?? event.error)
      text += event.choices[0].delta.content ?? ''
      finish = event.choices[0].finish_reason ?? finish
    }
  }
  return finishRead(text, finish)
}

function finishRead(text, finish) {
  if (finish === 'length') throw new Error('Output hit max_tokens; findings may be incomplete.')
  return JSON.parse(text)                     // candidate findings for a radiologist to review
}`

const bboxExample = `// box_2d is [ymin, xmin, ymax, xmax] on a 0–1000 grid, origin top-left.
// The VoxelRad workspace stores it as a box normalised to 0..1:
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
  usePageMeta('Developer docs · Connect Skanda V1 to your software · VoxelRad AI', 'How to call Skanda V1 from your own application or reporting software: access by request, the OpenAI-compatible chat completions format, streamed JSON reports with outlines and measurements, errors, limits and data handling.')
  return <Shell>
    <PageHead eyebrow="Docs" title={<>Connect <em>Skanda V1</em></>} lead="Send a de-identified X-ray, CT or MRI image to Skanda V1 from your own application or reporting software, and get back a structured draft: candidate findings with outlines, measurements and an impression, for a radiologist to review before anything reaches a report.">
      <div className="sk-docs-access">
        <div>
          <h2>API access is by request</h2>
          <p>There are no self-serve keys. Each organisation is reviewed by hand; on approval we issue an endpoint and credentials during onboarding. Examples on this page use <M>$VOXELRAD_API_URL</M> and <M>$VOXELRAD_API_KEY</M> for those values.</p>
        </div>
        <div className="sk-actions sk-actions-left"><Pill href="/#access">Request API access</Pill><Pill href="/demo" tone="ghost">Try the demo</Pill></div>
      </div>
    </PageHead>

    <div className="sk-wrap sk-docs">
      <Toc />
      <article className="sk-docs-body">
        <Section id="overview" title="Overview">
          <p>Skanda V1 is the model the hosted VoxelRad workspace serves. It speaks the OpenAI-compatible chat completions format: you send one image and a short prompt, and it answers with a single JSON object describing what it sees, where, and how large it is.</p>
          <p>Treat every finding it returns as a <strong>candidate</strong>. In the workspace a radiologist accepts or dismisses each one, and only reviewed findings are drafted into the report. Your integration should keep the same order of events:</p>
          <ol className="sk-steps sk-docs-flow">
            <li><b>A study arrives.</b> Your system de-identifies the image and renders it to PNG or JPEG.</li>
            <li><b>Skanda reads it.</b> One request per image, or per axial slice for CT and MRI.</li>
            <li><b>A radiologist reviews.</b> Candidates appear with their outlines over the source image, clearly marked as AI output.</li>
            <li><b>Reviewed text enters the report.</b> Accepted findings become draft wording the radiologist edits and signs.</li>
          </ol>
        </Section>

        <Section id="access" title="Access and authentication">
          <p>Access is granted on request, per organisation. Tell us who you are and what you would integrate in the <a className="sk-inline-link" href="/#access">request form</a>; mention that you want API access. If approved, onboarding provides:</p>
          <ul className="sk-docs-list">
            <li><b>A base URL</b> for your organisation, ending in <M>/v1</M>. Use it as <M>$VOXELRAD_API_URL</M>.</li>
            <li><b>A credential</b> for that endpoint. Use it as <M>$VOXELRAD_API_KEY</M>; keep it server-side and never ship it in a browser bundle.</li>
            <li><b>Your read allowance</b>, agreed for your use case (see <a className="sk-inline-link" href="#limits">limits</a>).</li>
          </ul>
          <p>The examples send the credential as a bearer token (<M>Authorization: Bearer …</M>). Your onboarding notes confirm the exact header your endpoint expects.</p>
          <Code label="environment variables" title="Shell" code={'export VOXELRAD_API_URL="https://…/v1"   # provided on approval\nexport VOXELRAD_API_KEY="…"              # provided on approval'} />
        </Section>

        <Section id="endpoints" title="Endpoints">
          <div className="sk-docs-endpoints">
            <div><span className="sk-method">GET</span><M>/v1/models</M><p>Lists the served model. Use it as a health check before a batch of reads.</p></div>
            <div><span className="sk-method sk-method-post">POST</span><M>/v1/chat/completions</M><p>Reads one image and streams back the JSON report.</p></div>
          </div>
          <Code label="GET /v1/models response" title="GET /v1/models · 200" code={json({ data: [{ id: 'skanda-v1', state: 'loaded' }] })} />
        </Section>

        <Section id="request" title="Request body">
          <p>A read is one system message and one user message holding the image and the instruction. These are the exact prompts the VoxelRad workspace sends for a chest X-ray; Skanda was trained on them, so keep them unchanged.</p>
          <Code label="chest X-ray request body" title="POST /v1/chat/completions · chest X-ray" code={requestBody} />
          <Table caption="Request fields" head={['Field', 'Value']} rows={[
            r(<M>model</M>, <><M>"skanda-v1"</M>. Any other model name is refused.</>),
            r(<M>messages</M>, <>System prompt, then a user message with one <M>image_url</M> part (a base64 data URL) and one <M>text</M> part.</>),
            r(<M>stream</M>, <>Send <M>true</M>. The hosted endpoint always answers with server-sent events (see <a className="sk-inline-link" href="#streaming">streaming</a>).</>),
            r(<M>temperature</M>, <>Optional, defaults to 0. Use 0 for repeatable reads.</>),
            r(<M>max_tokens</M>, <>Optional, defaults to 1024 and is capped at 1536. A read that hits it ends with <M>finish_reason: "length"</M>.</>),
            r(<M>skanda</M>, <>CT and MRI only: modality, body part, pixel spacing and, for CT, raw HU. See <a className="sk-inline-link" href="#inputs">supported inputs</a>.</>),
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
          <Code label="CT slice request body" title="POST /v1/chat/completions · CT slice (abridged)" code={ctBody} />
          <Table caption="The skanda field" head={['Key', 'Meaning']} rows={[
            r(<M>modality</M>, <><M>"ct"</M> or <M>"mri"</M>.</>),
            r(<M>body</M>, <>Body part, such as <M>"Liver"</M> or <M>"Brain"</M>. Never a file or patient name.</>),
            r(<M>pixel_spacing</M>, 'In-plane pixel spacing in millimetres, two numbers.'),
            r(<M>hu</M>, <>CT only: <M>{'{ b64, width, height }'}</M>, the slice’s raw Hounsfield units as little-endian int16, row-major, base64-encoded. Only send HU you know are calibrated.</>),
            r(<M>sequence</M>, 'MRI only: the sequence name, such as FLAIR or T2.'),
            r(<M>composite</M>, <><M>true</M> for the three-window CT image, <M>false</M> for greyscale MRI.</>),
          ]} />
        </Section>

        <Section id="streaming" title="Streaming">
          <p>Reads queue for a GPU, so the response is a <M>text/event-stream</M>. While the read waits, the stream carries <M>: queued</M> comment lines; ignore them, they keep the connection alive. The whole JSON report then arrives in a single <M>delta.content</M> chunk with its <M>finish_reason</M>, followed by <M>data: [DONE]</M>.</p>
          <Code label="successful event stream" title="200 · text/event-stream" code={sseExample} />
          <p>The hosted endpoint does not return a plain JSON body, even with <M>stream: false</M>. If your client wants one response, read the stream to the end and concatenate the content; the examples below do this in a few lines. Standard OpenAI SDKs work with <M>stream=True</M>.</p>
          <div className="sk-docs-note"><b>Errors can arrive after the 200.</b> Once the stream has started, a failure is sent as an <M>error</M> event and then <M>[DONE]</M>. Check every event for <M>error</M>, and treat a stream that ends without <M>[DONE]</M> or a finish reason as failed.</div>
          <Code label="error inside the stream" title="200 · error event" code={sseError} />
        </Section>

        <Section id="response" title="Response format">
          <p>The content of the stream is one JSON object. The example below is <strong>illustrative</strong>: modelled on a recorded chest X-ray read, shortened, with the mask data cut.</p>
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
          <p>Before the stream starts, errors are plain HTTP responses with a JSON body <M>{'{ "error": "…" }'}</M>.</p>
          <Table caption="HTTP errors" head={['Status', 'When', 'What to do']} rows={[
            r('401', 'Missing, expired or wrong credentials.', 'Check the key. Do not retry blindly.'),
            r('405', 'Wrong method: GET on chat completions or POST on models.', 'Fix the request.'),
            r('413', 'The body is too large. The hosted endpoint accepts up to 4 MB per request.', 'Downscale or re-encode the image.'),
            r('429', <>Your daily read allowance is used up (sent with <M>Retry-After</M> in seconds, resetting at 00:00 UTC), the shared GPU quota is exhausted, or the service is busy.</>, <>Wait for <M>Retry-After</M>, or a minute for “busy”.</>),
            r('502', 'The gateway could not authenticate with or find the model service.', 'Contact us; this is our configuration.'),
            r('503', 'The model service is starting, unavailable or its queue is full.', 'Retry after a minute with backoff.'),
            r('504', 'The read did not start within 60 seconds, usually while the GPU wakes up.', 'Retry after a minute.'),
          ]} />
          <p>Inside a started stream, an <M>error</M> event reports these:</p>
          <ul className="sk-docs-list">
            <li><b>Read timeout.</b> A read without a result after 180 seconds in the GPU queue is cancelled, and no findings are generated.</li>
            <li><b>Hosting limit.</b> A stream still open after 280 seconds is cancelled.</li>
            <li><b>Quota or read failure.</b> “ZeroGPU read failed or quota exhausted”, with the upstream detail.</li>
            <li><b>Dropped connection.</b> The upstream connection ended before the read completed.</li>
          </ul>
          <p>If a read returns text that does not parse as JSON, the workspace asks once more with the first reply in context, at temperature 0, for the same read as one valid JSON object. Closing the connection cancels a queued read, so cancel reads you no longer need.</p>
        </Section>

        <Section id="limits" title="Limits and latency">
          <div className="sk-docs-stats" aria-label="Seconds per read on the confirmatory set">
            <div><b>{s(secAll)}</b><span>per read, all 2,584 confirmatory cases</span></div>
            <div><b>{s(secXray)}</b><span>chest X-ray</span></div>
            <div><b>{s(secCt)}</b><span>CT slice</span></div>
            <div><b>{s(secMri)}</b><span>MRI slice</span></div>
          </div>
          <ul className="sk-docs-list">
            <li><b>Read time</b> above is model time per image on the pre-registered confirmatory set. Queue wait and GPU start-up come on top; a cold start can take a minute.</li>
            <li><b>One read at a time</b> per GPU worker, with up to eight waiting. Send reads in sequence; parallel requests only queue.</li>
            <li><b>Volumes add up.</b> A 100-slice CT sent slice by slice is roughly 100 × {s(secCt)} of model time, before queueing.</li>
            <li><b>Read allowance.</b> The hosted workspace allows 40 reads per user per UTC day by default. API allowances are agreed per organisation at onboarding.</li>
            <li><b>No uptime commitment.</b> This is a research service on shared GPU capacity, with no service-level agreement.</li>
          </ul>
        </Section>

        <Section id="examples" title="Code examples">
          <p>The same chest X-ray read in each language. Each collects the stream, stops on an error event, and refuses a truncated answer.</p>
          <CodeTabs label="Code examples" tabs={[
            { name: 'curl', code: curlExample },
            { name: 'Python', code: pythonExample },
            { name: 'Python · OpenAI SDK', code: openaiExample },
            { name: 'JavaScript', code: jsExample },
          ]} />
        </Section>

        <Section id="integration" title="Reporting integration">
          <div className="sk-docs-patterns">
            <div><h3>Call on study arrival</h3><p>When a study lands in your worklist, queue a background read per image or axial slice, so candidates are ready when the radiologist opens it. Keep a reference from each read to its image and slice index, and store the model name with the result.</p></div>
            <div><h3>Show candidates with outlines</h3><p>Draw <M>mask_png</M> over the source image at the same size, and let the reader toggle it off to see the pixels underneath. Label it as AI output with its severity, and show the measured numbers next to the finding they came from.</p></div>
            <div><h3>Insert reviewed text only</h3><p>Let the radiologist accept, edit or dismiss each candidate. Draft report wording from accepted findings only, and keep it editable until they sign. Never file model text as a finished report.</p></div>
          </div>
        </Section>

        <Section id="privacy" title="Data handling and privacy">
          <ul className="sk-docs-list">
            <li><b>De-identify before sending.</b> Send pixels only: render DICOM to PNG or JPEG so header fields stay behind, and check for names or IDs burned into the image.</li>
            <li><b>No PHI in prompts.</b> Use the fixed prompts on this page. Do not add names, MRNs, dates of birth or accession numbers to any text field, and do not name images after patients.</li>
            <li><b>What we receive</b> is what you send: the image, the prompt and the <M>skanda</M> field. The service runs on Vercel and a Hugging Face GPU Space.</li>
            <li><b>Retention.</b> Agree retention and logging terms for your organisation during onboarding, and see the <a className="sk-inline-link" href="/privacy">privacy notice</a>. Don’t send anything you could not share for research use.</li>
          </ul>
        </Section>

        <Section id="limitations" title="Limitations">
          <div className="sk-docs-note sk-docs-warn">
            <p><b>{MODEL_DISCLAIMER}</b></p>
            <p>Skanda V1 is review-support software for research and evaluation. Every result needs a qualified radiologist’s review before any clinical use.</p>
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
          <p>Tell us what you would integrate. We reply to every request by email, and send the endpoint and credentials on approval.</p>
          <div className="sk-actions sk-actions-left"><Pill href="/#access">Request API access</Pill><Pill href="/benchmarks" tone="ghost">See benchmarks</Pill></div>
        </div>
      </article>
    </div>
  </Shell>
}
