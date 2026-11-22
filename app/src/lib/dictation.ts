// Hands-free dictation: listen continuously, cut the audio at each pause, transcribe each utterance
// with the server's Sarvam proxy (/api/speech/transcribe) and hand back text or a voice command.
import type { ReportFieldKey } from '../types'
import { normaliseMeasurements } from './dictationNumbers.ts'

export type DictationCommand =
  | { kind: 'stop' }
  | { kind: 'next' }
  | { kind: 'previous' }
  | { kind: 'goto'; section: ReportFieldKey }
  | { kind: 'newline' }
  | { kind: 'undo' }
  | { kind: 'bullet' }
  | { kind: 'numbered' }
  | { kind: 'nextField' }
  | { kind: 'prevField' }
  | { kind: 'macro'; name: string }
  | { kind: 'deleteSentence' }
  | { kind: 'capitalise' }
  | { kind: 'guideline'; action: 'open' | 'insert' | 'close' }

export type DictationEvent = { kind: 'text'; text: string } | { kind: 'command'; command: DictationCommand }
export type DictationState = 'idle' | 'starting' | 'listening' | 'hearing' | 'transcribing' | 'error'

const SECTION_WORDS: Record<string, ReportFieldKey> = {
  technique: 'technique',
  comparison: 'comparison',
  finding: 'findings',
  findings: 'findings',
  impression: 'impression',
  impressions: 'impression',
  conclusion: 'impression',
  recommendation: 'recommendations',
  recommendations: 'recommendations',
}

// Spoken punctuation. "period" is only punctuation where it cannot be the noun ("last menstrual period").
const PUNCTUATION: Array<[RegExp, string]> = [
  [/\s*\bfull stop\b/gi, '.'],
  [/\s*\bquestion mark\b/gi, '?'],
  [/\s*\bsemi ?colon\b/gi, ';'],
  [/\s*\bcomma\b/gi, ','],
  [/\s*\bcolon\b/gi, ':'],
  [/\s*(?<!\b(?:menstrual|the|a|this|that|same|interval|time|short|long|waiting|grace|neonatal|postpartum|perinatal|follow[- ]up)\s)\bperiod\b(?!\s+of\b)/gi, '.'],
  [/\bopen (?:bracket|parenthesis|paren)\b\s*/gi, '('],
  [/\s*\bclose (?:bracket|parenthesis|paren)\b/gi, ')'],
  [/\s*\bhyphen\b\s*/gi, '-'],
  [/\s*\b(?:forward )?slash\b\s*/gi, '/'],
]

/** Spoken punctuation and measurements -> written form. */
export function formatDictatedText(raw: string): string {
  let text = raw
  for (const [re, mark] of PUNCTUATION) text = text.replace(re, mark)
  text = text
    .replace(/\s+([.,:;?)])/g, '$1')
    // The recogniser often adds its own mark after a spoken one ("comma." -> ",.").
    .replace(/([.?!;:,])[.,]+(?!\d)/g, '$1')
  return normaliseMeasurements(text)
}

/**
 * Split an utterance that ends or pauses with "new line"/"new paragraph" into text and line-break events,
 * so "no effusion full stop new paragraph" types the sentence and then breaks the line.
 */
export function parseUtterances(transcript: string, correct?: (text: string) => string): DictationEvent[] {
  const parts = transcript.split(/[\s,]*\bnew (?:line|paragraph)\b[\s.,]*/i)
  if (parts.length === 1) {
    const one = parseUtterance(transcript, correct)
    return one ? [one] : []
  }
  const events: DictationEvent[] = []
  parts.forEach((part, index) => {
    if (index > 0) events.push({ kind: 'command', command: { kind: 'newline' } })
    if (!part.trim()) return
    const event = parseUtterance(part, correct)
    // Inside a longer utterance only treat the pieces as text; commands must be said on their own.
    if (event) events.push(event.kind === 'text' ? event : { kind: 'text', text: (correct ?? ((t: string) => t))(formatDictatedText(part.trim())) })
  })
  return events
}

