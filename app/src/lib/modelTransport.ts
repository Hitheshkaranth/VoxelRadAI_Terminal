import type { ConnectionState, Settings } from '../types.ts'
import { parseSseLines, type SseParse } from './sse.ts'

type ChatRole = 'system' | 'user' | 'assistant'
export interface ChatMessage {
  role: ChatRole
  content: string | ChatPart[]
}
interface ChatPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

function endpoint(settings: Settings, suffix = ''): string {
  const base =
    settings.baseUrl.startsWith('http') || settings.baseUrl.startsWith('//')
      ? settings.baseUrl
      : typeof location !== 'undefined'
        ? location.origin + settings.baseUrl
        : settings.baseUrl
  return `${base}${suffix}`
}

// ---- SSE streaming ---------------------------------------------------------

/** No streamed bytes for this long â†’ the request is aborted as stalled. */
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
    if (signal?.aborted) throw abortError()
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

    let sawDone = false
    try {
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
      if (!sawDone) {
        const last = parseSseLines(buffer + decoder.decode() + '\n')
        absorb(last)
        sawDone = last.done
      }
    } catch (err) {
      if (timedOut) throw stalled()
      if (isAbort(err) || signal?.aborted) throw abortError()
      throw err
    } finally {
      reader.cancel().catch(() => undefined)
    }

    if (signal?.aborted) throw abortError()
    if (bad.length) throw new Error('The model returned a damaged stream. No result was saved; retry the analysis.')
    if (!sawDone && !finish) throw new Error('The model connection ended before the response completed. Retry the analysis.')
    if (!text.trim()) throw new Error('The model returned no readable output. Check the selected model and retry.')
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
  e.name = 'AbortError'
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
    let res = await fetch(url, { signal: ac.signal })
    let studioInventory = localStudio
    // Skanda and other OpenAI-compatible servers need not implement LM Studio's inventory.
    // Do not bypass authentication or server errors by falling back on those failures.
    if (localStudio && (res.status === 404 || res.status === 405)) {
      res = await fetch(endpoint(settings, '/models'), { signal: ac.signal })
      studioInventory = false
    }
    if (!res.ok) return 'offline'
    const data = await res.json().catch(() => null)
    const models: { id?: unknown; state?: string }[] = Array.isArray(data?.data) ? data.data : []
    const wanted = (settings.model || '').trim().toLowerCase()
    if (!wanted) return 'model-missing'
    // Exact id match: a substring match would report "online" for a different model or quantisation.
    const exists = models.some((m) => m && typeof m.id === 'string' && m.id.toLowerCase() === wanted && (!studioInventory || m.state === 'loaded'))
    return exists ? 'online' : 'model-missing'
  } catch {
    return 'offline'
  } finally {
    clearTimeout(timer)
  }
}
