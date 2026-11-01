// OWNER: Agent 1 (AI engine). MedGemma OpenAI-compatible client with streaming, re-encoding,
// retry, and a serial queue so only one inference hits LM Studio at a time.
import type { AnalysisResult, ConnectionState, PatientInfo, ReportDraft, Settings, Study, StudyImage } from '../types'
import { isCrossSectional } from './modality'
import type { SkandaSliceInput } from './skandaSlice'
import { buildSlicePrompt, buildAnalysisPrompt, buildReportPrompt, LUNG_PATTERN_PROMPT, LUNG_PATTERN_SYSTEM, SYSTEM_PROMPT, SKANDA_SYSTEM_PROMPT, SKANDA_ANALYSIS_PROMPT } from './prompts'
import { extractJson, extractJsonWithInfo, mergeLungPattern, normalizeAnalysis, normalizeReport, parseLungPattern, type ReportFields } from './parse'
import { parseSseLines, type SseParse } from './sse'
import { createSerialQueue } from './queue'

export type GeneratedReport = Pick<ReportDraft, 'technique' | 'comparison' | 'findings' | 'impression' | 'recommendations'>

type ChatRole = 'system' | 'user' | 'assistant'
interface ChatMessage {
  role: ChatRole
  content: string | ChatPart[]
}
interface ChatPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

// ---- Serial queue ----------------------------------------------------------

/** One inference at a time hits LM Studio; a cancelled job that is still waiting never starts. */
const queue = createSerialQueue()

// ---- URL helpers -----------------------------------------------------------

function endpoint(settings: Settings, suffix = ''): string {
  const base =
    settings.baseUrl.startsWith('http') || settings.baseUrl.startsWith('//')
      ? settings.baseUrl
      : typeof location !== 'undefined'
        ? location.origin + settings.baseUrl
        : settings.baseUrl
  return `${base}${suffix}`
}

// ---- Re-encoding (JPEG, small) ---------------------------------------------

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('The uploaded image could not be decoded.'))
    img.src = src
  })
}

/**
 * Downscale to a JPEG with long edge <= 1024 px (MedGemma internally uses ~896 px). Shared by the
 * model calls and the TorchXRayVision cross-check so every reader sees the same pixels.
 */
export async function reencodeForClassifier(dataUrl: string): Promise<string> {
  const maxEdge = 1024
  const img = await loadImage(dataUrl)
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
  const width = Math.max(1, Math.round(img.width * scale))
  const height = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' })
  if (!ctx) throw new Error('The browser cannot encode images for analysis.')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', 0.9)
}

// ---- SSE streaming ---------------------------------------------------------

/** No streamed bytes for this long → the request is aborted as stalled. */
const IDLE_TIMEOUT_MS = 120_000

export interface ChatResult {
  text: string
  /** choices[0].finish_reason of the last chunk ("stop", "length", ...), when the server sent one. */
  finish?: string
}

export async function chatStream({
  settings,
  messages,
  signal,
  onDelta,
  maxTokens,
  temperature,
  extra,
}: {
  settings: Settings
  messages: ChatMessage[]
  signal?: AbortSignal
  onDelta?: (text: string) => void
  maxTokens?: number
  temperature?: number
  /** Extra request fields (Skanda's server reads "skanda"; other servers ignore unknown fields). */
  extra?: Record<string, unknown>
}): Promise<ChatResult> {
  if (signal?.aborted) throw abortError()
  // Own controller so a stalled stream can be aborted without touching the caller's signal.
  const ac = new AbortController()
  const forward = () => ac.abort()
  signal?.addEventListener('abort', forward, { once: true })
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      ac.abort()
    }, IDLE_TIMEOUT_MS)
  }
  const stalled = () => new Error(`Model stopped responding (no output for ${IDLE_TIMEOUT_MS / 1000} s).`)

  try {
    arm()
    let res: Response
    try {
      res = await fetch(endpoint(settings, '/chat/completions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings.model,
          messages,
          stream: true,
          temperature: temperature ?? settings.temperature,
          max_tokens: maxTokens ?? settings.maxTokens,
          ...extra,
        }),
        signal: ac.signal,
      })
    } catch (err) {
      if (timedOut) throw stalled()
      if (isAbort(err) || signal?.aborted) throw abortError()
      throw new Error(`LM Studio is not reachable at ${settings.baseUrl}. Ensure it is running.`)
    }
    if (!res.ok) throw new Error(await readErrorBody(res))
    if (!res.body) throw new Error('LM Studio returned an empty response.')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    let finish: string | undefined
    const bad: string[] = []
    const absorb = (p: SseParse) => {
      if (p.error) throw new Error(`LM Studio error: ${p.error}`)
      bad.push(...p.bad)
      if (p.finish) finish = p.finish
      if (p.text) {
        text += p.text
        onDelta?.(p.text)
      }
    }

    try {
      let sawDone = false
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        arm()
        const p = parseSseLines(buffer + decoder.decode(value, { stream: true }))
        buffer = p.rest
        absorb(p)
        if (p.done) {
          sawDone = true
          break
        }
      }
      // Flush a final line the server did not newline-terminate.
      if (!sawDone) absorb(parseSseLines(buffer + decoder.decode() + '\n'))
    } catch (err) {
      if (timedOut) throw stalled()
      if (isAbort(err) || signal?.aborted) throw abortError()
      throw err
    } finally {
      reader.cancel().catch(() => undefined)
    }

    if (bad.length) {
      if (!text) throw new Error(`LM Studio sent an unreadable stream (${bad[0].slice(0, 80)}).`)
      console.warn(`[medgemma] ${bad.length} unreadable stream line(s) skipped`, bad)
    }
    return { text, finish }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', forward)
  }
}