/** Recognise a whole utterance as a command; anything else is report text (passed through `correct`). */
export function parseUtterance(transcript: string, correct?: (text: string) => string): DictationEvent | null {
  const raw = transcript.trim()
  if (!raw) return null
  const said = raw.toLowerCase().replace(/[.,!?;:"']/g, '').replace(/\s+/g, ' ').trim()
  if (/^(stop|end|pause) (dictation|dictating|listening)$/.test(said)) return { kind: 'command', command: { kind: 'stop' } }
  if (/^(next|next section)$/.test(said)) return { kind: 'command', command: { kind: 'next' } }
  if (/^(previous|previous section|go back)$/.test(said)) return { kind: 'command', command: { kind: 'previous' } }
  if (/^new (line|paragraph)$/.test(said)) return { kind: 'command', command: { kind: 'newline' } }
  if (/^(scratch that|undo|undo that|delete that)$/.test(said)) return { kind: 'command', command: { kind: 'undo' } }
  if (/^(bullet|bullet point|bullet list)$/.test(said)) return { kind: 'command', command: { kind: 'bullet' } }
  if (/^(numbered list|number list)$/.test(said)) return { kind: 'command', command: { kind: 'numbered' } }
  if (/^(next field|next blank)$/.test(said)) return { kind: 'command', command: { kind: 'nextField' } }
  if (/^(previous field|prev field|last field|previous blank)$/.test(said)) return { kind: 'command', command: { kind: 'prevField' } }
  if (/^(delete|scratch|remove) (the )?last sentence$/.test(said)) return { kind: 'command', command: { kind: 'deleteSentence' } }
  if (/^(capitali[sz]e|cap) (that|it)$/.test(said)) return { kind: 'command', command: { kind: 'capitalise' } }
  if (/^(open|show|check) (the )?guidelines?( helper)?$|^guidelines?( helper)?$/.test(said)) return { kind: 'command', command: { kind: 'guideline', action: 'open' } }
  if (/^(insert|apply|add) (the )?guidelines?( recommendation)?$/.test(said)) return { kind: 'command', command: { kind: 'guideline', action: 'insert' } }
  if (/^(close|cancel|dismiss) (the )?guidelines?( helper)?$/.test(said)) return { kind: 'command', command: { kind: 'guideline', action: 'close' } }
  const macro = said.match(/^(?:insert )?macro ([\w -]{1,60})$/)
  if (macro) return { kind: 'command', command: { kind: 'macro', name: macro[1].trim() } }
  const goto = said.match(/^(?:go to |open |move to )?(\w+)(?: section)?$/)
  if (goto && SECTION_WORDS[goto[1]] && (said.startsWith('go to') || said.startsWith('open') || said.startsWith('move to') || said.endsWith('section'))) {
    return { kind: 'command', command: { kind: 'goto', section: SECTION_WORDS[goto[1]] } }
  }
  const text = formatDictatedText(raw)
  return { kind: 'text', text: correct ? correct(text) : text }
}

function pickMime(): string {
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export async function transcribeClip(blob: Blob, language: string, signal?: AbortSignal, keyterms: string[] = []): Promise<string> {
  const response = await fetch('/api/speech/transcribe', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ audio: await toBase64(blob), mime: blob.type || 'audio/webm', language, ...(keyterms.length ? { keyterms } : {}) }),
    signal,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Dictation failed (HTTP ${response.status}).`)
  return typeof data.transcript === 'string' ? data.transcript : ''
}

export async function dictationAvailable(): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return false
  try {
    const response = await fetch('/api/speech/status', { credentials: 'same-origin', cache: 'no-store' })
    return response.ok && (await response.json()).configured === true
  } catch {
    return false
  }
}

interface Options {
  language: string
  onEvent: (event: DictationEvent, clip: Blob) => void
  onState: (state: DictationState, detail?: string) => void
  onLevel?: (level: number) => void
  /** 'manual' records only between hold() and release() (push-to-talk); default cuts at each pause. */
  mode?: 'auto' | 'manual'
  /** Custom vocabulary hints for the recogniser. */
  keyterms?: string[]
  /** Applied to dictated text (vocabulary corrections), not to commands. */
  correct?: (text: string) => string
}

const TICK_MS = 50
const END_SILENCE_MS = 900
const MAX_CLIP_MS = 25000 // Sarvam's REST limit is 30 s per request.
const MIN_SPEECH_MS = 250

/**
 * Wrap a dictation event handler so it only runs while the study it was started for is still the active one.
 * Transcripts that arrive after the reader moved to another study (or closed the report) are dropped, never
 * written into the other patient's report.
 */
export function guardStudy<A extends unknown[]>(studyId: string, currentStudyId: () => string | null, handler: (...args: A) => void) {
  return (...args: A) => { if (currentStudyId() === studyId) handler(...args) }
}

/** Continuous listener. Each pause after speech ends one clip; clips are transcribed in order. */
export class Dictation {
  private stream?: MediaStream
  private context?: AudioContext
  private recorder?: MediaRecorder
  private timer?: number
  private chunks = new WeakMap<MediaRecorder, Blob[]>()
  private clipStart = 0
  private speechMs = 0
  private silenceMs = 0
  private floor = 0.01
  private queue: Promise<void> = Promise.resolve()
  private pending = 0
  private stopped = false
  private abort = new AbortController()
  private mime = pickMime()
  private held = false
  private readonly options: Options
  private get manual() { return this.options.mode === 'manual' }

  constructor(options: Options) {
    this.options = options
  }

  async start() {
    this.options.onState('starting')
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
    } catch {
      this.options.onState('error', 'Microphone access was blocked. Allow the microphone for this site and try again.')
      return
    }
    // Stopped while the permission prompt was open: release the microphone straight away.
    if (this.stopped) { this.stream.getTracks().forEach((track) => track.stop()); return }
    this.context = new AudioContext()
    const source = this.context.createMediaStreamSource(this.stream)
    const analyser = this.context.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    if (!this.manual || this.held) this.startClip()
    this.options.onState(this.held ? 'hearing' : 'listening')
    this.timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (const value of samples) sum += value * value
      const rms = Math.sqrt(sum / samples.length)
      this.options.onLevel?.(Math.min(1, rms * 12))
      if (this.manual && !this.recorder) return // Push-to-talk between presses: meter only.
      const threshold = Math.max(0.012, this.floor * 2.8)
      const speaking = rms > threshold
      // Track background noise only while quiet, so speech does not raise the threshold.
      if (!speaking) this.floor = this.floor * 0.97 + rms * 0.03
      if (speaking) {
        this.speechMs += TICK_MS
        this.silenceMs = 0
        if (this.speechMs >= MIN_SPEECH_MS) this.options.onState('hearing')
      } else if (this.speechMs > 0) {
        this.silenceMs += TICK_MS
      }
      const elapsed = performance.now() - this.clipStart
      // Push-to-talk: the key decides where clips end; only split very long holds.
      if (this.manual) { if (this.recorder && elapsed >= MAX_CLIP_MS) this.cutClip(); return }
      if ((this.speechMs >= MIN_SPEECH_MS && this.silenceMs >= END_SILENCE_MS) || elapsed >= MAX_CLIP_MS) this.cutClip()
      else if (this.speechMs === 0 && elapsed > 8000) this.cutClip(true) // Discard long silence so clips stay short.
    }, TICK_MS)
  }

  /** Push-to-talk: start recording now (the microphone stays open between presses, so no first word is lost). */
  hold() {
    if (this.stopped || this.held) return
    this.held = true
    if (this.stream && !this.recorder) this.startClip()
    if (this.stream) this.options.onState('hearing')
  }

  /** Push-to-talk: stop recording and send what was said. */
  release() {
    if (!this.held) return
    this.held = false
    // In manual mode the key press is the speech signal; still drop taps too short to contain a word.
    if (this.recorder) this.cutClip(performance.now() - this.clipStart < MIN_SPEECH_MS || this.speechMs === 0)
    if (!this.stopped && this.pending === 0) this.options.onState('listening')
  }

  get holding() { return this.held }

  private startClip() {
    if (!this.stream || this.stopped || this.recorder || (this.manual && !this.held)) return
    this.speechMs = 0
    this.silenceMs = 0
    this.clipStart = performance.now()
    const recorder = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime } : undefined)
    // Chunks belong to their recorder: a quick re-press can start the next clip before this one finishes.
    const chunks: Blob[] = []
    this.chunks.set(recorder, chunks)
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
    recorder.start()
    this.recorder = recorder
  }

  private cutClip(discard = false) {
    const recorder = this.recorder
    if (!recorder || recorder.state === 'inactive') return
    // A push-to-talk press is itself the signal that someone spoke, so short words like "next" count.
    const hadSpeech = !discard && (this.manual ? this.speechMs > 0 : this.speechMs >= MIN_SPEECH_MS)
    recorder.onstop = () => {
      const blob = new Blob(this.chunks.get(recorder) ?? [], { type: recorder.mimeType || this.mime || 'audio/webm' })
      if (hadSpeech) this.enqueue(blob)
      this.startClip()
    }
    this.recorder = undefined
    recorder.stop()
  }

  private enqueue(blob: Blob) {
    this.pending++
    this.options.onState('transcribing')
    this.queue = this.queue.then(async () => {
      try {
        const transcript = await transcribeClip(blob, this.options.language, this.abort.signal, this.options.keyterms)
        for (const event of parseUtterances(transcript, this.options.correct)) {
          if (!this.abort.signal.aborted) this.options.onEvent(event, blob)
        }
      } catch (error) {
        if (!this.abort.signal.aborted) this.options.onState('error', error instanceof Error ? error.message : 'Dictation failed.')
      } finally {
        this.pending--
        if (!this.stopped && this.pending === 0) this.options.onState(this.held ? 'hearing' : 'listening')
      }
    })
  }

  /** Stop listening. The current utterance is still transcribed unless `discard` is set. */
  async stop(discard = false) {
    // Already stopped but still finishing a clip: a later discard (e.g. the study changed) drops what is in flight.
    if (this.stopped) { if (discard) this.abort.abort(); return }
    if (this.timer) window.clearInterval(this.timer)
    if (!discard && (this.speechMs >= MIN_SPEECH_MS || (this.manual && this.held && this.speechMs > 0))) this.cutClip()
    this.held = false
    this.stopped = true
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
    this.stream?.getTracks().forEach((track) => track.stop())
    await this.context?.close().catch(() => {})
    if (discard) this.abort.abort()
    else await this.queue
    this.options.onState('idle')
  }
}

/** Where the last sentence of `text` starts (after the previous . ? or ! and its spaces). */
export function lastSentenceStart(text: string): number {
  const body = text.replace(/\s+$/, '')
  // Ignore the full stop that ends the last sentence itself, and decimal points like "1.2".
  const trimmed = body.replace(/[.?!]+$/, '')
  let cut = -1
  for (let i = trimmed.length - 1; i >= 0; i--) {
    if (/[.?!]/.test(trimmed[i]) && !(/\d/.test(trimmed[i - 1] ?? '') && /\d/.test(trimmed[i + 1] ?? ''))) { cut = i + 1; break }
  }
  if (cut < 0) return 0
  while (cut < trimmed.length && /\s/.test(trimmed[cut])) cut++
  return cut
}

/** "capitalise that": Title-case each word of the last phrase. */
export function capitaliseWords(text: string): string {
  return text.replace(/(^|[\s(/-])(\p{Ll})/gu, (_, before: string, letter: string) => before + letter.toUpperCase())
}
