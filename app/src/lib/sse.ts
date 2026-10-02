// Pure parser for OpenAI-compatible server-sent events (LM Studio /chat/completions with stream:true).
// DOM-free so Node can test it (scripts/test-lib.ts).

export interface SseParse {
  /** Parsed JSON payloads of every complete `data:` line, in order. */
  events: unknown[]
  /** Concatenated choices[0].delta.content of those events. */
  text: string
  /** Incomplete trailing line; prepend it to the next chunk. */
  rest: string
  /** `data: [DONE]` was seen; anything after it is ignored. */
  done: boolean
  /** Last choices[0].finish_reason seen ("stop", "length", ...). */
  finish?: string
  /** Error message from an `{ "error": ... }` payload. */
  error?: string
  /** Complete `data:` lines that were not valid JSON. Reported, never silently dropped. */
  bad: string[]
}

interface Payload {
  error?: string | { message?: string }
  choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[]
}

/** Parse every complete line in `buffer` (CRLF or LF). The unterminated tail is returned in `rest`. */
export function parseSseLines(buffer: string): SseParse {
  const out: SseParse = { events: [], text: '', rest: '', done: false, bad: [] }
  const lines = buffer.split('\n')
  out.rest = lines.pop() ?? ''
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '').trim()
    if (!line.startsWith('data:')) continue // blank separators, ": keep-alive" comments, event:/id: fields
    const data = line.slice(5).trim()
    if (data === '[DONE]') {
      out.done = true
      out.rest = ''
      break
    }
    let json: Payload
    try {
      json = JSON.parse(data)
    } catch {
      out.bad.push(data.slice(0, 200))
      continue
    }
    out.events.push(json)
    if (json && json.error) {
      out.error = typeof json.error === 'string' ? json.error : (json.error.message ?? 'The model server returned an error.')
      continue
    }
    const choice = json?.choices?.[0]
    if (typeof choice?.delta?.content === 'string') out.text += choice.delta.content
    if (typeof choice?.finish_reason === 'string') out.finish = choice.finish_reason
  }
  return out
}