async function readErrorBody(res: Response): Promise<string> {
  let detail = ''
  try {
    const txt = await res.clone().text()
    if (txt) {
      try {
        const json = JSON.parse(txt)
        detail = typeof json.error === 'string' ? json.error : json.error?.message
      } catch {
        detail = txt.slice(0, 200)
      }
    }
  } catch {
    // ignore
  }
  return `LM Studio request failed (HTTP ${res.status}). ${detail || 'See the server log for details.'}`.trim()
}

// ---- Small helpers ---------------------------------------------------------

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}
function abortError(): Error {
  const e = new Error('Analysis cancelled.')
  return e
}

// ---- checkConnection -------------------------------------------------------

export async function checkConnection(settings: Settings): Promise<ConnectionState> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 4000)
  try {
    // The local LM Studio inventory distinguishes loaded models from downloaded files.
    const localStudio = settings.baseUrl.replace(/\/$/, '') === '/lmstudio/v1'
    const url = localStudio ? '/lmstudio/api/v0/models' : endpoint(settings, '/models')
    const res = await fetch(url, { signal: ac.signal })
    if (!res.ok) return 'offline'
    const data = await res.json().catch(() => null)
    const models: { id?: unknown; state?: string }[] = Array.isArray(data?.data) ? data.data : []
    const wanted = (settings.model || '').trim().toLowerCase()
    if (!wanted) return 'model-missing'
    // Exact id match: a substring match would report "online" for a different model or quantisation.
    const exists = models.some((m) => m && typeof m.id === 'string' && m.id.toLowerCase() === wanted && (!localStudio || m.state === 'loaded'))
    return exists ? 'online' : 'model-missing'
  } catch {
    return 'offline'
  } finally {
    clearTimeout(timer)
  }
}

// ---- analyzeImage ----------------------------------------------------------

const RETRY_PROMPT = `Your previous reply could not be parsed as JSON. Return the same read again as ONLY a
single valid JSON object that matches the schema in my first message: same findings, no new ones,
no prose, no markdown, no code fences.`

/** Skanda models (its own server, or a build of it in LM Studio) are named skanda-…. */
export const isSkandaModel = (model: string) => /(^|\/)skanda-/i.test(model)

export type AnalyzeStage = 'queued' | 'reading' | 'retry' | 'lung-pattern'

