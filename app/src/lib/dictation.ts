// Hands-free dictation: listen continuously, cut the audio at each pause, transcribe each utterance
// with the server's Sarvam proxy (/api/speech/transcribe) and hand back text or a voice command.
import type { ReportFieldKey } from '../types'

export type DictationCommand =
  | { kind: 'stop' }
  | { kind: 'next' }
  | { kind: 'previous' }
  | { kind: 'goto'; section: ReportFieldKey }
  | { kind: 'newline' }
  | { kind: 'undo' }
  | { kind: 'bullet' }
  | { kind: 'numbered' }

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

/** Recognise a whole utterance as a command; anything else is report text. */
export function parseUtterance(transcript: string): DictationEvent | null {
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
  const goto = said.match(/^(?:go to |open |move to )?(\w+)(?: section)?$/)
  if (goto && SECTION_WORDS[goto[1]] && (said.startsWith('go to') || said.startsWith('open') || said.startsWith('move to') || said.endsWith('section'))) {
    return { kind: 'command', command: { kind: 'goto', section: SECTION_WORDS[goto[1]] } }
  }
  const text = raw
    .replace(/\s*\bfull stop\b/gi, '.')
    .replace(/\s*\bcomma\b/gi, ',')
    .replace(/\s*\bcolon\b/gi, ':')
    .replace(/\s+([.,:])/g, '$1')
  return { kind: 'text', text }
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

export async function transcribeClip(blob: Blob, language: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch('/api/speech/transcribe', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ audio: await toBase64(blob), mime: blob.type || 'audio/webm', language }),
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
  onEvent: (event: DictationEvent) => void
  onState: (state: DictationState, detail?: string) => void
  onLevel?: (level: number) => void
}

const TICK_MS = 50
const END_SILENCE_MS = 900
const MAX_CLIP_MS = 25000 // Sarvam's REST limit is 30 s per request.
const MIN_SPEECH_MS = 250

/** Continuous listener. Each pause after speech ends one clip; clips are transcribed in order. */
export class Dictation {
  private stream?: MediaStream
  private context?: AudioContext
  private recorder?: MediaRecorder
  private timer?: number
  private chunks: Blob[] = []
  private clipStart = 0
  private speechMs = 0
  private silenceMs = 0
  private floor = 0.01
  private queue: Promise<void> = Promise.resolve()
  private pending = 0
  private stopped = false
  private abort = new AbortController()
  private mime = pickMime()
  private readonly options: Options

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
    this.context = new AudioContext()
    const source = this.context.createMediaStreamSource(this.stream)
    const analyser = this.context.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    this.startClip()
    this.options.onState('listening')
    this.timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (const value of samples) sum += value * value
      const rms = Math.sqrt(sum / samples.length)
      this.options.onLevel?.(Math.min(1, rms * 12))
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
      if ((this.speechMs >= MIN_SPEECH_MS && this.silenceMs >= END_SILENCE_MS) || elapsed >= MAX_CLIP_MS) this.cutClip()
      else if (this.speechMs === 0 && elapsed > 8000) this.cutClip(true) // Discard long silence so clips stay short.
    }, TICK_MS)
  }

  private startClip() {
    if (!this.stream || this.stopped) return
    this.chunks = []
    this.speechMs = 0
    this.silenceMs = 0
    this.clipStart = performance.now()
    const recorder = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime } : undefined)
    recorder.ondataavailable = (event) => { if (event.data.size) this.chunks.push(event.data) }
    recorder.start()
    this.recorder = recorder
  }

  private cutClip(discard = false) {
    const recorder = this.recorder
    if (!recorder || recorder.state === 'inactive') return
    const hadSpeech = this.speechMs >= MIN_SPEECH_MS && !discard
    recorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: recorder.mimeType || this.mime || 'audio/webm' })
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
        const transcript = await transcribeClip(blob, this.options.language, this.abort.signal)
        const event = parseUtterance(transcript)
        if (event && !this.abort.signal.aborted) this.options.onEvent(event)
      } catch (error) {
        if (!this.abort.signal.aborted) this.options.onState('error', error instanceof Error ? error.message : 'Dictation failed.')
      } finally {
        this.pending--
        if (!this.stopped && this.pending === 0) this.options.onState('listening')
      }
    })
  }

  /** Stop listening. The current utterance is still transcribed unless `discard` is set. */
  async stop(discard = false) {
    if (this.stopped) return
    if (this.timer) window.clearInterval(this.timer)
    if (!discard && this.speechMs >= MIN_SPEECH_MS) this.cutClip()
    this.stopped = true
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
    this.stream?.getTracks().forEach((track) => track.stop())
    await this.context?.close().catch(() => {})
    if (discard) this.abort.abort()
    else await this.queue
    this.options.onState('idle')
  }
}
