// OWNER: Agent 1 (AI engine). MedGemma OpenAI-compatible client with streaming, re-encoding,
// retry, and a serial queue so only one inference hits LM Studio at a time.
import type { AnalysisResult, ConnectionState, PatientInfo, ReportDraft, Settings, Study, StudyImage } from '../types'
import { buildAnalysisPrompt, buildReportPrompt, SYSTEM_PROMPT } from './prompts'
import { extractJson, normalizeAnalysis, normalizeReport, type ReportFields } from './parse'

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

interface SseChoice {
  delta?: { content?: string }
}
interface SsePayload {
  error?: string | { message?: string }
  choices?: SseChoice[]
}

// ---- Serial queue ----------------------------------------------------------

type Task<T> = () => Promise<T>
let chain: Promise<unknown> = Promise.resolve()
/** Run `task` after every prior queued task, serially, regardless of earlier outcomes. */
function enqueue<T>(task: Task<T>): Promise<T> {
  const result = chain.then(task, task)
  chain = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

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

/** Downscale to a JPEG with long edge <= maxEdge. MedGemma internally uses ~896px. */
async function reencodeImage(image: StudyImage, maxEdge = 1024): Promise<string> {
  const img = await loadImage(image.dataUrl)
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
  return canvas.toDataURL('image/jpeg', 0.92)
}

// ---- SSE streaming ---------------------------------------------------------

export async function chatStream({
  settings,
  messages,
  signal,
  onDelta,
  maxTokens,
  temperature,
}: {
  settings: Settings
  messages: ChatMessage[]
  signal?: AbortSignal
  onDelta?: (text: string) => void
  maxTokens?: number
  temperature?: number
}): Promise<string> {
  const url = endpoint(settings, '/chat/completions')
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.model,
      messages,
      stream: true,
      temperature: temperature ?? settings.temperature,
      max_tokens: maxTokens ?? settings.maxTokens,
    }),
    signal,
  }

  let res: Response
  try {
    res = await fetch(url, init)
  } catch (err) {
    if (isAbort(err)) throw abortError()
    throw new Error(`LM Studio is not reachable at ${settings.baseUrl}. Ensure it is running.`)
  }
  if (!res.ok) throw new Error(await readErrorBody(res))

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let out = ''
  let cancelled = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      let line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') {
        cancelled = true
        break
      }
      let json: SsePayload
      try {
        json = JSON.parse(payload)
      } catch {
        continue // partial line already buffered; wait for next chunk
      }
      if (json.error) {
        const err = typeof json.error === 'string' ? json.error : (json.error.message ?? 'LM Studio returned an error.')
        throw new Error(err)
      }
      const delta = json.choices?.[0]?.delta?.content
      if (delta) {
        out += delta
        onDelta?.(delta)
      }
    }
    if (cancelled) break
  }

  // Flush any trailing partial data line.
  const rest = buffer.trim()
  if (!cancelled && rest.startsWith('data:')) {
    try {
      const json: SsePayload = JSON.parse(rest.slice(5).trim())
      if (!json.error) {
        const delta = json.choices?.[0]?.delta?.content
        if (delta) out += delta
      }
    } catch {
      // ignore
    }
  }

  try {
    await reader.cancel()
  } catch {
    // ignore
  }
  return out
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
    const res = await fetch(endpoint(settings, '/models'), { signal: ac.signal })
    if (!res.ok) return 'offline'
    const data = await res.json().catch(() => null)
    const models: { id?: unknown }[] = Array.isArray(data?.data) ? data.data : []
    const wanted = (settings.model || '').toLowerCase()
    const exists = models.some(
      (m) => m && typeof m.id === 'string' && (m.id === wanted || m.id.toLowerCase().includes(wanted)),
    )
    return exists ? 'online' : 'model-missing'
  } catch {
    return 'offline'
  } finally {
    clearTimeout(timer)
  }
}

// ---- analyzeImage ----------------------------------------------------------

const RETRY_PROMPT = `The previous response could not be parsed. Return ONLY a single valid JSON
object for the exact same schema and findings you already generated — no prose, no markdown, no
code fences.`

export async function analyzeImage(opts: {
  image: StudyImage
  patient: PatientInfo
  settings: Settings
  signal?: AbortSignal
  onProgress?: (text: string) => void
}): Promise<AnalysisResult> {
  const t0 = Date.now()
  let tokens = 0

  const run = async (followup: boolean): Promise<string> => {
    opts.onProgress?.(followup ? 'Regenerating findings…' : 'Reviewing image…')
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: await reencodeImage(opts.image) } },
          { type: 'text', text: followup ? RETRY_PROMPT : buildAnalysisPrompt(opts.patient) },
        ],
      },
    ]
    return enqueue(() =>
      chatStream({
        settings: opts.settings,
        messages,
        signal: opts.signal,
        onDelta: (d) => {
          tokens += d.length
          if (!followup) opts.onProgress?.(`Writing findings · ${tokens} tokens`)
        },
      }),
    )
  }

  try {
    const text = await run(false)
    return normalizeAnalysis(extractJson(text), { rawText: text, model: opts.settings.model, durationMs: Date.now() - t0 })
  } catch (err) {
    if (isAbort(err) || opts.signal?.aborted) throw abortError()
    // Retry only when the model produced non-JSON output; surface network errors directly.
    if (!isParseableError(err)) {
      throw isNetworkish(err)
        ? new Error(`LM Studio is not reachable at ${opts.settings.baseUrl}. Ensure it is running.`)
        : new Error(err instanceof Error ? err.message : 'Analysis failed.')
    }
    try {
      const text = await run(true)
      return normalizeAnalysis(extractJson(text), { rawText: text, model: opts.settings.model, durationMs: Date.now() - t0 })
    } catch (retryErr) {
      if (isAbort(retryErr) || opts.signal?.aborted) throw abortError()
      throw retryErr
    }
  }
}

/** A failure that is (likely) the model producing non-JSON output that we should retry. */
function isParseableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const m = err.message.toLowerCase()
  return m.includes('unable to parse json') || m.includes('could not recover') || m.includes('no json content') || m.includes('parse json from model')
}

function isNetworkish(err: unknown): boolean {
  if (err instanceof Error) {
    const m = err.message.toLowerCase()
    return m.includes('lm studio is not') || m.includes('lm studio request failed') || m.includes('networkerror') || m.includes('fetch failed') || m.includes('aborted')
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
  return enqueue(async () => {
    opts.onProgress?.('Compiling report…')
    const prompt = buildReportPrompt(opts.study)
    const text = await chatStream({
      settings: opts.settings,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }],
      signal: opts.signal,
      onDelta: (d) => opts.onProgress?.(`Writing report · ${d.length} tokens`),
    })
    let fields: ReportFields
    try {
      fields = normalizeReport(extractJson(text))
    } catch {
      if (opts.signal?.aborted) throw abortError()
      throw new Error(`Could not parse the report. (${text.slice(0, 120)})`)
    }
    return fields
  })
}