export async function analyzeImage(opts: {
  image: StudyImage
  patient: PatientInfo
  settings: Settings
  signal?: AbortSignal
  onProgress?: (text: string) => void
  onStage?: (s: AnalyzeStage) => void
  /** CT/MRI with a Skanda model: the slice as Skanda was trained to see it, plus spacing and raw HU (lib/skandaSlice). */
  skanda?: SkandaSliceInput
}): Promise<AnalysisResult> {
  const t0 = Date.now()
  const { settings, signal } = opts
  const crossSectional = isCrossSectional(opts.image)
  const skanda = isSkandaModel(settings.model)
  let chars = 0

  opts.onStage?.('queued')
  if (queue.size() > 0) opts.onProgress?.('Waiting for the model…')
  // Encode once; the retry and the lung-pattern pass reuse the same pixels.
  // Skanda on CT/MRI: its own prompt and training rendering, never the generic box_2d prompt it was not trained on.
  const skandaSlice = skanda && crossSectional ? opts.skanda : undefined
  if (skanda && crossSectional && !skandaSlice) throw new Error('Skanda needs the CT/MRI volume data for this slice (axial plane). Open the slice from a volume to analyze it with Skanda.')
  const imageUrl = skandaSlice ? skandaSlice.dataUrl : await reencodeForClassifier(opts.image.dataUrl)
  const firstTurn: ChatMessage[] = [
    { role: 'system', content: skanda ? SKANDA_SYSTEM_PROMPT : crossSectional ? 'You are a radiology assistant reviewing a CT or MRI image for a radiologist. Describe only visible evidence and return the requested JSON schema.' : SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageUrl } },
        { type: 'text', text: skandaSlice ? skandaSlicePrompt(skandaSlice) : crossSectional ? buildSlicePrompt(opts.image.sourceModality!, opts.image.name, opts.patient) : skanda ? SKANDA_ANALYSIS_PROMPT : buildAnalysisPrompt(opts.patient) },
      ],
    },
  ]
  const extra = skandaSlice ? { skanda: skandaSlice.extension } : undefined
  const onDelta = (d: string) => {
    chars += d.length
    opts.onProgress?.(`Writing findings · ${chars.toLocaleString()} chars`)
  }

  const toResult = (r: ChatResult): AnalysisResult => {
    const info = extractJsonWithInfo(r.text)
    return normalizeAnalysis(info.value, {
      rawText: r.text,
      model: settings.model,
      durationMs: Date.now() - t0,
      truncated: info.closedContainers || r.finish === 'length',
    })
  }

  const withPattern = async (a: AnalysisResult) => {
    // Skanda was not trained for MedGemma's separate lung-pattern grading task.
    if (skanda || crossSectional) return a
    const merged = mergeLungPattern(a, await checkLungPattern({ ...opts, imageUrl }))
    return { ...merged, durationMs: Date.now() - t0 }
  }

  let first: ChatResult
  try {
    first = await queue.enqueue(() => {
      opts.onStage?.('reading')
      opts.onProgress?.('Reviewing image…')
      return chatStream({ settings, messages: firstTurn, signal, onDelta, extra })
    }, signal)
  } catch (err) {
    if (isAbort(err) || signal?.aborted) throw abortError()
    throw isNetworkish(err)
      ? new Error(`LM Studio is not reachable at ${settings.baseUrl}. Ensure it is running.`)
      : new Error(err instanceof Error ? err.message : 'Analysis failed.')
  }

  let parsed: AnalysisResult
  try {
    parsed = toResult(first)
  } catch (err) {
    if (!isParseableError(err)) throw err
    // Retry with the schema (first turn) and the unparseable answer in context, deterministically.
    chars = 0
    let second: ChatResult
    try {
      second = await queue.enqueue(() => {
        opts.onStage?.('retry')
        opts.onProgress?.('Answer was not valid JSON · asking again…')
        return chatStream({
          settings,
          temperature: 0,
          signal,
          onDelta,
          extra,
          messages: [...firstTurn, { role: 'assistant', content: first.text || '(empty reply)' }, { role: 'user', content: RETRY_PROMPT }],
        })
      }, signal)
    } catch (retryErr) {
      if (isAbort(retryErr) || signal?.aborted) throw abortError()
      throw retryErr
    }
    try {
      parsed = toResult(second)
    } catch (retryErr) {
      if (!isParseableError(retryErr)) throw retryErr
      const cut = first.finish === 'length' || second.finish === 'length'
      throw new Error(
        cut
          ? 'The model output was cut off at the token limit and could not be read. Raise Max tokens in Settings and re-analyse.'
          : 'The model did not return readable findings, even after a retry. Re-analyse or review the image manually.',
      )
    }
  }
  return withPattern(skandaSlice ? groundedOnly(parsed, skandaSlice) : parsed)
}

/** Skanda's training prompt for one axial slice (skanda-grounding skanda/ctmri.prompt; its server uses its own copy). */
function skandaSlicePrompt(input: SkandaSliceInput): string {
  const m = input.extension.modality
  const body = m === 'mri' ? 'brain' : /liver|abdom|pancrea|kidney|colon|pelvi|hepat/i.test(input.extension.body) ? 'abdomen' : /chest|lung|thora|pulmon|mediast/i.test(input.extension.body) ? 'chest' : 'body'
  return `Read this axial slice of a ${body} ${m === 'ct' ? 'CT' : 'MRI'}. Reply as JSON: normal, findings (title, evidence, location, severity, mask), impression.`
}

/** A Skanda location is only grounded when its outline came back. Builds without the outline path (a GGUF in LM Studio,
 * which cannot run SAM 2) write coordinates Skanda was never trained to produce: drop those boxes and say why. */
function groundedOnly(a: AnalysisResult, input: SkandaSliceInput): AnalysisResult {
  const notes = [...input.limitations]
  let dropped = 0
  const findings = a.findings.map((f) => {
    if (f.mask || !f.bbox) return f
    dropped++
    return { ...f, bbox: undefined, validationIssues: [...(f.validationIssues ?? []), 'No outline returned: this Skanda build cannot draw outlines (for example a GGUF in LM Studio), so its coordinates are not grounded and were removed. Use the Skanda server for CT/MRI.'] }
  })
  if (dropped) notes.push(`${dropped} ungrounded location${dropped > 1 ? 's' : ''} removed (no outline).`)
  return notes.length ? { ...a, findings, imageQuality: [a.imageQuality, ...notes].filter(Boolean).join(' ') } : { ...a, findings }
}

/** Neutral graded lung-pattern check (see LUNG_PATTERN_PROMPT). Best-effort: returns null on any non-abort failure. */
async function checkLungPattern(opts: {
  imageUrl: string
  settings: Settings
  signal?: AbortSignal
  onProgress?: (t: string) => void
  onStage?: (s: AnalyzeStage) => void
}) {
  try {
    const { text } = await queue.enqueue(() => {
      opts.onStage?.('lung-pattern')
      opts.onProgress?.('Checking lung markings…')
      return chatStream({
        settings: opts.settings,
        temperature: 0,
        maxTokens: 200,
        signal: opts.signal,
        messages: [
          { role: 'system', content: LUNG_PATTERN_SYSTEM },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: opts.imageUrl } },
              { type: 'text', text: LUNG_PATTERN_PROMPT },
            ],
          },
        ],
      })
    }, opts.signal)
    return parseLungPattern(extractJson(text))
  } catch (err) {
    if (isAbort(err) || opts.signal?.aborted) throw abortError()
    return null
  }
}

/** A failure that is (likely) the model producing non-JSON output that we should retry. */
function isParseableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const m = err.message.toLowerCase()
  return m.includes('unable to parse json') || m.includes('no json content')
}

function isNetworkish(err: unknown): boolean {
  if (err instanceof Error) {
    const m = err.message.toLowerCase()
    return m.includes('networkerror') || m.includes('fetch failed')
  }
  return false
}

// ---- generateReport --------------------------------------------------------

export async function generateReport(opts: {
  study: Study
  settings: Settings
  signal?: AbortSignal
  onProgress?: (text: string) => void
}): Promise<GeneratedReport> {
  let chars = 0
  const { text, finish } = await queue
    .enqueue(() => {
      opts.onProgress?.('Compiling report…')
      return chatStream({
        settings: opts.settings,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildReportPrompt(opts.study) },
        ],
        signal: opts.signal,
        onDelta: (d) => {
          chars += d.length
          opts.onProgress?.(`Writing report · ${chars.toLocaleString()} chars`)
        },
      })
    }, opts.signal)
    .catch((err: unknown) => {
      if (isAbort(err) || opts.signal?.aborted) throw abortError()
      throw err
    })
  let fields: ReportFields
  try {
    fields = normalizeReport(extractJson(text))
  } catch {
    throw new Error(`Could not parse the report. (${text.slice(0, 120)})`)
  }
  if (finish === 'length') {
    // Never let a cut-off draft pass as complete.
    const note = 'Note: the generated draft was cut off at the token limit and may be incomplete; review before signing.'
    fields = { ...fields, recommendations: fields.recommendations ? `${fields.recommendations}\n${note}` : note }
  }
  return fields
}
